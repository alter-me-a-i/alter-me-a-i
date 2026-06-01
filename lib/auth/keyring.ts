/*
 * Envelope key management — the foundation for multiple unlock methods.
 *
 * Instead of deriving the vault key directly from a passphrase (which allows
 * exactly one unlock method), Cortex uses a random Vault Master Key (VMK) that
 * actually encrypts events, and stores it *wrapped* (encrypted) once per enrolled
 * method. Each method derives a Key-Encryption-Key (KEK) and unwraps the same
 * VMK — so a passphrase AND a passkey can both open the identical vault.
 *
 * Pure crypto, no storage/extension imports → fully unit-testable in Node.
 * WebCrypto only; zero dependencies.
 */

const subtle = globalThis.crypto.subtle;
const PBKDF2_ITERATIONS = 600_000; // OWASP floor, SHA-256
const VMK_BYTES = 32; // 256-bit master key
const IV_BYTES = 12;

export type AuthMethod = 'passphrase' | 'webauthn';

/** One stored way to unwrap the VMK. Persisted (as plain numbers) in storage. */
export interface WrapRecord {
  id: string;
  method: AuthMethod;
  /** Human label, e.g. "Passphrase", "Touch ID". */
  label: string;
  /** KDF/PRF salt for deriving this method's KEK. */
  salt: number[];
  /** AES-GCM IV for the wrap. */
  iv: number[];
  /** The VMK, encrypted under this method's KEK. */
  wrapped: number[];
  /** WebAuthn credential id this wrap is bound to (webauthn method only). */
  credentialId?: number[];
}

export interface Keyring {
  version: 1;
  wraps: WrapRecord[];
}

export function emptyKeyring(): Keyring {
  return { version: 1, wraps: [] };
}

export function generateVmk(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(VMK_BYTES));
}

function randomSalt(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(16));
}

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Derive a wrapping KEK (AES-GCM) from a passphrase + salt. */
export async function passphraseKek(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Import high-entropy raw bytes (e.g. a WebAuthn PRF output) as a KEK. */
export async function rawKek(material: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('raw', material as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Encrypt the VMK under a KEK, producing iv + ciphertext. */
async function wrap(kek: CryptoKey, vmk: Uint8Array): Promise<{ iv: Uint8Array; wrapped: Uint8Array }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, vmk as BufferSource);
  return { iv, wrapped: new Uint8Array(ct) };
}

/** Decrypt a wrapped VMK with its KEK. Throws if the KEK is wrong. */
async function unwrap(kek: CryptoKey, iv: Uint8Array, wrapped: Uint8Array): Promise<Uint8Array> {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, kek, wrapped as BufferSource);
  return new Uint8Array(pt);
}

/** Build a passphrase wrap record for a given VMK. */
export async function makePassphraseWrap(
  passphrase: string,
  vmk: Uint8Array,
  label = 'Passphrase',
): Promise<WrapRecord> {
  const salt = randomSalt();
  const kek = await passphraseKek(passphrase, salt);
  const { iv, wrapped } = await wrap(kek, vmk);
  return {
    id: uuid(),
    method: 'passphrase',
    label,
    salt: Array.from(salt),
    iv: Array.from(iv),
    wrapped: Array.from(wrapped),
  };
}

/** Build a webauthn wrap record from a PRF output for a given VMK. */
export async function makeWebauthnWrap(
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
  credentialId: Uint8Array,
  vmk: Uint8Array,
  label = 'Passkey',
): Promise<WrapRecord> {
  const kek = await rawKek(prfOutput);
  const { iv, wrapped } = await wrap(kek, vmk);
  return {
    id: uuid(),
    method: 'webauthn',
    label,
    salt: Array.from(prfSalt),
    iv: Array.from(iv),
    wrapped: Array.from(wrapped),
    credentialId: Array.from(credentialId),
  };
}

/** Recover the VMK from a passphrase wrap. Throws on wrong passphrase. */
export async function unwrapWithPassphrase(rec: WrapRecord, passphrase: string): Promise<Uint8Array> {
  const kek = await passphraseKek(passphrase, new Uint8Array(rec.salt));
  return unwrap(kek, new Uint8Array(rec.iv), new Uint8Array(rec.wrapped));
}

/** Recover the VMK from a webauthn wrap given the PRF output. */
export async function unwrapWithPrf(rec: WrapRecord, prfOutput: Uint8Array): Promise<Uint8Array> {
  const kek = await rawKek(prfOutput);
  return unwrap(kek, new Uint8Array(rec.iv), new Uint8Array(rec.wrapped));
}

/** Import VMK bytes as the working AES-GCM vault key (non-extractable). */
export async function importVaultKey(vmk: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('raw', vmk as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}
