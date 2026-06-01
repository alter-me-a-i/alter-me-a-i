/*
 * Fingerprint gate bridge — isolated world.
 *
 * The MAIN-world gate (entrypoints/gate.content.ts) can't reach chrome.* or the
 * vault, so after it normalizes the device it dispatches a DOM CustomEvent. This
 * bridge — an ordinary isolated-world content script with the usual extension
 * APIs — listens for that event and records a `disclosure` event in the vault,
 * so the act of defending becomes training signal (the same offense/defense
 * synergy as URL stripping in lib/defense/content.ts).
 *
 * Registered statically: it's harmless when the gate isn't active (it simply
 * never hears the event), so it needs no per-persona registration of its own.
 * It listens at document_start to be ready before the gate announces.
 */

import { isGateMessage } from '../lib/defense/gate-bridge-protocol';
import { sendToBackground } from '../lib/messages';
import type { NewEvent } from '../lib/vault';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: false,
  main() {
    const host = location.hostname.replace(/^www\./i, '');
    const onMessage = (e: MessageEvent) => {
      // Only trust same-window posts carrying our channel tag.
      if (e.source !== window || !isGateMessage(e.data)) return;
      if (e.data.gated.length === 0) return;
      window.removeEventListener('message', onMessage); // one disclosure per load
      const event: NewEvent = {
        type: 'disclosure',
        source: { host, url: e.data.url || location.href },
        sensitivity: 'personal',
        decision: 'redacted',
        field: `fingerprint:${e.data.gated.join(',')}`,
        policy: 'fingerprint-gate',
      };
      // Fire-and-forget; a locked vault buffers it (background lockedBuffer).
      void sendToBackground({ type: 'vault.append', event }).catch(() => {});
    };
    window.addEventListener('message', onMessage);
  },
});
