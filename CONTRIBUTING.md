# Contributing to Alter/Me/A/I

Thanks for your interest. This project is a public-domain ([CC0 1.0](LICENSE))
effort toward personal data ownership — contributions are welcome.

## The one invariant

> **Nothing crosses a boundary — inward to the interpreter, or outward to the
> world — except through an explicit, scoped, revocable permission.**

Default-deny is load-bearing. Any change that lets data reach the Mind, an export,
a connector, or the network must route through the permission gate
(`lib/vault/permission.ts`), never via a privileged back-channel. The extension is
**zero-network** by design; keep it that way unless a feature is explicitly a
user-granted egress (see [`docs/THE_RING.md`](docs/THE_RING.md)).

## Getting set up

```sh
npm install
npm run dev        # iterate with HMR
npm test           # run before opening a PR
npm run compile    # type-check (tsc --noEmit)
```

## Guidelines

- **Read [`docs/SUITE-MAP.md`](docs/SUITE-MAP.md) first** — it defines the trust
  boundaries and the membrane/neurotype/sociotype model the code follows.
- **Keep capture source-agnostic.** Adding a data stream should be a new module,
  not a refactor of the vault, Mind, or personas. See
  [`docs/DATA-STREAMS.md`](docs/DATA-STREAMS.md).
- **Match the surrounding style** and keep logic pure/testable where it already
  is. Add tests for new behaviour (`*.test.mts`).
- **No secrets, no personal data** in commits — ever.

## Contributor terms

By contributing, you agree that your contributions are dedicated to the public
domain under [CC0 1.0 Universal](LICENSE), consistent with the rest of the
project.
