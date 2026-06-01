/*
 * The permission gate — the membrane's doorman.
 *
 * Per SUITE-MAP's load-bearing rule: data is read ONLY through a checkable
 * grant — explicit, scoped (to WHAT + for HOW LONG), revocable, default-deny.
 * Nothing — not even Cortex's own interpreter (the Mind), export, or training —
 * touches the corpus without a grant whose scope covers the request.
 *
 * This module is PURE: grant/scope types + the matching logic, no IO, no crypto.
 * The vault holds the live grants and consults `grantAllows()` before returning
 * data; consumers pass a grant id. Generic by design so the SAME engine governs
 * internal consumers (Mind/export/training) now and external ones (connectors,
 * sites, proxies) later — they differ only in the scope they're issued.
 */

import type { EventType, Sensitivity, Stream } from './types';

const SENSITIVITY_RANK: Record<Sensitivity, number> = {
  public: 0,
  personal: 1,
  sensitive: 2,
  secret: 3,
};

/**
 * What a grant is allowed to read. Every field NARROWS access; an omitted field
 * means "no restriction on this axis". An empty `types`/`streams` array means
 * "none" (default-deny is the gate's job, but an explicit empty list = nothing).
 */
export interface GrantScope {
  /** Allowed event types. Undefined = all types. */
  types?: EventType[];
  /** Allowed source streams. Undefined = all streams. */
  streams?: Stream[];
  /** Highest sensitivity readable. Undefined = 'secret' (everything). */
  maxSensitivity?: Sensitivity;
  /** Only events at/after this epoch-ms. */
  since?: number;
  /** Only events at/before this epoch-ms. */
  until?: number;
}

/** A live permission grant held by the vault. */
export interface Grant {
  /** Stable id the consumer presents on each request. */
  id: string;
  /** Human label for any future management UI ("Training export", "Mind"). */
  label: string;
  scope: GrantScope;
  /** Epoch-ms the grant was issued. */
  grantedAt: number;
  /**
   * Optional own expiry (epoch-ms). Undefined = session-tied: lives until the
   * vault locks (the default — best UX, reuses the lock model). A value gives a
   * tighter window for grants that need it (e.g. an external party for 10 min).
   */
  expiresAt?: number;
}

/** Is the grant live at time `now`? (Session-tied grants never self-expire.) */
export function grantLive(grant: Grant, now: number): boolean {
  return grant.expiresAt == null || now < grant.expiresAt;
}

/**
 * Does this grant's scope permit reading this event? Pure predicate — the gate
 * filters query results through it so a consumer only ever SEES in-scope data.
 */
export function scopeAllows(
  scope: GrantScope,
  event: { type: EventType; stream?: Stream; sensitivity: Sensitivity; ts: number },
): boolean {
  if (scope.types && !scope.types.includes(event.type)) return false;
  const stream = event.stream ?? 'web';
  if (scope.streams && !scope.streams.includes(stream)) return false;
  const ceiling = scope.maxSensitivity ?? 'secret';
  if (SENSITIVITY_RANK[event.sensitivity] > SENSITIVITY_RANK[ceiling]) return false;
  if (scope.since != null && event.ts < scope.since) return false;
  if (scope.until != null && event.ts > scope.until) return false;
  return true;
}

/**
 * Convenience: a grant fully allows an event iff it's live AND its scope covers
 * the event. The vault uses this per-record while decrypting a query.
 */
export function grantAllows(
  grant: Grant,
  event: { type: EventType; stream?: Stream; sensitivity: Sensitivity; ts: number },
  now: number,
): boolean {
  return grantLive(grant, now) && scopeAllows(grant.scope, event);
}

/** Error thrown when a consumer presents no/invalid/expired grant. */
export class PermissionDenied extends Error {
  constructor(reason: string) {
    super(`Permission denied: ${reason}`);
    this.name = 'PermissionDenied';
  }
}
