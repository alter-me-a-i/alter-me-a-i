# Cortex connectors — the sockets (R2D2)

> **The vision:** Cortex is R2D2 *and* C3PO in one. R2D2 = jacks into any port,
> carries data home (the **connectors** here). C3PO = speaks every format,
> interprets it (the **Mind / neurotype**). The membrane is the body that holds
> both. This doc is the R2D2 half: the socket every data source plugs into.

A **connector** authenticates to one source (with explicit permission), pulls,
and normalizes into `CortexEvent`s that flow through the *same* membrane →
permission gate → neurotype as every other stream. Adding a source = implement
the `Connector` interface in `lib/connectors/types.ts`. Never a vault/Mind
refactor.

## The honest runtime wall

A browser extension is sandboxed. It **cannot**: scan your drive autonomously,
hold MyChart/OAuth tokens for background bulk pulls, or keep persistent sockets.
So connectors declare a **runtime**:

- **`extension`** — runs in the extension. Reach: the DOM (browser-based games,
  on-page choices), a single user-granted folder (File System Access), a
  user-pasted API key (Steam).
- **`companion`** — needs the **Cortex companion** (a local desktop app / native
  host, NOT yet built). Only it can scan a media library, run SMART-on-FHIR
  OAuth against a health portal, bulk-download exports to your drive, and run
  scheduled pulls. It feeds normalized events to Cortex **through the same
  permission gate** — the nucleus still never leaves the device (zero-egress
  holds; the companion is just another local organ behind the membrane).

> R2D2 fully realized **requires the companion app.** The extension alone is a
> partial R2D2 (browser-reachable sources only). This is the long-deferred
> "is there a component beyond the extension?" question — and the vision answers
> it: yes, a *local* companion. Still on-device. Still permission-gated.

## Planned connectors and the standards they speak

Like decisions→xAPI, each connector maps to a real format — we don't invent.

| Connector | stream | runtime | auth | standard | pulls |
|-----------|--------|---------|------|----------|-------|
| **steam** | gaming | extension | apikey | Steam Web API | owned games + playtime (commitment) |
| **browser-games** | gaming | extension | none | DOM | in-game *decisions* (choice text) — the unmasked signal |
| **mychart / epic** | health | companion | oauth | **FHIR R4 / SMART-on-FHIR** | conditions, meds, labs, visits (opt-in) |
| **apple-health** | health | companion | file | Apple Health export (XML) | steps, sleep, workouts |
| **blue-button** | health | companion | file | **Blue Button** / C-CDA | claims, records |
| **local-media** | (web/media) | companion | file | **ID3** (audio), **EXIF** (images), **M3U** (playlists) | songs, photos, playlists, "things you like" |
| **spotify** | (media) | companion | oauth | Spotify Web API | top tracks/artists, playlists |
| **shopping** | shopping | companion/extension | file/oauth | order-history exports / receipts | purchases (IRL "decide") |

Health connectors default to **`sensitive`/`secret`**, are **opt-in**, redacted,
and excluded from training unless the user explicitly raises the cap. Pulling any
connector is an explicit, scoped, **revocable** `ConnectorGrant` — default-deny,
never ambient (the permission rule from SUITE-MAP).

## "Download all of this to our drive"

Two distinct things, kept distinct:

1. **Capture** = normalized events into the encrypted vault (the corpus). Done
   via connectors → membrane.
2. **Archive to disk** = keeping the *raw source files* (the FHIR bundle, the
   media, the export) on your drive. This is the companion's job (the extension
   can only write to one granted folder on demand — see `lib/training/
   destination.ts`, the same File System Access mechanism). The companion can
   maintain a real local archive directory.

Both stay on-device. Nothing uploads.

## Status

- **Built**: the `Connector` socket contract + `ConnectorGrant` permission shape
  (`lib/connectors/types.ts`). Typechecks; no connector implemented yet.
- **Not built**: any concrete connector, the per-connector permission UI, and —
  critically — the **companion app** that `runtime: 'companion'` connectors
  need. Extension-runtime connectors (steam, browser-games) can be built now;
  companion ones are blocked on the companion existing.
