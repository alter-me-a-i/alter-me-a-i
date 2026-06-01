/*
 * Vault encryption. AES-256-GCM with a key derived from the user's passphrase
 * via PBKDF2. The raw key is never persisted — only the salt is. That makes the
 * encryption real against an attacker who reads the IndexedDB on disk: without
 * the passphrase there is no key. The trade-off is that a killed service worker
 * loses the in-memory key and the user must re-unlock.
 */

const PBKDF2_ITERATIONS = 600_000; // OWASP-recommended floor for PBKDF2-SHA256
const SALT_BYTES = 16;
const IV_BYTES = 12; // standard nonce length for AES-GCM

const subtle = globalThis.crypto.subtle;

/** Ciphertext envelope stored in IndexedDB. iv is per-record (never reused). */
export interface Sealed {
  iv: Uint8Array;
  ct: Uint8Array;
}

export function generateSalt(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable — the key cannot be exported back out
    ['encrypt', 'decrypt'],
  );
}

export async function seal(key: CryptoKey, plaintext: string): Promise<Sealed> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv, ct: new Uint8Array(ct) };
}

export async function open(key: CryptoKey, sealed: Sealed): Promise<string> {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.iv as BufferSource },
    key,
    sealed.ct as BufferSource,
  );
  return new TextDecoder().decode(pt);
}
