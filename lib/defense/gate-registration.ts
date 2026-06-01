/*
 * Runtime (un)registration of the MAIN-world fingerprint gate, driven by the
 * active persona. Runs in the background worker.
 *
 * The gate script can't be a static content script: it must be present only
 * when the active persona normalizes fingerprints, and absent otherwise (so
 * "Open" and "Casual" genuinely expose the real device). declarativeNetRequest
 * is global, and so is this — it follows settings.activePersona, mirroring the
 * documented global-scope limitation of the network rules.
 *
 * Idempotent: re-applying the same desired state is a no-op, so this can be
 * called freely on settings changes without thrashing registrations.
 */

import { browser } from 'wxt/browser';
import { DEFAULT_DEFENSE, profileFor, type DefenseSettings } from './settings';

/** Must match the generated script path for entrypoints/gate.content.ts. */
const GATE_SCRIPT_ID = 'cortex-fp-gate';
const GATE_JS = 'content-scripts/gate.js';

/** Should the gate be active for the current (global) defense settings? */
function gateWanted(settings: DefenseSettings): boolean {
  if (!settings.enabled) return false;
  return profileFor(settings, settings.activePersona).normalizeFingerprint;
}

async function isRegistered(): Promise<boolean> {
  const scripting = browser.scripting;
  if (!scripting?.getRegisteredContentScripts) return false;
  try {
    const scripts = await scripting.getRegisteredContentScripts({ ids: [GATE_SCRIPT_ID] });
    return scripts.length > 0;
  } catch {
    return false;
  }
}

/** Bring the gate registration in line with the desired persona state. */
export async function applyFingerprintGateRegistration(
  settings: DefenseSettings = DEFAULT_DEFENSE,
): Promise<void> {
  const scripting = browser.scripting;
  if (!scripting?.registerContentScripts) return; // older browser — skip silently

  const want = gateWanted(settings);
  const have = await isRegistered();
  if (want === have) return; // idempotent: nothing to change

  try {
    if (want) {
      await scripting.registerContentScripts([
        {
          id: GATE_SCRIPT_ID,
          js: [GATE_JS],
          matches: ['<all_urls>'],
          runAt: 'document_start',
          world: 'MAIN',
          allFrames: false,
        } as any, // `world` is valid in MV3 but missing from some lib typings
      ]);
    } else {
      await scripting.unregisterContentScripts({ ids: [GATE_SCRIPT_ID] });
    }
  } catch (err) {
    console.warn('[Cortex] fingerprint gate registration failed:', err);
  }
}
