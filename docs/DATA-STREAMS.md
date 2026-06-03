# Cortex data streams

Cortex captures from many **life-streams**, not just web browsing. A stream is a
*source domain*; every stream feeds the same cortex → permission gate →
neurotype (the Mind). Adding a stream must be a **new module, never a refactor**
of the vault, Mind, or personas.

See the suite framing in [`SUITE-MAP.md`](SUITE-MAP.md) and the directions in
[`AI-DIRECTIONS.md`](AI-DIRECTIONS.md).

## The model

```
SOURCE (per stream)  →  normalize  →  CortexEvent  →  cortex
 web / gaming /          to the         {stream, type,    • sensitivity
 health / shopping       shared         source, …}        • permission gate
                         schema                            → vault → Mind
```

Two orthogonal axes on every event (`lib/vault/types.ts`):

- **`type`** = the *shape* of the observation — `navigation | interaction |
  ai_exchange | disclosure`. (Shared across streams.)
- **`stream`** = the *source domain* it came from — `web | gaming | health |
  shopping`. Absent ⇒ `'web'` (back-compat: pre-existing events are web).

A search on Steam and a search on Google are both `type: 'interaction',
action: 'search'` — they differ only in `stream` and provenance. That's the
point: one schema, many sources.

## Provenance varies by stream

`Provenance` no longer assumes a web origin. `host` is optional; non-web events
carry `app` instead. Always read a source label via **`originLabel(event)`**
(returns host → app → stream → 'web', never undefined) — never `source.host`
directly, or non-web events show as `undefined`.

| Stream | provenance | example event |
|--------|-----------|---------------|
| `web` | `host`, `url`, `tabId` | navigation on nytimes.com |
| `gaming` | `app` (e.g. "Steam") | interaction/search for a game; ai_exchange with an in-game assistant |
| `health` | `app` (e.g. "Apple Health") | interaction carrying a metric (opt-in) |
| `shopping` | `host` or `app` (store) | interaction/`submit` = a purchase (an IRL "decide") |

## Per-stream sensitivity + permission (NOT uniform)

Health ≠ web. Each stream sets its own **sensitivity** (drives redaction +
whether it may feed training) and its own **permission** scope at the cortex:

- **web** — `personal` by default; sensitive hosts (bank/health/gov) bump up.
- **gaming** — usually `public`/`personal`; low stakes.
- **health** — `sensitive` or `secret` by default. **Opt-in only**, disclosure-
  gated, redacted aggressively, excluded from training unless the user
  explicitly raises `maxSensitivity`. Never captured silently.
- **shopping** — `personal`/`sensitive` (amounts, addresses redacted).

The permission rule from SUITE-MAP applies per stream: capturing a stream is a
**granted, scoped, revocable** permission, never ambient. Turning on health
capture is an explicit grant; it can be revoked, and revocation stops capture.

## How to add a stream (contributor recipe)

1. **Schema**: if the source needs a new event *shape*, add a member to the
   `CortexEvent` union in `lib/vault/types.ts`. If it fits an existing shape
   (most do — searches/visits/exchanges), just set `stream` + `source.app`.
2. **Capture source**: write a module that observes the source and emits
   normalized `NewEvent`s. Web sources live in `lib/capture` (content scripts);
   a non-web source (e.g. a Steam API poller in the background, or an imported
   export) is its own module that calls `vault.append` via the same message.
3. **Sensitivity**: extend `lib/capture/sensitivity.ts` so the stream's events
   classify correctly (health → sensitive/secret).
4. **Permission**: gate capture behind an explicit per-stream toggle (model it
   like the capture/defense settings already in `lib/capture/settings.ts`).
5. **Nothing else changes.** The Mind, trajectory export, personas, and vault
   are source-agnostic (they read `originLabel()`), so a new stream becomes
   searchable / trainable / profile-able for free.

## The `decision` event — unmasked revealed preference

The most valuable cross-stream signal is the **decision**: a choice made among
options, often with no audience (a single-player game choice is the purest
case — revealed preference under low social surveillance). It's a **first-class
event type**, not an interaction variant, because the structure *is* the signal:

```
DecisionEvent { prompt, options[{id,label,chosen}], chosen, rationale?, outcome?, weight? }
```

It feeds the neurotype (prompt + chosen label + rationale + outcome become
trainable text) and is shared across streams — a game choice, a purchase, an IRL
decision are all `type: 'decision'`, differing only in `stream`/`source`.

**Standards bridge (xAPI):** there is no dedicated "decision data" standard, but
**xAPI** (Experience API / Tin Can — actor·verb·object·result) is the closest,
designed for capturing choices/experiences including in games, stored in a
Learning Record Store. `lib/vault/xapi.ts` maps a `DecisionEvent` losslessly to
an xAPI statement (verb=`chose`, response=chosen id, choices=options, context=
stream/source, pseudonymous actor by default). So Cortex stays a lean local
schema **and** interoperates with standard tooling / game telemetry. (schema.org
`ChooseAction` is the lighter alternative if xAPI proves too heavy.)

## Status

- **Built**: the `web` stream (navigation, interaction, ai_exchange,
  disclosure) + the `stream`/`app` seam + `originLabel()` + the first-class
  `decision` event + the xAPI bridge. A host-less gaming event AND a game
  `decision` event are unit-tested end-to-end through the Mind + xAPI.
- **Not built**: actual gaming / health / shopping *capture sources* (the things
  that emit these events), and the per-stream permission toggles. The schema,
  the neurotype wiring, and the standards bridge are ready for them.
