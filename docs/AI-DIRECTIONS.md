# Cortex: the two AI directions

Cortex grows along two opposite-facing axes. They share one foundation (the
encrypted vault + the persona/settings system) but point in opposite
directions. Keeping them distinct is the core mental model of the project.

```
        ┌─────────────────────── THE VAULT ───────────────────────┐
        │   encrypted, local-first corpus of your own behaviour     │
        └───────────────▲───────────────────────────▼──────────────┘
                        │                           │
              feeds (offense)              governs (defense)
                        │                           │
   ┌────────────────────┴─────┐      ┌──────────────┴────────────────────┐
   │  B · PERSONAL AI          │      │  A · AI PERSONAS                   │
   │  inward — a model of YOU  │      │  outward — a face you SHOW         │
   │  "build your own AI"      │      │  "gate your data"                  │
   └───────────────────────────┘      └────────────────────────────────────┘
```

---

## Direction A — AI Personas (defense / outward)

**Question it answers:** *"What are sites and AIs allowed to learn about me?"*

**Built today:** persona presets (Ghost / Pseudonym / Casual / Custom / Open),
the fingerprint gate (MAIN-world `navigator` normalisation), tracker blocking,
third-party cookie + referrer stripping, URL tracking-param cleaning. Every
defensive act logs a `disclosure` event, so defense also *feeds* the vault.

**Frontier (unbuilt):** personas currently govern *passive* leakage. The next
layer is **active AI interactions** — when YOU prompt ChatGPT/Claude/Gemini,
the persona governs what personal context leaves your machine:

- **A1 · Prompt redaction.** Before a prompt is sent on an AI surface, scrub
  PII (emails, phone, cards, names) per the active persona. Reuse the existing
  `redactText()` from `lib/vault/trajectory.ts`. Log a `disclosure`
  (`decision: 'redacted'`, `field: 'prompt_pii'`). Ghost redacts aggressively;
  Open does nothing.
- **A2 · Consistent pseudonym.** Present a stable fake identity (name, locale)
  to AI surfaces that ask, so you're coherent-but-not-you across sessions.
- **A3 · Disclosure prompts.** When a site/AI requests a data category
  (location, contacts), the persona decides reveal/withhold/redact and records
  it — wiring the `DisclosureEvent.field`/`policy` model that already exists.

---

## Direction B — Personal AI (offense / inward)

**Question it answers:** *"What can I learn — and build — from my own data?"*

**Built today:** capture (navigation / interaction / ai_exchange) → encrypted
vault → the **Mind** (`lib/mind`: TF-IDF profile + semantic search) → JSONL
trajectory export (`lib/vault/trajectory.ts`) → a user-chosen training folder
(`lib/training/destination.ts`).

**Frontier (unbuilt):** make the model-of-you genuinely *useful* and the
training data genuinely *fine-tune-ready*:

- **B1 · Query yourself.** A "chat with your corpus" surface on top of
  `Mind.search()` — ask "what have I been researching about X" and get an
  answer grounded in your own captured history, with sources. Pure/local
  first (retrieval + template synthesis); an optional LLM backend later.
- **B2 · Better training data.** Richer trajectory shaping (more event kinds
  → samples), quality filtering (drop thin/dupe samples), dataset stats shown
  before export ("412 samples · 1.2M tokens · 3 redactions"). Makes the JSONL
  actually fine-tune-grade.
- **B3 · Auto-sync.** With a training folder granted, flush new samples to it
  after each capture session (within permission), so the corpus stays current
  without manual Sync.
- **B4 · Embeddings upgrade.** Swap TF-IDF for on-device embeddings behind the
  existing `Mind` surface — better search/profile, still zero-egress.

---

## Shared foundation (don't duplicate)

Both directions lean on the same primitives — build once, reuse:

| Primitive | Lives in | Used by |
|-----------|----------|---------|
| Encrypted event log | `lib/vault` | A (disclosure log) + B (corpus) |
| Persona / settings | `lib/defense/settings`, `personas` | A (rules) + B (redaction level for export) |
| PII redaction | `lib/vault/trajectory.ts` `redactText()` | A1 (prompts) + B2 (training) |
| Capture engine | `lib/capture` | B (feeds) + A (knows AI surfaces via `startAi`) |
| `disclosure` event | `lib/vault/types.ts` | A (every gate) |

**Key shared insight:** the **persona is the dial for both**. The same Ghost↔Open
slider that decides *what a site sees* (A) also sets *how aggressively training
data is redacted* (B, via `TrajectoryOptions.maxSensitivity`/`redact`). One
control, both directions.

---

## Build order (incremental slices)

Each slice is independently shippable and testable. Suggested sequence —
alternating so both directions advance:

1. **B2 (partial) — dataset stats** before export ("N samples · ~T tokens").
   Small, immediately useful, pure. *(good first slice)*
2. **A1 — prompt PII redaction** on AI surfaces. Reuses `redactText`; high-value
   privacy win; logs disclosures.
3. **B1 — query-yourself surface** over `Mind.search` (retrieval + template
   synthesis, no LLM).
4. **B3 — training auto-sync** to the granted folder.
5. **A2 / B4** — later, larger (pseudonym identity; embeddings).

Pure logic stays in `lib/**` (unit-tested under tsx/happy-dom); only wiring
touches `entrypoints/**`. Nothing leaves the device by default.
