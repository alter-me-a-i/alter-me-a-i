# Cortex Authentication & Key Architecture

> Auth methods **gate** the vault key; they do not replace encryption. The vault
> is always AES-256-GCM. The only question is how the key is derived/released.

## Tiers (phased)

### Tier 1 — Passphrase (shipped)
- Argon2id/PBKDF2 over a user passphrase → AES key, in memory only.
- No recovery, no escrow. Salt in `storage.local`.

### Tier 2 — WebAuthn passkey (building now)
- Unlock with a platform authenticator (Touch ID / Windows Hello / security key).
- **Key derivation via the WebAuthn PRF extension:** the passkey produces a
  stable per-credential secret (PRF output) bound to a fixed salt. That secret is
  the key material (or wraps the passphrase-derived key).
- **Enrollment:** create a credential, evaluate PRF, derive `K_webauthn`, use it
  to wrap the existing vault key (so passphrase + passkey both open the same vault).
- **Fallback:** if PRF unsupported, WebAuthn gates a passphrase unlock (2FA) rather
  than deriving the key. Detect support at enrollment; never silently downgrade.
- **No-network:** WebAuthn here is local user verification only — no RP server,
  nothing leaves the device. Honors zero-egress.

### Tier 3 — QR companion (design now, build later)
Two-device split-key: the phone holds a key share; desktop needs both to unlock.

**Pairing protocol (v1 draft):**
1. Extension generates an ephemeral X25519 keypair; shows QR =
   `cortex-pair:v1:<ext_pubkey>:<nonce>`.
2. Companion scans, generates its own keypair, does ECDH → shared secret.
3. Companion derives & stores a key share `S_phone`; sends back (over the
   ECDH-encrypted channel, via QR-back or local link) `S_phone_pub` + commitment.
4. Vault key = combine(`S_device`, `S_phone`) via HKDF. Neither device alone can
   reconstruct it.
**Unlock:** desktop shows challenge QR → phone approves (biometric on phone) →
returns its share/half-signature → desktop reconstructs key in memory.
**Revoke:** drop `S_device`; the pairing is dead (phone share alone is useless).

## Open questions to resolve before Tier 3 build
- Transport for the return channel (QR-back vs BLE vs local network).
- Recovery if phone is lost (a sealed recovery share? printed backup code?).
- Per-Alter-Me (compartment) keys: does each compartment pair separately?

## Threat model notes
- Protects: at-rest data, casual device access, silent egress (none).
- Does NOT protect: malware on an unlocked machine with the key in memory.
- WebAuthn/PRF binds the key to a device authenticator → lost device = lost data
  unless a second method (passphrase) is also enrolled. Encourage enrolling 2.
