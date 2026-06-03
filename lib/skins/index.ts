/*
 * Skin registry + persistence.
 *
 * A skin is just a named set of CSS tokens defined in entrypoints/popup/skins.css
 * under [data-skin='<id>']. This module is the single source of truth for WHICH
 * skins exist and which one is active. To add a skin: add its [data-skin] block
 * in skins.css, then add one entry to SKINS here.
 *
 * The active skin id is stored in chrome.storage.local so it persists and could
 * later sync; applying it is just setting <html data-skin="…">.
 */

import { browser } from 'wxt/browser';

export type Mode = 'dark' | 'light';

export interface Skin {
  /** Must match the [data-skin='<id>'] selector in skins.css. */
  id: string;
  /** Human-facing name shown in the picker. */
  name: string;
  /** One-line flavour, shown under the name. */
  blurb: string;
  /** The mode a skin opens in if the user hasn't chosen one. */
  defaultMode: Mode;
}

/** Registry. Each skin defines BOTH a light and dark variant in skins.css. */
export const SKINS: Skin[] = [
  // Order = picker layout (3 across): Daylight·Synthwave·Vaporwave / Terminal·C64·iSkin.
  { id: 'daylight', name: 'Daylight', blurb: 'Clean & neutral', defaultMode: 'light' },
  { id: 'synthwave', name: 'Synthwave', blurb: '80s neon · sunset', defaultMode: 'dark' },
  { id: 'vaporwave', name: 'Vaporwave', blurb: 'Pastel pink & cyan dream', defaultMode: 'dark' },
  { id: 'terminal', name: 'Terminal', blurb: 'Green-phosphor CRT', defaultMode: 'dark' },
  { id: 'commodore64', name: 'C64', blurb: '8-bit · pixel font', defaultMode: 'dark' },
  { id: 'iskin', name: 'iSkin', blurb: '90s iMac · Tangerine', defaultMode: 'light' },
];

export const DEFAULT_SKIN = 'synthwave';

const SKIN_KEY = 'alter-me-a-i.skin';
const MODE_KEY = 'alter-me-a-i.mode';

/** Resolve an id to a known skin, falling back to the default. */
export function getSkin(id: string | undefined | null): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN)!;
}

export async function loadSkinId(): Promise<string> {
  try {
    const stored = await browser.storage.local.get(SKIN_KEY);
    return getSkin(stored[SKIN_KEY] as string | undefined).id;
  } catch {
    return DEFAULT_SKIN;
  }
}

export async function saveSkinId(id: string): Promise<void> {
  await browser.storage.local.set({ [SKIN_KEY]: getSkin(id).id });
}

/** Stored mode, or null if the user hasn't explicitly chosen one. */
export async function loadMode(): Promise<Mode | null> {
  try {
    const stored = await browser.storage.local.get(MODE_KEY);
    const m = stored[MODE_KEY];
    return m === 'dark' || m === 'light' ? m : null;
  } catch {
    return null;
  }
}

export async function saveMode(mode: Mode): Promise<void> {
  await browser.storage.local.set({ [MODE_KEY]: mode });
}

/** Apply skin + mode to the document via data attributes. */
export function applyTheme(id: string, mode: Mode): void {
  const root = document.documentElement;
  root.setAttribute('data-skin', getSkin(id).id);
  root.setAttribute('data-mode', mode);
}

/** Load stored skin + mode and apply. Mode falls back to the skin's default. */
export async function initSkin(): Promise<{ id: string; mode: Mode }> {
  const id = await loadSkinId();
  const mode = (await loadMode()) ?? getSkin(id).defaultMode;
  applyTheme(id, mode);
  return { id, mode };
}
