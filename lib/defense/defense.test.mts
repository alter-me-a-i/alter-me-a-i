/*
 * Defense unit tests — pure logic only (URL stripping + persona resolution).
 * Run via `npm run test:defense` (or as part of `npm test`).
 */

import { cleanUrl } from './url';
import { DEFAULT_DEFENSE, profileFor, resolvePersonaId, type DefenseSettings } from './settings';
import { PERSONA_PROFILES } from './personas';

/** Build a DefenseSettings fixture without repeating the (now-required) custom mix. */
const mk = (s: Partial<DefenseSettings>): DefenseSettings => ({ ...DEFAULT_DEFENSE, ...s });
import {
  applyFingerprintGate,
  buildGatePlan,
  CONSERVATIVE_GATE,
  DISABLE,
  type GateRoots,
} from './fingerprint';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: unknown, detail = '') =>
  results.push({ name, ok: !!ok, detail });

// --- URL stripping ---
{
  const r = cleanUrl('https://example.com/article?utm_source=news&id=42&fbclid=abc');
  check('strips utm_source + fbclid, keeps id', r.url === 'https://example.com/article?id=42', r.url);
  check('reports removed params', r.removed.sort().join(',') === 'fbclid,utm_source', r.removed.join(','));
}
{
  const r = cleanUrl('https://example.com/clean?id=42');
  check('no-op when nothing to strip', r.removed.length === 0 && r.url === 'https://example.com/clean?id=42', r.url);
}
{
  const r = cleanUrl('not a url');
  check('unparseable URL returns verbatim', r.url === 'not a url' && r.removed.length === 0, r.url);
}
{
  const r = cleanUrl('https://example.com/?UTM_SOURCE=x'); // case-insensitive
  check('case-insensitive param match', r.removed.length === 1, JSON.stringify(r.removed));
}

// --- persona resolution ---
{
  const s = mk({ enabled: true, activePersona: 'ghost' });
  check('global persona applies', resolvePersonaId(s, 'nytimes.com') === 'ghost', resolvePersonaId(s, 'nytimes.com'));
}
{
  const s = mk({ enabled: true, activePersona: 'ghost', perSite: { 'github.com': 'open' } });
  check('per-site override beats global', resolvePersonaId(s, 'github.com') === 'open', resolvePersonaId(s, 'github.com'));
  check('per-site strips www', resolvePersonaId(s, 'www.github.com') === 'open', resolvePersonaId(s, 'www.github.com'));
}
{
  const s = mk({ enabled: false, activePersona: 'ghost' });
  check('master off → open', resolvePersonaId(s, 'nytimes.com') === 'open', resolvePersonaId(s, 'nytimes.com'));
}

// --- persona profiles sanity ---
{
  check('ghost blocks everything', PERSONA_PROFILES.ghost.blockTrackers && PERSONA_PROFILES.ghost.spoofReferrer, '');
  check('open blocks nothing', !PERSONA_PROFILES.open.blockTrackers && !PERSONA_PROFILES.open.stripUrlParams, '');
}

// --- custom persona: live flags drive the resolved profile ---
{
  const s = mk({
    enabled: true,
    activePersona: 'custom',
    custom: {
      blockTrackers: false,
      blockThirdPartyCookies: true,
      stripUrlParams: false,
      spoofReferrer: true,
      normalizeFingerprint: false,
    },
  });
  const eff = profileFor(s, 'custom');
  check('custom profile reflects user flags (referrer on)', eff.spoofReferrer === true, String(eff.spoofReferrer));
  check('custom profile reflects user flags (trackers off)', eff.blockTrackers === false, String(eff.blockTrackers));
  check('custom keeps persona id', eff.id === 'custom', eff.id);
}
{
  // profileFor must NOT mutate a non-custom persona with the custom mix.
  const s = mk({ enabled: true, activePersona: 'ghost', custom: { ...DEFAULT_DEFENSE.custom, blockTrackers: false } });
  const ghost = profileFor(s, 'ghost');
  check('non-custom profile ignores custom flags', ghost.blockTrackers === true, String(ghost.blockTrackers));
}

// --- fingerprint gate: plan selection ---
{
  check('ghost normalizes fingerprint', PERSONA_PROFILES.ghost.normalizeFingerprint === true, '');
  check('pseudonym normalizes fingerprint', PERSONA_PROFILES.pseudonym.normalizeFingerprint === true, '');
  check('casual does NOT normalize', PERSONA_PROFILES.casual.normalizeFingerprint === false, '');
  check('open does NOT normalize', PERSONA_PROFILES.open.normalizeFingerprint === false, '');
  check('plan non-empty for ghost', buildGatePlan(PERSONA_PROFILES.ghost).length === CONSERVATIVE_GATE.length, '');
  check('plan empty for open', buildGatePlan(PERSONA_PROFILES.open).length === 0, '');
}

// --- fingerprint gate: apply over a fake navigator ---
{
  const nav: Record<string, unknown> = {
    hardwareConcurrency: 32,
    deviceMemory: 64,
    platform: 'MacIntel',
    maxTouchPoints: 5,
    webdriver: true,
    getBattery: () => Promise.resolve({}),
  };
  const roots: GateRoots = { navigator: nav };
  const gated = applyFingerprintGate(roots, buildGatePlan(PERSONA_PROFILES.ghost));

  check('cpu cores normalized to 8', nav.hardwareConcurrency === 8, String(nav.hardwareConcurrency));
  check('device memory normalized to 8', nav.deviceMemory === 8, String(nav.deviceMemory));
  check('platform normalized to Win32', nav.platform === 'Win32', String(nav.platform));
  check('maxTouchPoints normalized to 0', nav.maxTouchPoints === 0, String(nav.maxTouchPoints));
  check('webdriver forced false', nav.webdriver === false, String(nav.webdriver));
  check('battery API disabled', nav.getBattery === undefined, String(nav.getBattery));
  check('reports all six gated labels', gated.length === 6, gated.join(','));
}

// --- fingerprint gate: empty plan changes nothing ---
{
  const nav: Record<string, unknown> = { hardwareConcurrency: 32, platform: 'MacIntel' };
  const gated = applyFingerprintGate({ navigator: nav }, buildGatePlan(PERSONA_PROFILES.open));
  check('open plan leaves device untouched', nav.hardwareConcurrency === 32 && nav.platform === 'MacIntel', '');
  check('open plan gates nothing', gated.length === 0, gated.join(','));
}

// --- fingerprint gate: non-configurable property is skipped, not thrown ---
{
  const nav: Record<string, unknown> = {};
  Object.defineProperty(nav, 'platform', { value: 'Linux', configurable: false, enumerable: true });
  let threw = false;
  let gated: string[] = [];
  try {
    gated = applyFingerprintGate({ navigator: nav }, [
      { root: 'navigator', prop: 'platform', value: 'Win32', label: 'platform' },
    ]);
  } catch {
    threw = true;
  }
  check('locked property does not throw', !threw, '');
  check('locked property reported as not gated', gated.length === 0, gated.join(','));
  check('locked property keeps real value', nav.platform === 'Linux', String(nav.platform));
}

// --- DISABLE sentinel sanity ---
{
  check('DISABLE is a unique symbol', typeof DISABLE === 'symbol', String(typeof DISABLE));
}

const failed = results.filter((r) => !r.ok);
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${r.ok ? '' : `  -> got: ${r.detail}`}`);
lines.push(`\n${results.length - failed.length}/${results.length} passed`);
process.stdout.write(lines.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
