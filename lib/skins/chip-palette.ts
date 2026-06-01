/*
 * Chip palette — the subset of skin colours the on-page status bar needs.
 *
 * The full skin tokens live in entrypoints/popup/skins.css (CSS only), which a
 * content script on an arbitrary web page cannot read. So the bar resolves its
 * colours from this small TS map instead, keyed by skin id × mode. Keep these in
 * sync with skins.css for the same ids — only the few values the bar uses:
 *   bg/border/fg for the surface, on/off for the value states.
 */

import type { Mode } from './index';

export interface ChipColors {
  bg: string;
  border: string;
  fg: string;
  muted: string;
  on: string; // active value (capture on, unlocked, protecting)
  off: string; // inactive value (off, locked, open)
}

/* Per-skin font + styling so the bar carries the skin's character, not just its
   colours. font is the CSS stack; radius/letterSpacing/uppercase shape the feel
   (pixel skins want square corners + tracking; clean skins want soft + tight).
   Pixel fonts are bundled (VT323 etc.) — the bar references them by family name;
   the content script loads them via an injected @font-face (see chip). */
export interface ChipStyle {
  font: string;
  radius: string;
  /** Extra letter-spacing for the value text (px). */
  tracking: string;
  /** Bump value font-size for condensed pixel fonts. */
  fontSize: string;
}

type ByMode = Record<Mode, ChipColors>;

const SYS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const PIXEL = "'PixelBody', ui-monospace, monospace";
const EURO = "'Eurostyle', system-ui, sans-serif";

export const CHIP_STYLE: Record<string, ChipStyle> = {
  synthwave: { font: SYS, radius: '8px', tracking: '0', fontSize: '11px' },
  vaporwave: { font: SYS, radius: '8px', tracking: '0', fontSize: '11px' },
  daylight: { font: SYS, radius: '8px', tracking: '0', fontSize: '11px' },
  terminal: { font: PIXEL, radius: '0px', tracking: '0.04em', fontSize: '15px' },
  commodore64: { font: PIXEL, radius: '0px', tracking: '0.04em', fontSize: '15px' },
  iskin: { font: EURO, radius: '10px', tracking: '0.03em', fontSize: '11px' },
};

export function chipStyle(skinId: string): ChipStyle {
  return CHIP_STYLE[skinId] ?? CHIP_STYLE.synthwave;
}

export const CHIP_PALETTE: Record<string, ByMode> = {
  synthwave: {
    dark: { bg: 'rgba(18,14,36,0.94)', border: 'rgba(140,120,200,0.4)', fg: '#fdf2ff', muted: '#a89ad0', on: '#00f0a8', off: '#ff8a9c' },
    light: { bg: 'rgba(255,243,247,0.96)', border: 'rgba(224,17,122,0.35)', fg: '#2a0f24', muted: '#8a3d62', on: '#0a9e78', off: '#c1364a' },
  },
  vaporwave: {
    dark: { bg: 'rgba(43,16,85,0.94)', border: 'rgba(255,113,206,0.4)', fg: '#f5e9ff', muted: '#c9b3f0', on: '#05ffa1', off: '#ff8a9c' },
    light: { bg: 'rgba(254,240,251,0.96)', border: 'rgba(224,51,158,0.35)', fg: '#43215c', muted: '#8b5a93', on: '#0a9e78', off: '#c1364a' },
  },
  daylight: {
    light: { bg: 'rgba(255,255,255,0.97)', border: 'rgba(85,98,234,0.35)', fg: '#16181d', muted: '#5c6470', on: '#2f9e6f', off: '#c14a44' },
    dark: { bg: 'rgba(15,17,22,0.95)', border: 'rgba(139,148,255,0.4)', fg: '#eaecf0', muted: '#a2a9b4', on: '#4cc08a', off: '#e0726c' },
  },
  terminal: {
    dark: { bg: 'rgba(0,0,0,0.96)', border: '#0d4d0d', fg: '#33ff33', muted: '#1faa1f', on: '#39ff14', off: '#ff3333' },
    light: { bg: 'rgba(243,247,239,0.97)', border: 'rgba(31,156,15,0.4)', fg: '#173b17', muted: '#3c6b3c', on: '#1f9c0f', off: '#c1364a' },
  },
  commodore64: {
    dark: { bg: 'rgba(62,49,162,0.95)', border: '#7a6cf0', fg: '#b8b0ff', muted: '#9a90e8', on: '#a8ff60', off: '#ff7770' },
    light: { bg: 'rgba(214,208,255,0.97)', border: '#9a8ee0', fg: '#2e2270', muted: '#51449e', on: '#2f7d00', off: '#c1364a' },
  },
  iskin: {
    light: { bg: 'rgba(255,255,255,0.97)', border: 'rgba(245,106,28,0.4)', fg: '#4a2410', muted: '#9a5a30', on: '#1ba86a', off: '#e0506b' },
    dark: { bg: 'rgba(31,18,8,0.95)', border: 'rgba(255,138,61,0.45)', fg: '#ffe9d6', muted: '#d2a37a', on: '#2ce08a', off: '#ff6b81' },
  },
};

/** Resolve chip colours for a skin id × mode, falling back to synthwave-dark. */
export function chipColors(skinId: string, mode: Mode): ChipColors {
  return CHIP_PALETTE[skinId]?.[mode] ?? CHIP_PALETTE.synthwave.dark;
}
