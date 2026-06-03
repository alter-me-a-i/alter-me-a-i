/*
 * Personas — the defensive presets. A persona is a privacy profile: a named
 * bundle of flags controlling how much of you leaks to the sites you visit.
 * This is the "starve their pool" half of Alter/Me/A/I (offense = the vault; defense =
 * personas + blocking). Ported from the persona-privacy-filter reference into a
 * typed, single-source-of-truth module shared by background, content, and popup.
 */

/** One toggle per layer of leakage a persona can control. */
export interface PersonaProfile {
  id: PersonaId;
  name: string;
  emoji: string;
  tagline: string;
  /** Enable the declarativeNetRequest tracker blocklist. */
  blockTrackers: boolean;
  /** Strip Cookie / Set-Cookie on cross-site (third-party) requests. */
  blockThirdPartyCookies: boolean;
  /** Remove known tracking params from URLs and links. */
  stripUrlParams: boolean;
  /** Drop the Referer header on cross-site requests. */
  spoofReferrer: boolean;
  /** Normalize passively-readable device fingerprint signals (CPU, platform…). */
  normalizeFingerprint: boolean;
}

export type PersonaId = 'ghost' | 'pseudonym' | 'casual' | 'custom' | 'open';

/** The five user-tunable defense flags — the knobs the Custom persona exposes. */
export type GateFlag =
  | 'blockTrackers'
  | 'blockThirdPartyCookies'
  | 'stripUrlParams'
  | 'spoofReferrer'
  | 'normalizeFingerprint';

/** Reading/UI order for the tunable flags. */
export const GATE_FLAGS: GateFlag[] = [
  'blockTrackers',
  'blockThirdPartyCookies',
  'stripUrlParams',
  'spoofReferrer',
  'normalizeFingerprint',
];

/** Just the flag subset of a profile — what Custom stores and edits. */
export type CustomFlags = Pick<PersonaProfile, GateFlag>;

export const PERSONA_PROFILES: Record<PersonaId, PersonaProfile> = {
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    emoji: '👻',
    tagline: 'Share almost nothing',
    blockTrackers: true,
    blockThirdPartyCookies: true,
    stripUrlParams: true,
    spoofReferrer: true,
    normalizeFingerprint: true,
  },
  pseudonym: {
    id: 'pseudonym',
    name: 'Pseudonym',
    emoji: '🕶️',
    tagline: 'Blend into the crowd',
    blockTrackers: true,
    blockThirdPartyCookies: true,
    stripUrlParams: true,
    spoofReferrer: false,
    normalizeFingerprint: true,
  },
  casual: {
    id: 'casual',
    name: 'Casual',
    emoji: '🙂',
    tagline: 'Make yourself known',
    blockTrackers: true,
    blockThirdPartyCookies: false,
    stripUrlParams: true,
    spoofReferrer: false,
    normalizeFingerprint: false,
  },
  // Metadata + DEFAULT flags for Custom. The live flags come from
  // DefenseSettings.custom and are merged in via settings.profileFor().
  custom: {
    id: 'custom',
    name: 'Custom',
    emoji: '🎛️',
    tagline: 'Your own mix',
    blockTrackers: true,
    blockThirdPartyCookies: true,
    stripUrlParams: true,
    spoofReferrer: false,
    normalizeFingerprint: true,
  },
  open: {
    id: 'open',
    name: 'Open',
    emoji: '🌐',
    tagline: 'Filtering off',
    blockTrackers: false,
    blockThirdPartyCookies: false,
    stripUrlParams: false,
    spoofReferrer: false,
    normalizeFingerprint: false,
  },
};

export const PERSONA_ORDER: PersonaId[] = ['ghost', 'pseudonym', 'casual', 'custom', 'open'];
export const DEFAULT_PERSONA: PersonaId = 'pseudonym';

export function getProfile(id: string | undefined): PersonaProfile {
  return PERSONA_PROFILES[(id as PersonaId)] ?? PERSONA_PROFILES[DEFAULT_PERSONA];
}

/** Known tracking query parameters stripped when stripUrlParams is on. */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_cid', 'utm_reader', 'utm_referrer', 'utm_social',
  'utm_social-type', 'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
  'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'igsh', '_hsenc', '_hsmi',
  'vero_id', 'vero_conv', 'oly_anon_id', 'oly_enc_id', 'yclid', 'ysclid',
  '_openstat', 'wickedid', 'twclid', 'rb_clickid', 's_cid', 'ml_subscriber',
  'ml_subscriber_hash', 'spm', 'scm', 'ref_src', 'ref_url',
]);
