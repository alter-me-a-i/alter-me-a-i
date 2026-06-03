/*
 * The Vault: the product. An encrypted, append-only, local-first corpus of your
 * own behavior. Offense (grow your pool) writes here via append(); later phases
 * train on it. Nothing ever leaves the device.
 *
 * Lifecycle: locked -> unlock(passphrase) -> usable. The derived key lives only
 * in memory, so a restarted worker re-locks and the user re-enters their phrase.
 */

import { browser } from 'wxt/browser';
import { open, seal } from './crypto';
import * as db from './store';
import {
  SCHEMA_VERSION,
  type AlterMeAIEvent,
  type EventQuery,
  type EventType,
  type NewEvent,
  type VaultStats,
} from './types';
import {
  toJSONL,
  toTrajectories,
  type TrajectoryOptions,
  type TrajectorySample,
} from './trajectory';
import {
  emptyKeyring,
  generateVmk,
  importVaultKey,
  makePassphraseWrap,
  makeWebauthnWrap,
  unwrapWithPassphrase,
  unwrapWithPrf,
  type Keyring,
  type WrapRecord,
} from '../auth/keyring';
import { clearSession, loadSession, saveSession } from './session';
import {
  grantAllows,
  PermissionDenied,
  type Grant,
  type GrantScope,
} from './permission';

const KEYRING_KEY = 'alter-me-a-i.keyring';

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

async function loadKeyring(): Promise<Keyring> {
  const stored = await browser.storage.local.get(KEYRING_KEY);
  return (stored[KEYRING_KEY] as Keyring | undefined) ?? emptyKeyring();
}

async function saveKeyring(kr: Keyring): Promise<void> {
  await browser.storage.local.set({ [KEYRING_KEY]: kr });
}

class Vault {
  #key: CryptoKey | null = null;
  #vmk: Uint8Array | null = null; // master key, in memory only while unlocked
  #db: IDBDatabase | null = null;
  // Live permission grants, keyed by id. In-memory only; cleared on lock, so
  // grants are session-tied by default (a grant MAY also carry its own expiry).
  #grants = new Map<string, Grant>();

  isUnlocked(): boolean {
    return this.#key !== null && this.#db !== null;
  }

  // --- permission gate -------------------------------------------------------

  /**
   * Issue a scoped, revocable grant and return its id. Default-deny means a
   * consumer gets NOTHING until it holds a grant; this is how it gets one.
   * Session-tied unless `expiresAt` is set. Requires the vault unlocked.
   */
  issueGrant(label: string, scope: GrantScope, expiresAt?: number): string {
    this.#require();
    const id = uuid();
    this.#grants.set(id, { id, label, scope, grantedAt: Date.now(), expiresAt });
    return id;
  }

  /** Revoke a grant by id (idempotent). */
  revokeGrant(id: string): void {
    this.#grants.delete(id);
  }

  /** Live grants (for a future management UI). */
  listGrants(): Grant[] {
    const now = Date.now();
    // Drop any self-expired grants lazily as we list.
    for (const [id, g] of this.#grants) {
      if (g.expiresAt != null && now >= g.expiresAt) this.#grants.delete(id);
    }
    return [...this.#grants.values()];
  }

  /**
   * Read the corpus THROUGH a grant. The single gated entry point for every
   * consumer (Mind, export, training, future connectors/sites). Only events the
   * grant's scope covers are returned; an unknown/expired grant is denied.
   */
  async queryWithGrant(grantId: string, q: EventQuery = {}): Promise<AlterMeAIEvent[]> {
    const grant = this.#grants.get(grantId);
    const now = Date.now();
    if (!grant) throw new PermissionDenied('no such grant');
    if (grant.expiresAt != null && now >= grant.expiresAt) {
      this.#grants.delete(grantId);
      throw new PermissionDenied('grant expired');
    }
    const all = await this.query(q);
    return all.filter((e) => grantAllows(grant, e, now));
  }

  /** True once at least one unlock method is enrolled (vault initialized). */
  async isInitialized(): Promise<boolean> {
    return (await loadKeyring()).wraps.length > 0;
  }

  /** Methods enrolled, for the UI (id/method/label only — no secrets). */
  async methods(): Promise<Array<Pick<WrapRecord, 'id' | 'method' | 'label'>>> {
    const kr = await loadKeyring();
    return kr.wraps.map(({ id, method, label }) => ({ id, method, label }));
  }

  /**
   * Unlock with a passphrase. First time (no keyring) this CREATES the vault:
   * generate a random master key and wrap it under the passphrase.
   */
  async unlock(passphrase: string, ttlMs: number | null = 0): Promise<void> {
    const kr = await loadKeyring();
    if (kr.wraps.length === 0) {
      const vmk = generateVmk();
      kr.wraps.push(await makePassphraseWrap(passphrase, vmk));
      await saveKeyring(kr);
      await this.#open(vmk, ttlMs);
      return;
    }
    const rec = kr.wraps.find((w) => w.method === 'passphrase');
    if (!rec) throw new Error('No passphrase enrolled on this vault.');
    const vmk = await unwrapWithPassphrase(rec, passphrase); // throws if wrong
    await this.#open(vmk, ttlMs);
  }

  /** Unlock with a WebAuthn PRF output (resolved by the caller). */
  async unlockWithPrf(
    credentialId: Uint8Array,
    prfOutput: Uint8Array,
    ttlMs: number | null = 0,
  ): Promise<void> {
    const kr = await loadKeyring();
    const idArr = Array.from(credentialId).join(',');
    const rec = kr.wraps.find(
      (w) => w.method === 'webauthn' && (w.credentialId ?? []).join(',') === idArr,
    );
    if (!rec) throw new Error('This passkey is not enrolled.');
    const vmk = await unwrapWithPrf(rec, prfOutput);
    await this.#open(vmk, ttlMs);
  }

  /**
   * Rehydrate the unlocked state from a live memory-only session, if one exists
   * (i.e. the worker restarted within the chosen window). Returns true if the
   * vault is now unlocked. Cheap no-op when already unlocked or no session.
   */
  async restore(): Promise<boolean> {
    if (this.isUnlocked()) return true;
    const vmk = await loadSession();
    if (!vmk) return false;
    await this.#open(vmk, undefined); // keep existing session expiry untouched
    return true;
  }

  /**
   * Enroll a passkey as an additional unlock method for the ALREADY-UNLOCKED
   * vault. Wraps the current master key under the PRF-derived KEK.
   */
  async enrollWebauthn(
    credentialId: Uint8Array,
    prfOutput: Uint8Array,
    prfSalt: Uint8Array,
    label = 'Passkey',
  ): Promise<void> {
    if (!this.#vmk) throw new Error('Unlock the vault before adding a passkey.');
    const kr = await loadKeyring();
    kr.wraps.push(await makeWebauthnWrap(prfOutput, prfSalt, credentialId, this.#vmk, label));
    await saveKeyring(kr);
  }

  /**
   * Open the vault with a master key. `ttlMs` controls the memory-only session:
   *   - 0      → no session; vault re-locks when the worker dies (~30s idle).
   *   - >0     → keep unlocked for that many ms across worker restarts.
   *   - null   → keep unlocked until the browser fully closes.
   *   - undefined → leave any existing session untouched (used by restore()).
   */
  async #open(vmk: Uint8Array, ttlMs: number | null | undefined): Promise<void> {
    this.#vmk = vmk;
    this.#key = await importVaultKey(vmk);
    this.#db = await db.openDb();
    if (ttlMs === undefined) return;
    if (ttlMs === 0) await clearSession();
    else await saveSession(vmk, ttlMs);
  }

  lock(): void {
    this.#key = null;
    this.#vmk = null;
    this.#db?.close();
    this.#db = null;
    this.#grants.clear(); // session-tied: locking revokes every grant
    void clearSession(); // drop the memory-only session too
  }

  async append(input: NewEvent): Promise<string> {
    const { key, database } = this.#require();
    const event = { ...input, id: uuid(), ts: Date.now(), v: SCHEMA_VERSION } as AlterMeAIEvent;
    const sealed = await seal(key, JSON.stringify(event));
    await db.put(database, {
      id: event.id,
      ts: event.ts,
      type: event.type,
      iv: sealed.iv,
      ct: sealed.ct,
    });
    return event.id;
  }

  async query(q: EventQuery = {}): Promise<AlterMeAIEvent[]> {
    const { key, database } = this.#require();
    const records = await db.readAll(database, q);
    const events: AlterMeAIEvent[] = [];
    for (const rec of records) {
      events.push(JSON.parse(await open(key, { iv: rec.iv, ct: rec.ct })));
    }
    return events;
  }

  async stats(): Promise<VaultStats> {
    const { database } = this.#require();
    const records = await db.readAll(database);
    const byType = {} as Record<EventType, number>;
    let earliest: number | undefined;
    let latest: number | undefined;
    for (const r of records) {
      byType[r.type] = (byType[r.type] ?? 0) + 1;
      if (earliest == null || r.ts < earliest) earliest = r.ts;
      if (latest == null || r.ts > latest) latest = r.ts;
    }
    return { total: records.length, byType, earliest, latest };
  }

  /** Your data, your pool: full decrypted export for the user to take with them. */
  async export(): Promise<AlterMeAIEvent[]> {
    return this.query();
  }

  /**
   * Training export. Turns the corpus into fine-tune-ready trajectory samples —
   * the artifact that lets you train a model on yourself.
   *
   * GATED: reads through a short-lived grant scoped to the sensitivity ceiling,
   * so the permission gate itself guarantees nothing above the ceiling reaches
   * the training data — independent of (and in addition to) the trajectory
   * transform's own redaction. This is the gate doing real work on the one path
   * where data actually leaves the device, and the pattern external consumers
   * will follow. (PII redaction still happens in the transform.)
   */
  async exportTrajectories(
    options?: TrajectoryOptions,
  ): Promise<TrajectorySample[]> {
    const ceiling = options?.maxSensitivity ?? 'personal';
    const grantId = this.issueGrant('Training export', { maxSensitivity: ceiling });
    try {
      const events = await this.queryWithGrant(grantId);
      return toTrajectories(events, options);
    } finally {
      this.revokeGrant(grantId);
    }
  }

  /** Same as exportTrajectories, serialized to JSONL for a fine-tuner. */
  async exportJSONL(options?: TrajectoryOptions): Promise<string> {
    return toJSONL(await this.exportTrajectories(options));
  }

  async wipe(): Promise<void> {
    const { database } = this.#require();
    await db.clear(database);
  }

  #require(): { key: CryptoKey; database: IDBDatabase } {
    if (!this.#key || !this.#db) {
      throw new Error('Vault is locked. Call unlock(passphrase) first.');
    }
    return { key: this.#key, database: this.#db };
  }
}

/** Process-wide singleton — one writer per context (the background worker). */
export const vault = new Vault();

export type { AlterMeAIEvent, EventQuery, NewEvent, VaultStats } from './types';
export type { TrajectoryOptions, TrajectorySample } from './trajectory';
