/*
 * WebAuthn passkey helpers — must run in a window context (popup/options), since
 * `navigator.credentials` isn't available in the service worker. These functions
 * create/assert a passkey and evaluate the PRF extension to produce stable key
 * material. The actual VMK wrapping happens in the vault (background) — these
 * only handle the browser API + PRF.
 *
 * Zero-egress: rp.id is the extension's own origin; no RP server is contacted.
 */

const RP_NAME = 'Cortex';
const USER_NAME = 'cortex-vault';
/** Fixed PRF salt — same input → same PRF output for this vault. */
export const PRF_SALT = new TextEncoder().encode('cortex.vault.prf.v1');

function bufToBytes(b: ArrayBuffer | ArrayBufferView): Uint8Array {
  return b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer);
}

/** Is WebAuthn even present? (popup context) */
export function webauthnAvailable(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials;
}

export interface PrfResult {
  credentialId: Uint8Array;
  prfOutput: Uint8Array;
  prfSalt: Uint8Array;
}

/**
 * Create a new passkey bound to this device and retrieve PRF output.
 *
 * Current Chrome/Safari on macOS DO return PRF results at create() time for the
 * platform authenticator (iCloud Keychain) and for Google Password Manager
 * passkeys — when you pass `prf: { eval: { first } }` to create(). We try that
 * first (one Touch ID, no second ceremony). Only if the create response carries
 * no PRF result do we fall back to evaluating via an immediate assertion (older
 * Chrome). Throws — never falls back to largeBlob — only when PRF is genuinely
 * unavailable, so the caller can decide what to do.
 */
export async function createPasskeyWithPrf(): Promise<PrfResult | null> {
  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const userId = globalThis.crypto.getRandomValues(new Uint8Array(16));

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME, id: location.hostname || undefined },
      user: { id: userId, name: USER_NAME, displayName: RP_NAME },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      timeout: 60_000,
      // Evaluate the salt AT create — modern Chrome/Safari return it here, which
      // avoids the fragile second assertion that fails on macOS Touch ID.
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('PRF1: create() returned null');

  const credentialId = bufToBytes(cred.rawId);
  const createExt = cred.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };

  // Best case: PRF evaluated during creation — done in a single ceremony.
  const atCreate = createExt.prf?.results?.first;
  if (atCreate) {
    return { credentialId, prfOutput: bufToBytes(atCreate), prfSalt: PRF_SALT };
  }

  // The authenticator explicitly reports no PRF — don't burn a second Touch ID.
  if (createExt.prf?.enabled === false) {
    throw new Error('PRF0: authenticator reports PRF unsupported');
  }

  // Fallback (older Chrome): evaluate the salt via an immediate assertion.
  const prf = await assertPasskeyWithPrf([credentialId]);
  if (!prf) {
    throw new Error(`PRF2: assert gave no result (create enabled=${String(createExt.prf?.enabled)})`);
  }

  return { credentialId, prfOutput: prf.prfOutput, prfSalt: PRF_SALT };
}

/**
 * Assert an existing passkey and evaluate PRF to recover key material.
 * `allowIds` narrows to enrolled credentials. Returns null if PRF missing.
 */
export async function assertPasskeyWithPrf(allowIds: Uint8Array[] = []): Promise<PrfResult | null> {
  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: location.hostname || undefined,
      userVerification: 'required',
      timeout: 60_000,
      allowCredentials: allowIds.map(
        (id) => ({ type: 'public-key', id: id.slice().buffer }) as PublicKeyCredentialDescriptor,
      ),
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;

  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const first = ext.prf?.results?.first;
  if (!first) return null;

  return {
    credentialId: bufToBytes(cred.rawId),
    prfOutput: bufToBytes(first),
    prfSalt: PRF_SALT,
  };
}

/* ===========================================================================
 * largeBlob fallback — for authenticators (e.g. iCloud Keychain) that don't
 * support PRF. Instead of DERIVING key material from the passkey, we STORE a
 * random secret *inside* the passkey's large blob; the authenticator only
 * releases it after user verification (Touch ID). That secret then plays the
 * exact role the PRF output did: it wraps the Vault Master Key in the keyring.
 *
 * This is real security: the secret lives in the passkey (synced encrypted by
 * the platform), not in readable extension storage. Reads require Touch ID.
 * ===========================================================================*/

/** Carries the blob secret in the same shape as PrfResult so the keyring reuses it. */
const LARGEBLOB_SALT = new TextEncoder().encode('cortex.vault.largeblob.v1');

/** Does a freshly-created passkey support largeBlob? Returns the id if so. */
export async function createPasskeyWithLargeBlob(): Promise<{ credentialId: Uint8Array } | null> {
  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const userId = globalThis.crypto.getRandomValues(new Uint8Array(16));

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME, id: location.hostname || undefined },
      user: { id: userId, name: USER_NAME, displayName: RP_NAME },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
      extensions: { largeBlob: { support: 'required' } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('LB1: create() returned null');

  const ext = cred.getClientExtensionResults() as { largeBlob?: { supported?: boolean } };
  if (ext.largeBlob?.supported !== true) {
    throw new Error(`LB2: largeBlob not supported (supported=${String(ext.largeBlob?.supported)})`);
  }
  return { credentialId: bufToBytes(cred.rawId) };
}

/**
 * Enroll via largeBlob: create a passkey, then write a fresh random secret into
 * its blob (a second Touch ID). Returns the secret as a PrfResult so the vault's
 * existing webauthn wrap path stores it unchanged.
 */
export async function enrollPasskeyLargeBlob(): Promise<PrfResult> {
  const { credentialId } = (await createPasskeyWithLargeBlob())!;
  const secret = globalThis.crypto.getRandomValues(new Uint8Array(32));

  // iCloud Keychain advertises largeBlob but the write on the immediately-
  // following ceremony can report written=false. Retry the write a few times,
  // and — crucially — confirm success by READING the blob back, since `written`
  // is unreliable on some platforms while the data actually persisted.
  let lastWritten: unknown = undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname || undefined,
        userVerification: 'required',
        timeout: 60_000,
        allowCredentials: [
          { type: 'public-key', id: credentialId.slice().buffer } as PublicKeyCredentialDescriptor,
        ],
        extensions: { largeBlob: { write: secret.slice().buffer } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    const ext = cred?.getClientExtensionResults() as { largeBlob?: { written?: boolean } } | undefined;
    lastWritten = ext?.largeBlob?.written;

    if (lastWritten === true) {
      return { credentialId, prfOutput: secret, prfSalt: LARGEBLOB_SALT };
    }

    // Even if `written` wasn't true, verify by reading it back — if the bytes
    // match, the write actually worked despite the misreported flag.
    const readBack = await readPasskeyLargeBlob([credentialId]);
    if (readBack && bytesEqual(readBack.prfOutput, secret)) {
      return { credentialId, prfOutput: secret, prfSalt: LARGEBLOB_SALT };
    }
  }
  throw new Error(`LB3: blob write failed after retries (written=${String(lastWritten)})`);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Unlock via largeBlob: read the stored secret back out (one Touch ID). */
export async function readPasskeyLargeBlob(allowIds: Uint8Array[] = []): Promise<PrfResult | null> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname || undefined,
      userVerification: 'required',
      timeout: 60_000,
      allowCredentials: allowIds.map(
        (id) => ({ type: 'public-key', id: id.slice().buffer }) as PublicKeyCredentialDescriptor,
      ),
      extensions: { largeBlob: { read: true } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;
  const ext = cred.getClientExtensionResults() as { largeBlob?: { blob?: ArrayBuffer } };
  if (!ext.largeBlob?.blob) return null;
  return {
    credentialId: bufToBytes(cred.rawId),
    prfOutput: bufToBytes(ext.largeBlob.blob),
    prfSalt: LARGEBLOB_SALT,
  };
}
