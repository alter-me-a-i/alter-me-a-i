/*
 * The status bar — the membrane made visible at the edge of the page.
 *
 * A small, dismissible corner bar showing three live states as TEXT (no icons /
 * clip-art): Protection (the active persona), Capture (on/off), and Vault
 * (locked/unlocked). Chrome extensions can't draw in the browser footer, so this
 * is the always-visible on-page surface.
 *
 * Isolated in a closed shadow root so page CSS can't touch it and ours can't
 * leak. Reads settings directly from storage (cheap) and asks the background for
 * lock state. Dismissible per-page; a remembered "hidden" pref turns it off.
 */

import { loadDefenseSettings } from '../lib/defense/settings';
import { getProfile } from '../lib/defense/personas';
import { loadCaptureSettings } from '../lib/capture/settings';
import { sendToBackground } from '../lib/messages';
import { loadMode, loadSkinId } from '../lib/skins';
import { chipColors, chipStyle, type ChipColors, type ChipStyle } from '../lib/skins/chip-palette';

const HIDE_KEY = 'alter-me-a-i.chip.hidden';
const COUNT_KEY = 'alter-me-a-i.chip.count'; // show the library count segment (default on)

export default defineContentScript({
  matches: ['<all_urls>'],
  // document_end (not _idle) so WXT registers this as its OWN content-script
  // entry rather than merging it with the capture script (same matches+runAt
  // get grouped, and the merge was preventing the chip's main() from running).
  runAt: 'document_end',
  allFrames: false,
  async main() {
    let dismissedThisPage = false;

    const apply = async () => {
      // Hide pref, or dismissed for this page → ensure nothing is shown.
      let hidden = false;
      try {
        const pref = await browser.storage.local.get(HIDE_KEY);
        hidden = pref[HIDE_KEY] === true;
      } catch {
        /* show by default */
      }
      if (hidden || dismissedThisPage) {
        unmountBar();
        return;
      }
      renderBar(await gatherState(), () => {
        dismissedThisPage = true;
        unmountBar();
      });
    };

    await apply();

    // LIVE: re-render when anything the bar shows changes — persona, capture,
    // the count pref, or the lock state (the vault session lives in storage too,
    // so unlock/lock flips a key). This is what keeps the bar from going stale
    // after you change something in the popup. Cheap: only fires on real writes.
    browser.storage.onChanged.addListener((_changes, area) => {
      if (area === 'local' || area === 'session') void apply();
    });

    // Lock state lives in storage.session, whose onChanged is unreliable in
    // content scripts (MV3 gap) — so persona/capture update live but lock didn't.
    // Re-check whenever the tab regains focus/visibility: that's exactly the
    // gesture after unlocking in the popup, so VAULT (and the count) refresh with
    // no page reload and no background plumbing.
    window.addEventListener('focus', () => void apply());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void apply();
    });
  },
});

/** Read all four states fresh (best-effort; never throws). */
async function gatherState(): Promise<BarState> {
  const defense = await loadDefenseSettings();
  const personaId = defense.enabled ? defense.activePersona : 'open';
  const capture = await loadCaptureSettings();

  let showCount = true;
  try {
    const p = await browser.storage.local.get(COUNT_KEY);
    showCount = p[COUNT_KEY] !== false;
  } catch {
    /* default on */
  }

  let unlocked = false;
  let count: number | null = null;
  try {
    const status = await sendToBackground({ type: 'vault.status' });
    unlocked = status.ok && 'unlocked' in status && status.unlocked;
    if (unlocked && showCount) {
      const stats = await sendToBackground({ type: 'vault.stats' });
      if (stats.ok && 'stats' in stats) count = stats.stats.total;
    }
  } catch {
    /* background asleep — show what we know */
  }

  // Match the active skin × mode (resolved from the small chip palette, since a
  // content script can't read the popup's skins.css tokens).
  const skinId = await loadSkinId();
  const mode = (await loadMode()) ?? 'dark';

  return {
    personaName: getProfile(personaId).name,
    captureOn: capture.enabled,
    unlocked,
    count: showCount ? count : null,
    colors: chipColors(skinId, mode),
    style: chipStyle(skinId),
  };
}

interface BarState {
  personaName: string;
  captureOn: boolean;
  unlocked: boolean;
  /** Library item count, or null to hide the segment. */
  count: number | null;
  /** Active skin × mode colours. */
  colors: ChipColors;
  /** Active skin font + shape. */
  style: ChipStyle;
}

const MOUNT_ID = 'alter-me-a-i-status-bar';
// The closed shadow root persists across re-renders so updates are in-place
// (no flicker, listener survives). Kept module-level so apply() can re-render.
let barRoot: ShadowRoot | null = null;

function unmountBar(): void {
  document.getElementById(MOUNT_ID)?.remove();
  barRoot = null;
}

/** Mount once, then re-render the contents on every state change (live). */
function renderBar(state: BarState, onDismiss: () => void): void {
  if (!barRoot) {
    const existing = document.getElementById(MOUNT_ID);
    if (existing) existing.remove();
    const holder = document.createElement('div');
    holder.id = MOUNT_ID;
    holder.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    (document.body || document.documentElement).appendChild(holder);
    barRoot = holder.attachShadow({ mode: 'closed' });
  }
  const root = barRoot;

  // Text-only status — no icons/clip-art. label : value segments.
  const c = state.colors;
  const s = state.style;
  const seg = (label: string, value: string, on: boolean) =>
    `<span class="seg"><span class="k">${escapeHtml(label)}</span><span class="v ${on ? 'on' : 'off'}">${escapeHtml(value)}</span></span>`;

  // @font-face must live in the DOCUMENT, not the (closed) shadow root — fonts
  // declared inside a shadow root are frequently ignored by the loader. Inject
  // once into <head>; the shadow's font-family then resolves against it.
  ensureFontFaces();

  root.innerHTML = `
    <style>
      .bar {
        position: fixed;
        bottom: 12px;
        right: 12px;
        display: inline-flex;
        align-items: center;
        gap: 0;
        padding: 0;
        font-family: ${s.font};
        font-size: ${s.fontSize};
        line-height: 1;
        color: ${c.fg};
        background: ${c.bg};
        border: 1px solid ${c.border};
        border-radius: ${s.radius};
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        overflow: hidden;
        user-select: none;
        backdrop-filter: blur(4px);
      }
      .seg {
        display: inline-flex;
        align-items: baseline;
        gap: 5px;
        padding: 7px 11px;
        white-space: nowrap;
        border-right: 1px solid ${c.border};
      }
      .k { font-size: 0.8em; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.55; }
      .v { font-weight: 700; letter-spacing: ${s.tracking}; }
      .v.on { color: ${c.on}; }
      .v.off { color: ${c.off}; }
      .x {
        padding: 7px 9px;
        cursor: pointer;
        opacity: 0.5;
        font-weight: 700;
        font-size: 13px;
        line-height: 1;
      }
      .x:hover { opacity: 1; }
    </style>
    <div class="bar" role="status" aria-label="Alter/Me/A/I status bar">
      ${seg('Protection', state.personaName, state.personaName !== 'Open')}
      ${seg('Capture', state.captureOn ? 'On' : 'Off', state.captureOn)}
      ${seg('Vault', state.unlocked ? 'Unlocked' : 'Locked', state.unlocked)}
      ${state.count != null ? seg('Items', String(state.count), true) : ''}
      <span class="x" title="Hide for this page" data-act="dismiss">×</span>
    </div>
  `;

  root.querySelector('[data-act="dismiss"]')?.addEventListener('click', onDismiss);
}

/**
 * Inject the bundled skin fonts into the DOCUMENT head once. Fonts declared
 * inside a closed shadow root are often ignored by the loader, so they must live
 * at document scope; the shadow's font-family then resolves against them. The
 * files are web_accessible_resources (see wxt.config.ts). Falls back to system
 * fonts gracefully if loading fails.
 */
function ensureFontFaces(): void {
  const id = 'alter-me-a-i-bar-fonts';
  if (document.getElementById(id)) return;
  const get = browser.runtime.getURL as (p: string) => string;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    @font-face { font-family: 'PixelBody'; src: url('${get('/fonts/VT323-Regular.ttf')}') format('truetype'); font-display: swap; }
    @font-face { font-family: 'Eurostyle'; src: url('${get('/fonts/Michroma-Regular.ttf')}') format('truetype'); font-display: swap; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
