import { vault } from '../lib/vault';
import type { VaultMessage, VaultResponse } from '../lib/messages';
import { applyNetworkControls } from '../lib/defense/network';
import { applyFingerprintGateRegistration } from '../lib/defense/gate-registration';
import { loadDefenseSettings, onDefenseSettingsChanged } from '../lib/defense/settings';
import { Mind } from '../lib/mind';
import type { NewEvent } from '../lib/vault/types';

// The Mind is rebuilt lazily from the unlocked vault and cached until the next
// append invalidates it — so profile/search stay fast without holding a stale
// model. Lives only in memory; locking the vault drops it.
let mind: Mind | null = null;
async function getMind(): Promise<Mind> {
  if (mind) return mind;
  const m = new Mind();
  m.build(await vault.query());
  mind = m;
  return m;
}

// Events captured while the vault is locked. RAM-only and NEVER persisted:
// while locked there is no key, and writing plaintext behavior to disk would
// break the core promise that on-disk data requires your passphrase. This queue
// shares the service worker's lifetime — exactly as durable, and as private, as
// the in-memory key itself. It is drained into the encrypted vault the moment
// you unlock, and silently discarded if the worker sleeps first.
const lockedBuffer: NewEvent[] = [];
const MAX_BUFFER = 500; // bound memory; once full, further captures are dropped

async function drainLockedBuffer(): Promise<void> {
  if (!vault.isUnlocked() || lockedBuffer.length === 0) return;
  let drained = 0;
  while (lockedBuffer.length) {
    try {
      await vault.append(lockedBuffer[0]);
    } catch {
      break; // re-locked mid-drain — leave the remainder queued for next unlock
    }
    lockedBuffer.shift();
    drained++;
  }
  if (drained > 0) mind = null; // new data invalidates the cached model
}

export default defineBackground(() => {
  // Defense: apply network controls + the fingerprint-gate registration now and
  // whenever the persona changes. Both follow the global active persona.
  const applyDefense = (settings: Parameters<typeof applyNetworkControls>[0]) => {
    void applyNetworkControls(settings);
    void applyFingerprintGateRegistration(settings);
  };
  void loadDefenseSettings().then(applyDefense);
  onDefenseSettingsChanged(applyDefense);
  if (browser.runtime.onInstalled) {
    browser.runtime.onInstalled.addListener(() =>
      void loadDefenseSettings().then(applyDefense),
    );
  }
  if (browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(() =>
      void loadDefenseSettings().then(applyDefense),
    );
  }

  // Auto-lock: an alarm fires at the chosen deadline even if the worker slept,
  // so a finite "Unlock for N" genuinely locks at N — not merely "survives
  // worker-death up to N". The alarm is (re)scheduled on unlock, cleared on lock.
  if (browser.alarms) {
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === AUTOLOCK_ALARM) {
        vault.lock();
        mind = null;
      }
    });
  }

  browser.runtime.onMessage.addListener(
    (msg: VaultMessage, _sender, sendResponse: (r: VaultResponse) => void) => {
      handle(msg).then(sendResponse, (err) =>
        sendResponse({ ok: false, error: String(err?.message ?? err) }),
      );
      return true; // async response
    },
  );
});

const AUTOLOCK_ALARM = 'alter-me-a-i.autolock';

/** Schedule (ttl>0), or clear (ttl 0/null), the auto-lock alarm. */
async function scheduleAutoLock(ttlMs: number | null | undefined): Promise<void> {
  if (!browser.alarms) return;
  await browser.alarms.clear(AUTOLOCK_ALARM);
  if (typeof ttlMs === 'number' && ttlMs > 0) {
    browser.alarms.create(AUTOLOCK_ALARM, { when: Date.now() + ttlMs });
  }
}

async function handle(msg: VaultMessage): Promise<VaultResponse> {
  // The worker may have been killed while a memory-only session is still live;
  // rehydrate the unlocked state before handling anything that needs the vault.
  await vault.restore();
  if (vault.isUnlocked()) await drainLockedBuffer();

  switch (msg.type) {
    case 'vault.status':
      return { ok: true, unlocked: vault.isUnlocked() };
    case 'auth.methods':
      return { ok: true, methods: await vault.methods() };
    case 'auth.webauthn.enroll':
      await vault.enrollWebauthn(
        new Uint8Array(msg.credentialId),
        new Uint8Array(msg.prfOutput),
        new Uint8Array(msg.prfSalt),
        msg.label,
      );
      return { ok: true };
    case 'auth.webauthn.unlock':
      await vault.unlockWithPrf(
        new Uint8Array(msg.credentialId),
        new Uint8Array(msg.prfOutput),
        msg.ttlMs ?? 0,
      );
      await scheduleAutoLock(msg.ttlMs ?? 0);
      await drainLockedBuffer(); // flush anything captured while locked
      return { ok: true, unlocked: true };
    case 'vault.unlock':
      await vault.unlock(msg.passphrase, msg.ttlMs ?? 0);
      await scheduleAutoLock(msg.ttlMs ?? 0);
      await drainLockedBuffer(); // flush anything captured while locked
      return { ok: true, unlocked: true };
    case 'vault.lock':
      vault.lock();
      mind = null; // drop the in-memory model when the vault locks
      await scheduleAutoLock(0); // cancel any pending auto-lock
      return { ok: true, unlocked: false };
    case 'vault.append': {
      // Locked? Hold the event in memory (never on disk) so the fire-and-forget
      // content script doesn't lose it; it lands in the vault on next unlock.
      if (!vault.isUnlocked()) {
        if (lockedBuffer.length < MAX_BUFFER) lockedBuffer.push(msg.event);
        return { ok: true, id: '' };
      }
      const id = await vault.append(msg.event);
      mind = null; // new data invalidates the cached model
      return { ok: true, id };
    }
    case 'vault.query':
      return { ok: true, events: await vault.query(msg.query) };
    case 'vault.stats':
      return { ok: true, stats: await vault.stats() };
    case 'vault.export':
      return { ok: true, events: await vault.export() };
    case 'vault.trajectories':
      return { ok: true, jsonl: await vault.exportJSONL(msg.options) };
    case 'vault.wipe':
      await vault.wipe();
      mind = null;
      return { ok: true };
    case 'mind.profile':
      return { ok: true, profile: (await getMind()).profile() };
    case 'mind.search':
      return { ok: true, hits: (await getMind()).search(msg.query, msg.k) };
    case 'mind.ask':
      return { ok: true, answer: (await getMind()).ask(msg.question, msg.k) };
  }
}
