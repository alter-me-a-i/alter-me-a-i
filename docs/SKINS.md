# Making a Cortex skin

A **skin** recolours the whole Cortex UI. It is *only* a set of CSS custom
properties — no layout, no markup. Because every component reads these tokens
(`var(--bg)`, `var(--accent)`, …) and never hard-codes a colour, a skin can
restyle everything but can't break anything.

Cortex ships three: **Synthwave** (default, 80s neon), **Daylight** (clean
light), **Terminal** (green-phosphor CRT).

## Add your own in 3 steps

### 1. Define the tokens (two modes)

A skin defines BOTH a **dark** and a **light** variant. The popup has a
light/dark toggle (`data-mode` on `<html>`), independent of which skin is
active. In [`entrypoints/popup/skins.css`](../entrypoints/popup/skins.css),
add two blocks:

```css
[data-skin='myskin'][data-mode='dark'] {
  --bg: …; --surface: …; --surface-2: …; --border: …;
  --fg: …; --muted: …; --faint: …;
  --accent: …; --accent-2: …; --accent-fg: …;
  --danger: …; --ok: …; --shadow: …;
  --scheme: dark;
}
[data-skin='myskin'][data-mode='light'] {
  /* same tokens, light surfaces/text — keep your accent identity */
  --scheme: light;
}
```

Keep the skin's **accent** recognisable across both modes; just flip the
neutral surfaces/text. (See `synthwave` or `vaporwave` for a worked pair.)

### 2. Register it

Add one entry to `SKINS` in [`lib/skins/index.ts`](../lib/skins/index.ts):

```ts
{ id: 'myskin', name: 'My Skin', blurb: 'Short flavour', defaultMode: 'dark' },
```

The `id` **must** match the `[data-skin='…']` selector. `defaultMode` is the
mode the skin opens in before the user touches the light/dark toggle.

### 3. Done

It appears in the popup's **Appearance** picker automatically. Selecting it
sets `<html data-skin="vaporwave">` and persists to `chrome.storage.local`.

## The token contract

Every skin must define **all** of these — none is optional, because the UI
assumes each resolves:

| Token | Used for |
|-------|----------|
| `--bg` | page background |
| `--surface` | panels, cards, controls |
| `--surface-2` | hover / pressed surface |
| `--border` | hairlines, dividers, outlines |
| `--fg` | primary text |
| `--muted` | secondary text |
| `--faint` | tertiary text, section headings |
| `--accent` | selection, primary action, hero number |
| `--accent-2` | links, secondary highlights |
| `--accent-fg` | text on an `--accent` fill |
| `--danger` | destructive action (Erase) |
| `--ok` | positive status (unlocked dot) |
| `--shadow` | popup elevation |
| `--scheme` | `dark` or `light` (native controls) |

`--radius`, `--radius-sm`, `--font`, `--font-display`, `--mono`,
`--glyph-sun`, `--glyph-moon`, `--fill-primary` are shared in `:root` with
neutral defaults; a skin may override them:
- the two glyph tokens are the light/dark toggle's icon (e.g. `'☀'`/`'☾'` by
  default, `'*'`/`')'` for the retro skins) — set them as CSS string values;
- `--fill-primary` is the Unlock button / lock-badge fill. It defaults to a
  neon gradient; flat-era skins (Terminal, C64) set it to `var(--accent)` so
  there are no gradients.

### Shipping a font with your skin

Fonts default to the system stack so the base UI stays neutral. To carry a font
(like the **Commodore 64** skin does):

1. Drop the font file in `public/fonts/` (it ships inside the extension — never
   load from a CDN; Cortex sends nothing off-device). Include its license.
2. Declare an `@font-face` at the top of `skins.css`.
3. In your skin block, set `--font` (body/data), `--font-display` (wordmark),
   and/or `--mono`. Add a small `font-size` bump if your face renders condensed:
   ```css
   html[data-skin='yourskin'] body { font-size: 16px; }
   ```

See the `commodore64` skin for a complete, working example (VT323 + Press Start 2P).

## Accessibility (please don't skip)

Cortex is meant to be usable by everyone. Keep contrast at **WCAG AA**:

- `--fg` on `--bg`: ≥ **4.5:1**
- `--muted` on `--surface`: ≥ **4.5:1** (it's real text, not decoration)
- `--accent` on `--bg`, and `--border` on `--bg`: ≥ **3:1**
- `--accent-fg` on `--accent`: ≥ **4.5:1**

Quick check: paste two tokens into any contrast checker (e.g. WebAIM). Neon on
black is easy to get wrong — verify the dim label tokens especially.

## Why it's safe

- Skins are pure token swaps; they can't touch layout or behaviour.
- The UI degrades gracefully: an unknown/missing skin id falls back to the
  default (`getSkin()` in `lib/skins/index.ts`).
- Nothing leaves the device — the chosen skin id is stored locally.
