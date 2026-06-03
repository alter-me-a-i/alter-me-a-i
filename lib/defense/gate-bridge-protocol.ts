/*
 * Shared protocol for the MAIN-world fingerprint gate to hand its result to the
 * isolated-world bridge. Kept in one tiny module so both ends import the exact
 * same constants and can never drift apart.
 *
 * We use window.postMessage rather than a CustomEvent: a CustomEvent's `detail`
 * object is NOT structured-cloned across the MAIN↔isolated world boundary (the
 * isolated listener receives the event but reads detail === null), whereas
 * postMessage serializes its payload correctly across worlds. The bridge filters
 * on `event.source === window` and our `channel` tag to ignore unrelated posts.
 *
 * Tradeoff note: postMessage on window is observable by the page, so a
 * determined fingerprinter could detect that Alter/Me/A/I is present. That is inherent
 * to any MAIN↔isolated bridge; for the conservative first cut we accept it.
 */

/** Discriminator tagging our messages among all window.postMessage traffic. */
export const GATE_CHANNEL = 'alter-me-a-i:fp-gate';

/** The message payload posted by the MAIN-world gate. */
export interface GateMessage {
  channel: typeof GATE_CHANNEL;
  /** Labels of the fingerprint fields actually normalized. */
  gated: string[];
  /** The page URL at the time of gating. */
  url: string;
}

/** Type guard: is this postMessage one of ours? */
export function isGateMessage(data: unknown): data is GateMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { channel?: unknown }).channel === GATE_CHANNEL &&
    Array.isArray((data as { gated?: unknown }).gated)
  );
}
