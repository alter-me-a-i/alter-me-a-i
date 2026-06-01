/*
 * Permission-gate unit tests — pure scope/grant logic (no IO/crypto).
 * Run via `npm test`.
 */

import { grantAllows, grantLive, scopeAllows, type Grant } from './permission';
import type { EventType, Sensitivity, Stream } from './types';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: unknown, detail = '') =>
  results.push({ name, ok: !!ok, detail });

const ev = (over: Partial<{ type: EventType; stream: Stream; sensitivity: Sensitivity; ts: number }>) =>
  ({ type: 'navigation', sensitivity: 'personal', ts: 1000, ...over } as {
    type: EventType; stream?: Stream; sensitivity: Sensitivity; ts: number;
  });

// --- scope: type narrowing ---
{
  check('no types → all types allowed', scopeAllows({}, ev({ type: 'ai_exchange' })), '');
  check('type in list allowed', scopeAllows({ types: ['ai_exchange', 'navigation'] }, ev({ type: 'navigation' })), '');
  check('type not in list denied', !scopeAllows({ types: ['ai_exchange'] }, ev({ type: 'navigation' })), '');
}

// --- scope: stream narrowing (absent stream ⇒ web) ---
{
  check('absent stream treated as web', scopeAllows({ streams: ['web'] }, ev({})), '');
  check('gaming denied when only web allowed', !scopeAllows({ streams: ['web'] }, ev({ stream: 'gaming' })), '');
  check('gaming allowed when listed', scopeAllows({ streams: ['gaming'] }, ev({ stream: 'gaming' })), '');
}

// --- scope: sensitivity ceiling ---
{
  check('personal under personal ceiling', scopeAllows({ maxSensitivity: 'personal' }, ev({ sensitivity: 'personal' })), '');
  check('sensitive over personal ceiling DENIED', !scopeAllows({ maxSensitivity: 'personal' }, ev({ sensitivity: 'sensitive' })), '');
  check('secret over personal ceiling DENIED', !scopeAllows({ maxSensitivity: 'personal' }, ev({ sensitivity: 'secret' })), '');
  check('public always under any ceiling', scopeAllows({ maxSensitivity: 'public' }, ev({ sensitivity: 'public' })), '');
  check('no ceiling → secret allowed', scopeAllows({}, ev({ sensitivity: 'secret' })), '');
}

// --- scope: time window ---
{
  check('before since denied', !scopeAllows({ since: 2000 }, ev({ ts: 1000 })), '');
  check('after until denied', !scopeAllows({ until: 500 }, ev({ ts: 1000 })), '');
  check('within window allowed', scopeAllows({ since: 500, until: 2000 }, ev({ ts: 1000 })), '');
}

// --- grant liveness ---
{
  const sessionTied: Grant = { id: 'a', label: 'x', scope: {}, grantedAt: 0 };
  check('session-tied grant never self-expires', grantLive(sessionTied, 9e15), '');

  const timed: Grant = { id: 'b', label: 'x', scope: {}, grantedAt: 0, expiresAt: 1000 };
  check('timed grant live before expiry', grantLive(timed, 999), '');
  check('timed grant dead at expiry', !grantLive(timed, 1000), '');
  check('timed grant dead after expiry', !grantLive(timed, 2000), '');
}

// --- grantAllows combines liveness AND scope ---
{
  const g: Grant = { id: 'c', label: 'training', scope: { maxSensitivity: 'personal' }, grantedAt: 0, expiresAt: 5000 };
  check('live + in-scope → allowed', grantAllows(g, ev({ sensitivity: 'personal' }), 1000), '');
  check('live + out-of-scope (secret) → denied', !grantAllows(g, ev({ sensitivity: 'secret' }), 1000), '');
  check('expired + in-scope → denied', !grantAllows(g, ev({ sensitivity: 'personal' }), 9000), '');
}

const failed = results.filter((r) => !r.ok);
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${r.ok ? '' : `  -> got: ${r.detail}`}`);
lines.push(`\n${results.length - failed.length}/${results.length} passed`);
process.stdout.write(lines.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
