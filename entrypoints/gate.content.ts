/*
 * Fingerprint gate — MAIN-world injection.
 *
 * This runs in the PAGE's JavaScript world (not the isolated content-script
 * world) at document_start, BEFORE the page's own scripts, so that when the
 * page reads navigator.hardwareConcurrency etc. it sees our normalized values.
 * Overriding navigator in the isolated world would be invisible to the page —
 * MAIN world is the only place this gating is real.
 *
 * It is registered/unregistered at RUNTIME by the background worker depending on
 * the active persona (see lib/defense/gate-registration.ts), so the manifest
 * never claims it statically. MAIN world has no chrome.* APIs, so it cannot read
 * settings or touch the vault directly; it applies the constant conservative
 * plan and hands the result to the isolated-world bridge via a DOM event, which
 * records the disclosure. The dispatch is deferred to DOMContentLoaded so the
 * bridge's document_start listener is guaranteed to be attached first.
 */

import { applyFingerprintGate, CONSERVATIVE_GATE } from '../lib/defense/fingerprint';
import { GATE_CHANNEL, type GateMessage } from '../lib/defense/gate-bridge-protocol';

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',
  registration: 'runtime', // background decides when this is active
  allFrames: false,
  main() {
    const gated = applyFingerprintGate(
      {
        navigator: navigator as unknown as Record<string, unknown>,
        window: window as unknown as Record<string, unknown>,
        screen: screen as unknown as Record<string, unknown>,
      },
      CONSERVATIVE_GATE,
    );
    if (gated.length === 0) return;

    // Tell the isolated-world bridge what we gated so it can log a disclosure.
    // postMessage (not CustomEvent) because a CustomEvent's detail does NOT
    // survive the MAIN↔isolated world crossing. Posting immediately is safe:
    // the message queues until the bridge's listener (attached at
    // document_start) drains it, so there is no ordering race.
    const msg: GateMessage = { channel: GATE_CHANNEL, gated, url: location.href };
    window.postMessage(msg, location.origin);
  },
});
