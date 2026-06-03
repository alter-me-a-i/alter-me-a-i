/*
 * Plain-English explanations of what a persona protects AND what it may cost —
 * written for a non-technical reader (think: explaining it to a parent). Kept in
 * one place so the wording is auditable, and DERIVED from each persona's real
 * flags so the description can never drift from what the code actually does. If
 * a flag flips, the human text follows automatically.
 */

import type { GateFlag, PersonaProfile } from './personas';
import { GATE_FLAGS } from './personas';

/** One protection, in plain words: what it hides, what it might cost. */
export interface FlagExplanation {
  flag: GateFlag;
  /** Short control label (used in the Custom toggle list). */
  label: string;
  /** What turning it on hides. */
  hides: string;
  /** Real-life convenience you might give up. Empty string = "nothing notable". */
  tradeoff: string;
}

/** Order matches GATE_FLAGS — the reading order everywhere in the UI. */
export const FLAG_EXPLANATIONS: Record<GateFlag, FlagExplanation> = {
  blockTrackers: {
    flag: 'blockTrackers',
    label: 'Block hidden trackers',
    hides: 'Blocks hidden tracker scripts that watch what you do',
    tradeoff: 'A few sites that lean on these may load oddly or lose some analytics-based features.',
  },
  blockThirdPartyCookies: {
    flag: 'blockThirdPartyCookies',
    label: 'Block other companies’ cookies',
    hides: 'Removes other companies’ tracking cookies (your own logins still work)',
    tradeoff:
      'Embedded “Sign in with Google/Facebook” buttons and some cross-site carts or chat widgets may stop working until you switch this off for that site.',
  },
  stripUrlParams: {
    flag: 'stripUrlParams',
    label: 'Clean tracking tags off links',
    hides: 'Cleans the tracking tags off links you click',
    tradeoff: 'Rarely, a discount or referral link that depends on its tag may not credit you.',
  },
  spoofReferrer: {
    flag: 'spoofReferrer',
    label: 'Hide where you came from',
    hides: 'Hides which page you came from',
    tradeoff:
      'Some sites use this to function — image galleries, downloads, or paywalls may refuse to load, and sites you referred won’t know you sent them.',
  },
  normalizeFingerprint: {
    flag: 'normalizeFingerprint',
    label: 'Mask your device fingerprint',
    hides: 'Masks your device’s fingerprint so you blend into the crowd',
    tradeoff:
      'A site may misjudge your device — offering the wrong app version — and personalised recommendations tied to “your usual device” may reset.',
  },
};

/** The plain protections a persona provides (hide-text), derived from its flags. */
export function personaProtections(profile: PersonaProfile): string[] {
  return GATE_FLAGS.filter((f) => profile[f] === true).map((f) => FLAG_EXPLANATIONS[f].hides);
}

/** Protections WITH their real-life tradeoffs, for the detailed/Custom views. */
export function personaProtectionDetails(
  profile: PersonaProfile,
): Array<{ hides: string; tradeoff: string }> {
  return GATE_FLAGS.filter((f) => profile[f] === true).map((f) => ({
    hides: FLAG_EXPLANATIONS[f].hides,
    tradeoff: FLAG_EXPLANATIONS[f].tradeoff,
  }));
}

/**
 * The "why not just block cookies?" overview — the five ways a site can follow
 * you, and why cookies are only one of them. Title + plain body per item.
 */
export interface ProtectionTopic {
  title: string;
  body: string;
}

export const WHY_MORE_THAN_COOKIES: ProtectionTopic[] = [
  {
    title: 'Blocking cookies isn’t enough on its own',
    body:
      'A cookie is just one way a website recognises you. Turning cookies off is like locking the front door but leaving the windows open — sites can still follow you several other ways.',
  },
  {
    title: 'Hidden trackers',
    body:
      'Most pages quietly load little spy scripts from other companies (ad networks, “analytics”). They aren’t part of the page you wanted — they’re there to watch you. Alter/Me/A/I can refuse to load them.',
  },
  {
    title: 'Tracking tags in links',
    body:
      'Web addresses often carry a long tail like “?utm_source=…&fbclid=…”. Those bits label where you came from. They aren’t needed to show the page, so Alter/Me/A/I snips them off.',
  },
  {
    title: 'The “where you came from” note',
    body:
      'Your browser normally tells each site which page sent you there, letting them build a trail of your hops across the web. Alter/Me/A/I can stop that note.',
  },
  {
    title: 'Your device’s fingerprint',
    body:
      'Even with no cookies at all, a site can read facts about your computer — processor, memory, Mac vs Windows, battery — and combine them into a near-unique signature, like recognising your handwriting. Alter/Me/A/I feeds back generic, everyone-looks-alike answers.',
  },
];
