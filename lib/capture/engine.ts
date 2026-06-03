/*
 * The capture engine — the offensive spine, plus the content-side trigger for
 * the defensive layer. Runs inside the page and:
 *   - turns your behavior into AlterMeAIEvents (offense → vault), and
 *   - strips tracking params per the active persona (defense → starve their pool),
 *     emitting a disclosure event when it does (defense feeds the corpus).
 *
 * This file owns ORCHESTRATION only: master switches, per-host exclusion,
 * top-frame guard, fire-and-forget delivery, and live re-arm on settings change.
 * The page-reading and URL-stripping logic live in ./modules and ../defense
 * (both free of extension imports so they can be unit-tested under a sim DOM).
 */

import type { NewEvent } from '../vault/types';
import { sendToBackground } from '../messages';
import { normalizeHost } from './hosts';
import { MODULES, type Ctx } from './modules';
import {
  loadCaptureSettings,
  onCaptureSettingsChanged,
  type CaptureSettings,
} from './settings';
import { startUrlDefense } from '../defense/content';
import {
  loadDefenseSettings,
  onDefenseSettingsChanged,
  resolvePersonaId,
  resolveProfile,
  type DefenseSettings,
} from '../defense/settings';

export async function runCapture(): Promise<void> {
  // Only operate in the top frame — skip ads/embeds in iframes.
  if (window.top !== window.self) return;

  const host = normalizeHost(location.hostname);

  // Shared delivery: fire-and-forget; a locked vault just rejects the append.
  const report = (event: NewEvent) => {
    void sendToBackground({ type: 'vault.append', event }).catch(() => {});
  };

  // --- offense: behavioral capture --------------------------------------
  let captureCleanups: Array<() => void> = [];
  const teardownCapture = () => {
    captureCleanups.forEach((c) => runSafe(c));
    captureCleanups = [];
  };
  const armCapture = (settings: CaptureSettings) => {
    teardownCapture();
    if (!settings.enabled || settings.excludeHosts.includes(host)) return;
    const ctx: Ctx = { host, settings, report };
    for (const start of MODULES) {
      try {
        captureCleanups.push(start(ctx));
      } catch {
        /* a broken module never breaks the others */
      }
    }
  };

  // --- defense: URL tracking-param stripping ----------------------------
  let defenseCleanup: (() => void) | null = null;
  const teardownDefense = () => {
    if (defenseCleanup) runSafe(defenseCleanup);
    defenseCleanup = null;
  };
  const armDefense = (settings: DefenseSettings) => {
    teardownDefense();
    try {
      defenseCleanup = startUrlDefense({
        host,
        personaId: resolvePersonaId(settings, host),
        profile: resolveProfile(settings, host),
        report,
      });
    } catch {
      /* defense failure never breaks capture */
    }
  };

  const [capture, defense] = await Promise.all([
    loadCaptureSettings(),
    loadDefenseSettings(),
  ]);
  armCapture(capture);
  armDefense(defense);
  onCaptureSettingsChanged(armCapture);
  onDefenseSettingsChanged(armDefense);
}

function runSafe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* ignore */
  }
}
