/*
 * Capture settings — shared by the content script (which obeys them) and the
 * popup (which edits them). Stored in storage.local so both contexts read the
 * same source of truth and can react to live changes via storage.onChanged.
 *
 * Capture is a power the user grants, not a default we assume. It's on out of
 * the box because the whole point is to grow your pool — but it's one toggle
 * from off, and individual sites can be excluded.
 */

import { browser } from 'wxt/browser';

export interface CaptureSettings {
  /** Master switch. When false, nothing is captured anywhere. */
  enabled: boolean;
  /** Normalized hosts that are never captured (e.g. you added your bank). */
  excludeHosts: string[];
  /** Capture text selections (high-signal but more content-heavy). */
  captureSelections: boolean;
  /** Capture prompts/responses on AI surfaces. */
  captureAi: boolean;
}

export const DEFAULT_CAPTURE: CaptureSettings = {
  enabled: true,
  excludeHosts: [],
  captureSelections: true,
  captureAi: true,
};

const KEY = 'cortex.capture.settings';

export async function loadCaptureSettings(): Promise<CaptureSettings> {
  const stored = await browser.storage.local.get(KEY);
  return { ...DEFAULT_CAPTURE, ...(stored[KEY] as Partial<CaptureSettings>) };
}

export async function saveCaptureSettings(
  patch: Partial<CaptureSettings>,
): Promise<CaptureSettings> {
  const next = { ...(await loadCaptureSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function onCaptureSettingsChanged(
  cb: (settings: CaptureSettings) => void,
): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area === 'local' && changes[KEY]) {
      cb({ ...DEFAULT_CAPTURE, ...(changes[KEY].newValue as Partial<CaptureSettings>) });
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
