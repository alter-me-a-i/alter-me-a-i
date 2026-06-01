# The Ring — controlled data egress

> The cortex collects locally; by default nothing leaves. **The Ring is the
> membrane where data can exit — and it stays closed unless you deliberately
> open it.** Default state safe, opt-in states legible, you decide every time.

This is the opposite of the standard web: there the default is extraction, the
terms are unreadable, and opting out means you can't use the service. Here the
default is your own data, the terms are plain English, and opting in is always a
conscious choice.

## How it maps to Cortex

The Ring is the product surface for the spec's §3.4 *query-time leak surface* —
generalized from "sending snippets to a cloud model" into "any outbound grant."
It completes the thesis:

- Vault — you own the pool
- Capture — you fill it (offense)
- Defense — you starve theirs
- Mind — you use it
- **Ring — you, and only you, let measured pieces out, on your terms, revocably**

Egress through the Ring reuses the existing `disclosure` event type, so every
grant and every actual data release is recorded back into the vault — the same
offense/defense synergy: controlling your data generates more owned data.

## The flow (request → policy → grant → enforce → revoke)

1. **Request.** A service (therapist, researcher, platform, a local AI) asks for
   access. The request names: requester identity, the data scope (which event
   kinds / time range / fields), purpose, retention/expiry, and what the user
   gets in return.
2. **Plain-language policy.** The machine shows a preset policy translating the
   request into a legible trade: *what data, with whom, for how long, in
   exchange for what.* No dark patterns, no pre-checked boxes, no "accept to
   continue."
3. **Decision.** User picks **Allow / Deny / Modify**. Modify can narrow scope,
   shorten expiry, or strip fields. The Ring "only opens as far as you slid it."
4. **Enforce.** Outbound data is filtered to exactly the granted scope (reusing
   trajectory-export's sensitivity gating + PII redaction). A grant that tries
   to read beyond its scope is blocked and the user is alerted.
5. **Record.** A `disclosure` event logs the grant and each release — a standing
   audit trail the user owns.
6. **Revoke.** Any grant is revocable anytime. Revocation is real: future reads
   denied; the grant is marked closed in the ledger.

## Data model (planned — `lib/ring/`)

- `RingRequest` — incoming ask: `{ requester, scope, purpose, retention, offer }`.
- `RingScope` — `{ eventTypes[], since?, until?, maxSensitivity, fields[] }`
  (maxSensitivity reuses the vault's Sensitivity ladder; default caps at
  'personal' so 'sensitive'/'secret' never leave without explicit raise).
- `RingGrant` — a user decision: `{ id, request, decision, grantedScope, expiry,
  createdAt, revokedAt? }`. Persisted in `storage.local` (the *grants ledger*),
  never the data itself.
- `RingRelease` — one actual egress under a grant; emits a `disclosure` event
  `{ decision:'revealed', field:'ring:<requester>:<scope>', policy:<grantId> }`.

Enforcement note: a grant stores *scope + key-release policy*, not a copy of the
data. At release time the vault is queried, filtered to the granted scope,
redacted, and only then handed out — so revocation and expiry are absolute.

## Honest boundaries (carry the spec's discipline)

- The Ring controls **what you deliberately send**. Once a human recipient has
  the bytes you granted, you can't un-send those (revocation stops *future*
  reads, not past copies). Say this plainly in the grant UI.
- This is **data sovereignty, not network anonymity** — same scoping as the rest
  of Cortex.
- Default-closed is load-bearing: the Ring ships with zero open grants and no
  "default partners."

## Build order (after auth Tier 2/3 settle)

1. `lib/ring/` types + grants ledger (storage.local) + pure scope-filter
   (reuse trajectory gating/redaction). Unit-tested.
2. Decision UI: request → plain-language policy card → Allow/Deny/Modify.
3. Enforcement + `disclosure` logging on each release.
4. Grants dashboard: list active grants, what each can see, one-tap revoke,
   over-ask alerts.
5. First concrete requester type (likely the local-model Q&A or an export-to-a-
   named-recipient), then generalize.
