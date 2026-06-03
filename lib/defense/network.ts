/*
 * Network-level defense — runs in the background worker. Translates the active
 * persona into declarativeNetRequest controls:
 *   - toggle the static tracker blocklist ("trackers" ruleset)
 *   - dynamic header rules to strip third-party cookies and the referrer
 *
 * declarativeNetRequest is global (not per-tab), so these follow the global
 * active persona, not per-site overrides — a documented limitation. Per-site
 * overrides still drive on-page behavior (URL stripping) and the badge.
 */

import { browser } from 'wxt/browser';
import { getProfile, type PersonaProfile } from './personas';
import { DEFAULT_DEFENSE, profileFor, type DefenseSettings } from './settings';

const TRACKER_RULESET = 'trackers';

// Fixed IDs so each apply deterministically replaces the prior dynamic rules.
const RULE_ID = {
  STRIP_COOKIE_REQUEST: 1001,
  STRIP_COOKIE_RESPONSE: 1002,
  STRIP_REFERER: 1003,
} as const;

const RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket',
  'other',
] as any;

/** The profile that drives global network rules (master switch forces Open). */
function networkProfile(settings: DefenseSettings): PersonaProfile {
  if (!settings.enabled) return getProfile('open');
  return profileFor(settings, settings.activePersona);
}

async function applyTrackerRuleset(profile: PersonaProfile): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  if (!dnr?.updateEnabledRulesets) return;
  try {
    if (profile.blockTrackers) {
      await dnr.updateEnabledRulesets({ enableRulesetIds: [TRACKER_RULESET] });
    } else {
      await dnr.updateEnabledRulesets({ disableRulesetIds: [TRACKER_RULESET] });
    }
  } catch (err) {
    console.warn('[Alter/Me/A/I] tracker ruleset toggle failed:', err);
  }
}

async function applyDynamicRules(profile: PersonaProfile): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  if (!dnr?.updateDynamicRules) return;

  const addRules: any[] = [];
  if (profile.blockThirdPartyCookies) {
    addRules.push({
      id: RULE_ID.STRIP_COOKIE_REQUEST,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'cookie', operation: 'remove' }] },
      condition: { domainType: 'thirdParty', resourceTypes: RESOURCE_TYPES },
    });
    addRules.push({
      id: RULE_ID.STRIP_COOKIE_RESPONSE,
      priority: 1,
      action: { type: 'modifyHeaders', responseHeaders: [{ header: 'set-cookie', operation: 'remove' }] },
      condition: { domainType: 'thirdParty', resourceTypes: RESOURCE_TYPES },
    });
  }
  if (profile.spoofReferrer) {
    addRules.push({
      id: RULE_ID.STRIP_REFERER,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'remove' }] },
      condition: { domainType: 'thirdParty', resourceTypes: RESOURCE_TYPES },
    });
  }

  try {
    await dnr.updateDynamicRules({
      removeRuleIds: Object.values(RULE_ID),
      addRules,
    });
  } catch (err) {
    console.warn('[Alter/Me/A/I] dynamic rule update failed:', err);
  }
}

/** Apply all network controls for the current defense settings. */
export async function applyNetworkControls(
  settings: DefenseSettings = DEFAULT_DEFENSE,
): Promise<void> {
  const profile = networkProfile(settings);
  await applyTrackerRuleset(profile);
  await applyDynamicRules(profile);
}
