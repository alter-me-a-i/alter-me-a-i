# Alter/Me/A/I

> The local-first membrane between **public expression** and **private repository**.
> Gate your data. Build your own AI. Nothing leaves your device unless you decide.

**Alter/Me/A/I** is a browser extension (Manifest V3, built with [WXT](https://wxt.dev) +
TypeScript) that sits between you and the web as a *selectively-permeable gate*. It
captures your own behavioural exhaust **on-device**, classifies its sensitivity,
encrypts it, and lets **you** decide — explicitly, scoped, and revocably — which
pieces ever flow anywhere. It is the engine ("the cortex") of a small suite for
self-knowledge and personal data ownership.

This is **free and open-source software**, released into the public domain under
[CC0 1.0 Universal](LICENSE). No warranty, no liability. See [DISCLAIMER.md](DISCLAIMER.md).

---

## The premise: you own your data

The standard web extracts by default, hides its terms, and makes opting out mean
you can't use the service. Alter/Me/A/I inverts that:

- **Default state is safe.** Capture lives on your device; by default nothing
  leaves.
- **Opt-in states are legible.** Every outbound grant is plain English — what
  data, with whom, for how long, in exchange for what.
- **You decide every time.** Default-deny. Every grant is explicit, scoped, and
  revocable.

The raw record of your behaviour is yours. The model built from it is yours. The
face you present to the world is yours to shape.

## The model: membrane → neurotype → sociotype

Identity as a cell. Raw behaviour is the environment; the cortex is the membrane;
the distilled self is the nucleus; the persona is the expressed phenotype.

```
RAW EXHAUST  →  CORTEX        →  ME-ALTER         →  ALTER-ME
your behavior   the MEMBRANE     the NEUROTYPE       the SOCIOTYPE
(capture)       filters +        aggregates +        expresses
                permission        interprets          the face,
                gate              (the model-of-you)   deployed outward
```

- **Cortex — the membrane.** Capture gating, sensitivity classification,
  persona/disclosure rules, the permission gate. It *regulates flux*; it does not
  interpret. The only root of trust.
- **me-alter — the neurotype.** Aggregates and interprets what the membrane lets
  through into a distilled *model-of-you* (the **Mind** layer).
- **alter-me — the sociotype.** The persona expressed outward — the socially-
  legible face, shaped by the membrane's rules.

The pieces fit together as: **extensions filter data → feed the [Vault](https://github.com/me-alter/vault)
→ a personal data-aggregation backbone**, with this extension as the engine at
the centre. See [`docs/SUITE-MAP.md`](docs/SUITE-MAP.md) for the full architecture.

## What it does today

- **Capture** (`lib/capture`) — observes navigation, searches, interactions, and
  AI exchanges on the pages you visit and normalizes them into a shared event
  schema. Password forms are skipped; sensitivity is classified per source.
- **Defense** (`lib/defense`) — tracker blocking, third-party cookie/referrer
  rules, and a runtime fingerprint gate, toggled per persona. You starve the
  trackers while you fill your own pool.
- **Vault** (`lib/vault`) — local, encrypted, append-only storage partitioned by
  domain, plus a **permission gate** (`lib/vault/permission.ts`): default-deny,
  scoped, revocable grants are the only path to a read.
- **Mind** (`lib/mind`) — a local, engine-agnostic interpreter (`profile()`,
  `search()`, `ask()`) over what the gate releases. TF-IDF today, behind an
  interface so a neural backend can replace it.
- **Auth** (`lib/auth`) — passphrase unlock (Argon2id/PBKDF2) shipped; WebAuthn
  passkey unlock via the PRF/largeBlob extension; QR companion split-key designed.
  All local — no RP server, nothing leaves the device. See [`docs/AUTH.md`](docs/AUTH.md).
- **Skins** (`lib/skins`) — pure design-token theming for the popup and on-page
  status chip.

Multiple **data streams** (web today; gaming / health / shopping designed) feed
the same membrane → permission gate → neurotype. See [`docs/DATA-STREAMS.md`](docs/DATA-STREAMS.md).

## Architecture overview

```
entrypoints/        MV3 entrypoints: background worker, content scripts, popup
lib/capture/        capture sources → normalized events (source-agnostic)
lib/defense/        tracker/fingerprint/network defenses, per-persona
lib/vault/          encrypted domain-partitioned store + permission gate
lib/mind/           local interpreter (TF-IDF; pluggable)
lib/auth/           passphrase / WebAuthn / QR-companion key derivation
lib/skins/          design-token theming
lib/connectors/     connector type definitions (future external sources)
lib/training/       gated training-export path
public/             icons, fonts, tracker blocklist
docs/               architecture & design docs (start with SUITE-MAP.md)
```

The vault, Mind, personas, and export are **source-agnostic** — adding a new data
stream is a new module, never a refactor. The whole extension is self-contained
and **zero-network**; everything works offline.

## Install / build / run

Requires Node 20+ and npm.

```sh
npm install            # installs deps and runs `wxt prepare`
npm run dev            # Chrome dev build with HMR
npm run dev:firefox    # Firefox dev build
npm run build          # production build -> .output/
npm run zip            # packaged zip for store upload
npm test               # run the unit/smoke test suites
npm run compile        # type-check only (tsc --noEmit)
```

After `npm run dev`, load the unpacked extension from `.output/` via your
browser's extension developer mode (WXT prints the exact path), or use the
browser WXT opens for you.

## Documentation

| Doc | What it covers |
|-----|----------------|
| [`docs/SUITE-MAP.md`](docs/SUITE-MAP.md)       | Architecture, trust boundaries, the suite |
| [`docs/DATA-STREAMS.md`](docs/DATA-STREAMS.md) | The event schema and how to add a capture source |
| [`docs/THE_RING.md`](docs/THE_RING.md)         | Controlled data egress — request → grant → enforce → revoke |
| [`docs/AUTH.md`](docs/AUTH.md)                  | Key architecture and unlock tiers |
| [`docs/AI-DIRECTIONS.md`](docs/AI-DIRECTIONS.md) | Inward (build the model) vs outward (present a face) |
| [`docs/CONNECTORS.md`](docs/CONNECTORS.md)     | Connector model for external sources |
| [`docs/SKINS.md`](docs/SKINS.md)               | Theming via design tokens |

## Related

- **Vault** — the standalone encrypted personal-data backbone (Python core lib +
  localhost daemon exposing the API): [me-alter/vault](https://github.com/me-alter/vault)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The load-bearing invariant: **nothing
crosses a boundary except through an explicit, scoped, revocable permission.**

## License

[CC0 1.0 Universal](LICENSE) — public-domain dedication. Provided **as-is**, with
no warranty and no liability. See [DISCLAIMER.md](DISCLAIMER.md).
