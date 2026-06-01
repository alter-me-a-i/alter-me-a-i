/*
 * Defense settings — the active persona plus per-site overrides. Stored in
 * storage.local so background (network rules), content (URL stripping), and
 * popup (the picker) all read one source of truth and react to live changes.
 */

import { browser } from 'wxt/browser';
import {
  DEFAULT_PERSONA,
  getProfile,
  PERSONA_PROFILES,
  type CustomFlags,
  type PersonaId,
  type PersonaProfile,
} from './personas';

export interface DefenseSettings {
  /** Master switch — when false, defense is fully off (acts as Open). */
  enabled: boolean;
  /** The persona applied by default. */
  activePersona: PersonaId;
  /** Per-host persona overrides, keyed by normalized host. */
  perSite: Record<string, PersonaId>;
  /** The user's Custom-persona flag mix. Seeded from the Custom defaults. */
  custom: CustomFlags;
}

/** Pull just the five tunable flags out of the Custom profile metadata. */
function defaultCustomFlags(): CustomFlags {
  const p = PERSONA_PROFILES.custom;
  return {
    blockTrackers: p.blockTrackers,
    blockThirdPartyCookies: p.blockThirdPartyCookies,
    stripUrlParams: p.stripUrlParams,
    spoofReferrer: p.spoofReferrer,
    normalizeFingerprint: p.normalizeFingerprint,
  };
}

export const DEFAULT_DEFENSE: DefenseSettings = {
  enabled: true,
  activePersona: DEFAULT_PERSONA,
  perSite: {},
  custom: defaultCustomFlags(),
};

const KEY = 'cortex.defense.settings';

/** Merge stored settings over defaults, deep-merging the nested `custom` flags. */
function hydrate(stored: Partial<DefenseSettings> | undefined): DefenseSettings {
  return {
    ...DEFAULT_DEFENSE,
    ...stored,
    custom: { ...DEFAULT_DEFENSE.custom, ...(stored?.custom ?? {}) },
  };
}

export async function loadDefenseSettings(): Promise<DefenseSettings> {
  const stored = await browser.storage.local.get(KEY);
  return hydrate(stored[KEY] as Partial<DefenseSettings> | undefined);
}

export async function saveDefenseSettings(
  patch: Partial<DefenseSettings>,
): Promise<DefenseSettings> {
  const next = { ...(await loadDefenseSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** Resolve the effective persona for a host (per-site override beats global). */
export function resolvePersonaId(settings: DefenseSettings, host: string): PersonaId {
  if (!settings.enabled) return 'open';
  const key = host.replace(/^www\./i, '').toLowerCase();
  return settings.perSite[key] ?? settings.activePersona;
}

/**
 * Resolve a profile for a persona id, injecting the user's live Custom flags
 * when the id is 'custom' (the stored PERSONA_PROFILES.custom only holds the
 * defaults + metadata). This is the single place custom flags become a profile.
 */
export function profileFor(settings: DefenseSettings, id: PersonaId): PersonaProfile {
  const base = getProfile(id);
  if (id !== 'custom') return base;
  return { ...base, ...settings.custom };
}

/** Resolve the effective profile for a host (per-site override beats global). */
export function resolveProfile(settings: DefenseSettings, host: string): PersonaProfile {
  return profileFor(settings, resolvePersonaId(settings, host));
}

export function onDefenseSettingsChanged(
  cb: (settings: DefenseSettings) => void,
): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area === 'local' && changes[KEY]) {
      cb(hydrate(changes[KEY].newValue as Partial<DefenseSettings> | undefined));
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
