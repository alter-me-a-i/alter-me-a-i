/*
 * Keyring (envelope-key) tests — the core that lets a passphrase AND a passkey
 * open the same vault. Pure WebCrypto, runs in Node. Run via `npm test`.
 */

import {
  generateVmk,
  makePassphraseWrap,
  makeWebauthnWrap,
  unwrapWithPassphrase,
  unwrapWithPrf,
} from './keyring';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: unknown, detail = '') =>
  results.push({ name, ok: !!ok, detail });
const eq = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function main() {
  const vmk = generateVmk();
  check('VMK is 32 bytes', vmk.length === 32, String(vmk.length));

  // passphrase round-trip
  const pw = await makePassphraseWrap('correct horse battery staple', vmk);
  const back = await unwrapWithPassphrase(pw, 'correct horse battery staple');
  check('passphrase unwrap recovers VMK', eq(back, vmk), '');

  // wrong passphrase rejected
  let rejected = false;
  try { await unwrapWithPassphrase(pw, 'wrong'); } catch { rejected = true; }
  check('wrong passphrase rejected', rejected, '');

  // webauthn (PRF) round-trip — simulate a 32-byte PRF output
  const prf = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const salt = new TextEncoder().encode('cortex.vault.prf.v1');
  const credId = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const wk = await makeWebauthnWrap(prf, salt, credId, vmk);
  const back2 = await unwrapWithPrf(wk, prf);
  check('PRF unwrap recovers SAME VMK', eq(back2, vmk), '');

  // wrong PRF rejected
  let rej2 = false;
  const wrongPrf = globalThis.crypto.getRandomValues(new Uint8Array(32));
  try { await unwrapWithPrf(wk, wrongPrf); } catch { rej2 = true; }
  check('wrong PRF rejected', rej2, '');

  // the key insight: both methods open the identical vault key
  check('passphrase and passkey unwrap to identical VMK', eq(back, back2), '');

  // wraps don't leak the VMK in plaintext
  const blob = JSON.stringify([pw, wk]);
  const vmkHex = Array.from(vmk).map((b) => b.toString(16).padStart(2, '0')).join('');
  check('VMK not present in stored wraps', !blob.includes(vmkHex), '');

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${r.ok ? '' : `  -> ${r.detail}`}`);
  lines.push(`\n${results.length - failed.length}/${results.length} passed`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(failed.length ? 1 : 0);
}

main();
