/*
 * Vault session persistence — keeps the unlocked master key alive across the
 * service-worker's ~30s idle shutdown, for a user-chosen window.
 *
 * PRIVACY: this uses chrome.storage.session, which is MEMORY-ONLY — never
 * written to disk, wiped when the browser fully closes. So the key is exactly
 * as private as the worker memory it stands in for; on-disk data still requires
 * a fresh unlock. We store the raw VMK bytes + an absolute expiry timestamp.
 *
 * "Until browser closes" = no expiry (session storage clears itself on quit).
 * Any timed choice = expiry now+ttl; restore refuses an expired session.
 */

import { browser } from 'wxt/browser';

const SESSION_KEY = 'cortex.vault.session';

interface SessionBlob {
  /** Master key bytes as a plain array (structured-clonable in session store). */
  vmk: number[];
  /** Absolute epoch-ms after which the session is dead; null = until browser quit. */
  expiresAt: number | null;
}

/** Is memory-only session storage available? (Chrome 102+, MV3.) */
function sessionAvailable(): boolean {
  return !!browser.storage?.session;
}

/** Persist the unlocked key for `ttlMs` (null = until the browser closes). */
export async function saveSession(vmk: Uint8Array, ttlMs: number | null): Promise<void> {
  if (!sessionAvailable()) return;
  const blob: SessionBlob = {
    vmk: Array.from(vmk),
    expiresAt: ttlMs == null ? null : Date.now() + ttlMs,
  };
  await browser.storage.session.set({ [SESSION_KEY]: blob });
}

/**
 * Return the stored key if a live (non-expired) session exists, else null.
 * Clears the session if it has expired.
 */
export async function loadSession(): Promise<Uint8Array | null> {
  if (!sessionAvailable()) return null;
  const stored = await browser.storage.session.get(SESSION_KEY);
  const blob = stored[SESSION_KEY] as SessionBlob | undefined;
  if (!blob) return null;
  if (blob.expiresAt != null && Date.now() >= blob.expiresAt) {
    await clearSession();
    return null;
  }
  return new Uint8Array(blob.vmk);
}

/** Remaining ms before the session expires (Infinity if none/until-quit, 0 if dead). */
export async function sessionRemainingMs(): Promise<number> {
  if (!sessionAvailable()) return 0;
  const stored = await browser.storage.session.get(SESSION_KEY);
  const blob = stored[SESSION_KEY] as SessionBlob | undefined;
  if (!blob) return 0;
  if (blob.expiresAt == null) return Infinity;
  return Math.max(0, blob.expiresAt - Date.now());
}

export async function clearSession(): Promise<void> {
  if (!sessionAvailable()) return;
  await browser.storage.session.remove(SESSION_KEY);
}
