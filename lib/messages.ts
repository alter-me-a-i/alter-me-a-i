/*
 * Message protocol between contexts (popup/content) and the background worker,
 * which is the single owner of the unlocked vault. Keeping one typed contract
 * here means both ends stay in sync.
 */

import { browser } from 'wxt/browser';
import type {
  CortexEvent,
  EventQuery,
  NewEvent,
  TrajectoryOptions,
  VaultStats,
} from './vault';
import type { Answer, MindProfile, SearchHit } from './mind';

/** Enrolled unlock method, surfaced to the popup (no secrets). */
export interface AuthMethodInfo {
  id: string;
  method: 'passphrase' | 'webauthn';
  label: string;
}

export type VaultMessage =
  | { type: 'vault.status' }
  // ttlMs: how long to keep unlocked across worker restarts. 0 = until idle,
  // a number = ms, null = until the browser closes. Optional (defaults to 0).
  | { type: 'vault.unlock'; passphrase: string; ttlMs?: number | null }
  | { type: 'vault.lock' }
  | { type: 'vault.append'; event: NewEvent }
  | { type: 'vault.query'; query?: EventQuery }
  | { type: 'vault.stats' }
  | { type: 'vault.export' }
  | { type: 'vault.trajectories'; options?: TrajectoryOptions }
  | { type: 'vault.wipe' }
  // Auth — passkey enrollment/unlock. PRF bytes are computed in the popup
  // (navigator.credentials) and passed here as number[] for the vault to use.
  | { type: 'auth.methods' }
  | { type: 'auth.webauthn.enroll'; credentialId: number[]; prfOutput: number[]; prfSalt: number[]; label?: string }
  | { type: 'auth.webauthn.unlock'; credentialId: number[]; prfOutput: number[]; ttlMs?: number | null }
  // Mind — the personal model layer (built on demand from the unlocked vault).
  | { type: 'mind.profile' }
  | { type: 'mind.search'; query: string; k?: number }
  | { type: 'mind.ask'; question: string; k?: number };

export type VaultResponse =
  | { ok: true; unlocked: boolean } // status / unlock / lock
  | { ok: true; id: string } // append
  | { ok: true; events: CortexEvent[] } // query / export
  | { ok: true; stats: VaultStats } // stats
  | { ok: true; jsonl: string } // trajectories
  | { ok: true; profile: MindProfile } // mind.profile
  | { ok: true; hits: SearchHit[] } // mind.search
  | { ok: true; answer: Answer } // mind.ask
  | { ok: true; methods: AuthMethodInfo[] } // auth.methods
  | { ok: true } // wipe / enroll
  | { ok: false; error: string };

export function sendToBackground(msg: VaultMessage): Promise<VaultResponse> {
  return browser.runtime.sendMessage(msg) as Promise<VaultResponse>;
}
