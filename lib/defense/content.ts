/*
 * Content-side defense — the on-page half of "starve their pool". Strips known
 * tracking params from the address-bar URL and from link hrefs, per the active
 * persona. When it strips the page's own URL it emits a `disclosure` event, so
 * the act of defending becomes training signal in your corpus (offense/defense
 * synergy). No wxt/extension imports → unit-testable under a simulated DOM.
 */

import type { NewEvent } from '../vault/types';
import { cleanUrl } from './url';
import type { PersonaProfile } from './personas';

export interface DefenseCtx {
  host: string;
  personaId: string;
  profile: PersonaProfile;
  report: (event: NewEvent) => void;
}

/** Strip tracking params from this page's URL and links. Returns teardown. */
export function startUrlDefense(ctx: DefenseCtx): () => void {
  if (!ctx.profile.stripUrlParams) return () => {};
  const cleanups: Array<() => void> = [];

  // 1. Clean the address-bar URL in place, and record the disclosure.
  const before = location.href;
  const { url, removed } = cleanUrl(before);
  if (removed.length) {
    try {
      history.replaceState(history.state, '', url);
    } catch {
      /* some pages disallow replaceState; stripping links still helps */
    }
    ctx.report({
      type: 'disclosure',
      source: { host: ctx.host, url: before },
      sensitivity: 'personal',
      decision: 'redacted',
      field: `tracking_params:${removed.join(',')}`,
      policy: ctx.personaId,
    });
  }

  // 2. Clean link hrefs (initial + dynamically added), silently to avoid noise.
  const cleanLinks = () => {
    const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="?"]');
    anchors.forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      try {
        const abs = new URL(href, location.href);
        const res = cleanUrl(abs.href);
        if (res.removed.length) a.setAttribute('href', res.url);
      } catch {
        /* skip unparseable hrefs */
      }
    });
  };
  cleanLinks();

  let timer = 0;
  const obs = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(cleanLinks, 1000) as unknown as number;
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  cleanups.push(() => {
    obs.disconnect();
    clearTimeout(timer);
  });

  return () => cleanups.forEach((c) => c());
}
