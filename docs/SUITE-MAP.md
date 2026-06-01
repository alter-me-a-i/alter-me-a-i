# Alter/Me/A/I — architecture map

> Status: framework **settled** (membrane model), naming **locked** (2026-06-01).
> This doc defines trust boundaries. For a privacy product the trust boundary
> *is* the architecture, so it is committed before the connector/site components
> are built.

## Naming (locked)

- **Alter/Me/A/I** — the engine/extension name and displayed **wordmark**. The
  slashes are the architectural statement made visible. Spoken "Alter-Me"
  (colloquial) or "Alter-Me A I" (formal). A name to *display*, not to type into
  a browser. Hosted at **marcoajello.ai** (the hub).
- **cortex** — *retired as a brand.* It survives ONLY as the lowercase
  descriptive noun for what the mediating glyphs do (they *are* cortexes). Never
  capitalised, never a product. (Internal code slugs — the `cortex.*` storage
  keys, the `cortex` DB/package name — are this lowercase descriptive noun, so
  they stay; renaming them would break existing vaults for no brand gain.)
- **The dash** `-` = the cortex at the **user-facing surface** (alter-me,
  me-alter, …). **The slash** `/` = the cortex at the **infrastructure layer**
  (Alter/Me/A/I). Same idea, two layers — which is *why* renaming the engine to
  Alter/Me/A/I does NOT collapse it into alter-me: different glyph, different
  layer, by design.

## Architecture: hub-and-spokes (the engine at the centre)

The model is **hub-and-spokes**, not a flat product family. The hub is the only
true infrastructure; spokes are paired public/private vertices, and the engine
is the only thing that touches both sides of any pair. The pattern is fractal —
new pairs extend it infinitely.

- **Hub (centre):** Alter/Me/A/I — the open-source extension that mediates
  between public expression and private repository at every domain of life. The
  membrane. Everything interacts with it.
- **Spokes (paired vertices, each a public/private dyad):**
  - **Personae / Vault** — alter-me.ai / me-alter.ai (priority #1; built).
  - **Heuristics / Learning** — Marco's two podcasts (*Listening to Myself —
    Problem-Solving with AI* / *Talking to Myself — Learning with AI*); Substack
    for now (marcoajello.substack.com); paired domains later.
  - **Gaming / Health** (alt. Shopping / IRL) — the measurable-action axis;
    conceptual.
  - …more — each new pair is the public/private cortex pattern at one domain.

### The vertex move (every spoke is the same gesture)

Each vertex is the identical architectural move at a new domain of life:

1. one **public-facing** site — expression, performance, the *rendering*;
2. one **private-facing** site — repository, vault, the *holding*;
3. both pass through **Alter/Me/A/I** at the centre, which **encrypts the
   private side, mediates the public side**, and lets the user decide which data
   flows where.

### The fractal (recursion is a design constraint, not a metaphor)

Every vertex is *itself the whole pattern at a smaller scale*. The personae site
has its own internal public/private structure; the vault has its own; and so on
at every depth. **Implication for builds:** a vertex isn't a flat page — its
internal structure should mirror the hub's public/private split. When designing
any vertex (or any component inside one), ask "where is *its* membrane, its
public face, its private holding?" The answer should always exist.

Proxy products (alter-proxy / proxy-alter) are **parked** until the extension is
ready to distribute (they were download/setup surfaces — premature now).

## Governing principle

Alter/Me/A/I is **local-first, permission-gated**. Raw self-data lives on-device.
Nothing crosses a boundary — inward to the interpreter, or outward to the world
— except through an explicit, scoped, revocable **permission**. The membrane is
not a wall; it is a selectively-permeable gate with a doorman.

## The model: membrane → neurotype → sociotype

Identity as a cell. Raw behaviour is the environment; Cortex is the membrane;
the distilled self is the nucleus; the persona is the expressed phenotype.

```
RAW EXHAUST  →  CORTEX        →  ME-ALTER         →  ALTER-ME
your behavior   the MEMBRANE     the NEUROTYPE       the SOCIOTYPE
(capture)       filters +        aggregates +        expresses
                permission        interprets          the face,
                gate              (the model-of-you)   deployed outward
```

- **Cortex — the membrane (marcoajello.ai is its page).** Filters: capture
  gating, sensitivity classification, persona/disclosure rules, the permission
  gate. It *regulates flux*; it does not interpret. The raw exhaust lives behind
  it, on-device. The only root of trust.
- **me-alter — the neurotype.** Aggregates + interprets what the membrane lets
  through into the distilled *model-of-you* (this is the **Mind** layer:
  `profile()`, `search()`, `ask()`). How you are actually wired. The nucleus.
- **alter-me — the sociotype.** The persona expressed outward — the socially-
  legible face, shaped by the membrane's rules. How the world reads you.

Direction mapping (see [`AI-DIRECTIONS.md`](AI-DIRECTIONS.md)): me-alter =
inward/offense (B, build the model); alter-me = outward/defense (A, present a
controlled face).

## The permission rule (load-bearing)

> me-alter (the interpreter) and any outward representative may access data
> **only through Cortex's permission gate** — never via a privileged
> back-channel that bypasses it. Default-deny. Every grant is explicit, scoped
> (to *what* and *for how long*), and revocable.

- Permission is **never ambient or implied** — it is a checkable grant the gate
  consults. (The auto-lock "Unlock for 5 min" dropdown is already a primitive,
  time-scoped grant.)
- This one rule governs the whole suite: the interpreter, the sites, and any
  future connector all get *permissioned, gated passages* — not data feeds.
- The biology keeps it honest: a neurotype is intrinsic and private *by
  definition*. Host it externally and you've contradicted the word, not just a
  policy. The metaphor tells you when the design is wrong.

## Framework persists; implementation can change

The durable thing is the framework (**membrane / neurotype / sociotype,
permission-gated**). Cortex, the vault, the TF-IDF Mind, "powered by Claude" —
these are *current implementations* of it, swappable behind stable surfaces (the
Mind is already behind an interface so a neural backend can replace TF-IDF; skins
are tokens; logic is pure and engine-agnostic). Keep the framework primary and it
can be re-powered indefinitely without changing what it *means*.

## The concrete suite (domains the user owns)

```
marcoajello.ai           = the Cortex page (download / landing / hub, links out)
Cortex extension         = the membrane — local root of trust, on-device engine
me-alter.ai              = the neurotype — model-of-you / interpreter (the Mind)
alter-me.ai              = the sociotype — persona manager / outward face
Substack                 = the podcast (linked from the Cortex page, for now)
mealter.ai, me-alter.com = redirects → me-alter.ai (typo/brand protection)
```

The earlier "two proxies" (AlterMe-Proxy / Proxy-Alter-Me) are **folded into the
two sites** — their jobs become permissioned passages owned by me-alter (inward
query) and alter-me (outward representation), decided when those sites are built.
No standalone proxy products.

## Data streams — build source-pluggable from the start

The membrane must capture from **many sources**, not just web browsing. Planned
streams (design the capture layer so adding one is a new module, not a refactor):

- **Web behaviour** — navigation, search, AI exchanges (built today).
- **Gaming** — play data across platforms (Steam, console, mobile). Different
  capture surfaces; same event model.
- **Health** — *opt-in, disclosure-gated*: only what the user chooses to surface
  (steps, sleep, workouts). High sensitivity → strict permission + redaction.
- **Shopping / IRL decisions** — purchases, real-world choices; the "decide"
  side of the original protocol.

**Requirement:** every stream is a **capture source** that produces normalized
`CortexEvent`s into the same membrane → same permission gate → same neurotype.
Sensitivity classification and permission scoping are per-stream (health ≠ web).
The event schema (`lib/vault/types.ts`) and capture engine (`lib/capture`) must
stay source-agnostic so new streams plug in without touching the vault, the
Mind, or the personas. See [`DATA-STREAMS.md`](DATA-STREAMS.md).

## Implications for the current codebase

- Cortex stays **self-contained and zero-network**; everything works offline.
- Direction A / B primitives are built **engine-first, exposed second** — the
  sites/connectors expose what Cortex already does locally, through permission.
- Raw-capture access routes through an **explicit permission check**, never a
  direct privileged vault read. (Hold this true as the Mind/me-alter layer
  grows.)

## The permission gate (BUILT — Phase 2 foundation)

`lib/vault/permission.ts` is the doorman, made real. A **Grant** = `{ id, label,
scope, grantedAt, expiresAt? }`; a **GrantScope** narrows access on four axes
(`types`, `streams`, `maxSensitivity` ceiling, time window). Pure predicates
(`scopeAllows`, `grantLive`, `grantAllows`) — unit-tested (21 cases).

The vault holds live grants in memory and exposes:
- `issueGrant(label, scope, expiresAt?)` → id  (default-deny: no grant, no data)
- `revokeGrant(id)` / `listGrants()`
- `queryWithGrant(id, q)` — the single **gated** read; filters every record
  through the grant, denies unknown/expired grants (`PermissionDenied`).

**Lifetime:** session-tied by default (grants cleared on `lock()`), with an
optional per-grant `expiresAt` for tighter windows. Best-UX default + capability
when needed; persistent-until-revoked deferred until a management UI exists.

**Generic by design:** the same engine governs internal consumers now and
external ones (connectors/sites/proxies) later — they differ only in the scope
issued. First real consumer wired: **training export** runs through a grant
scoped to its sensitivity ceiling, so the gate itself (not just the transform's
redaction) guarantees nothing above the ceiling can leave as training data.

Still to do: route the **Mind** and plain **export** through grants too (now
they still call `query()` directly); a grants **management UI**; and external
consumers when they exist.
