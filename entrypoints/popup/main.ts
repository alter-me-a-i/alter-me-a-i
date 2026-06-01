import './style.css';
import { browser } from 'wxt/browser';
import { sendToBackground } from '../../lib/messages';
import { applyTheme, getSkin, initSkin, saveMode, saveSkinId, SKINS, type Mode } from '../../lib/skins';
import { loadCaptureSettings, saveCaptureSettings } from '../../lib/capture/settings';
import { loadDefenseSettings, profileFor, saveDefenseSettings } from '../../lib/defense/settings';
import {
  GATE_FLAGS,
  PERSONA_ORDER,
  PERSONA_PROFILES,
  type GateFlag,
  type PersonaId,
} from '../../lib/defense/personas';
import {
  FLAG_EXPLANATIONS,
  personaProtectionDetails,
  WHY_MORE_THAN_COOKIES,
} from '../../lib/defense/explain';
import {
  clearTrainingFolder,
  ensurePermission,
  fsAccessAvailable,
  getTrainingFolder,
  pickTrainingFolder,
  writeToFolder,
} from '../../lib/training/destination';
import {
  assertPasskeyWithPrf,
  createPasskeyWithPrf,
  enrollPasskeyLargeBlob,
  readPasskeyLargeBlob,
  webauthnAvailable,
  type PrfResult,
} from '../../lib/auth/webauthn';

const app = document.querySelector<HTMLDivElement>('#app')!;
const render = (html: string) => (app.innerHTML = html);


/** Monochrome line-art lock, currentColor. */
const LOCK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** Monochrome line-art key, currentColor. */
const KEY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l8 8m-3 0l3-3m-5-2l2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;


function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/* --- collapsible sections -------------------------------------------------- */

const COLLAPSE_KEY = 'cortex.collapsed';

/** Set of collapsed section ids, persisted locally (sync — no async on render). */
function collapsedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function setCollapsed(id: string, collapsed: boolean): void {
  const set = collapsedSet();
  collapsed ? set.add(id) : set.delete(id);
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable — collapse just won't persist */
  }
}

/** Render a collapsible section: clickable heading (＋/－ marker) + body. */
function section(id: string, title: string, bodyHtml: string): string {
  const collapsed = collapsedSet().has(id);
  return `
    <section class="sec" data-section="${id}">
      <button class="sec-head" aria-expanded="${!collapsed}" data-collapse="${id}">
        <span class="label">${esc(title)}</span>
      </button>
      <div class="sec-body"${collapsed ? ' hidden' : ''}>${bodyHtml}</div>
    </section>`;
}

async function refresh() {
  const status = await sendToBackground({ type: 'vault.status' });
  if (!('unlocked' in status) || !status.unlocked) await renderLocked();
  else await renderHome();
}

// --- locked -----------------------------------------------------------------

/* "Unlock for…" durations. value is ttlMs: 0 = until idle (~30s, the strict
   default), a number = ms kept alive across worker restarts, null = until the
   browser closes. The chosen value is remembered in localStorage. */
const UNLOCK_DURATIONS: Array<{ label: string; value: number | null }> = [
  { label: 'until idle', value: 0 },
  { label: '5 minutes', value: 5 * 60_000 },
  { label: '15 minutes', value: 15 * 60_000 },
  { label: '1 hour', value: 60 * 60_000 },
  { label: 'until browser closes', value: null },
];
const TTL_KEY = 'cortex.unlock.ttl';

function savedTtl(): number | null {
  try {
    const raw = localStorage.getItem(TTL_KEY);
    if (raw === 'null') return null;
    if (raw != null) return Number(raw);
  } catch {
    /* ignore */
  }
  return 5 * 60_000; // sensible default: 5 minutes
}

function rememberTtl(v: number | null): void {
  try {
    localStorage.setItem(TTL_KEY, v === null ? 'null' : String(v));
  } catch {
    /* ignore */
  }
}

/** The currently-selected ttl from the lock-screen dropdown (or saved default). */
function selectedTtl(): number | null {
  const sel = document.querySelector<HTMLSelectElement>('#ttl');
  if (!sel) return savedTtl();
  return sel.value === 'null' ? null : Number(sel.value);
}

async function renderLocked() {
  // Offer a passkey unlock only if one is enrolled and WebAuthn is available.
  const methodsRes = await sendToBackground({ type: 'auth.methods' });
  const methods = methodsRes.ok && 'methods' in methodsRes ? methodsRes.methods : [];
  const hasPasskey = methods.some((m) => m.method === 'webauthn');
  const showPasskey = hasPasskey && webauthnAvailable();

  render(`
    <div class="lock-screen">
      <div class="lock-mark">${LOCK}</div>
      <h1 class="brand brand-lg">Alter/Me/A/I</h1>
      <p class="subtitle subtitle-center">A private memory you own — local and encrypted.</p>
      <form class="unlock-form" id="unlock">
        <input id="phrase" type="password" placeholder="Passphrase" autocomplete="current-password" aria-label="Passphrase" />
        <label class="ttl-row">
          <span class="ttl-label">Unlock for</span>
          <select id="ttl" aria-label="Stay unlocked for">
            ${UNLOCK_DURATIONS.map((d) => {
              const v = d.value === null ? 'null' : String(d.value);
              const cur = savedTtl();
              const isSel = (d.value === null && cur === null) || d.value === cur;
              return `<option value="${v}"${isSel ? ' selected' : ''}>${d.label}</option>`;
            }).join('')}
          </select>
        </label>
        <button class="btn-primary" type="submit">Unlock</button>
        ${showPasskey ? `<button class="btn-secondary" type="button" id="passkey">${KEY} Unlock with passkey</button>` : ''}
      </form>
      <p class="note note-center">Encrypted on this device. There is no recovery — only you hold the key.</p>
      <p id="err" class="err" role="alert"></p>
    </div>
  `);
  const form = document.querySelector<HTMLFormElement>('#unlock')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phrase = document.querySelector<HTMLInputElement>('#phrase')!.value;
    if (!phrase) return;
    const ttlMs = selectedTtl();
    rememberTtl(ttlMs);
    const res = await sendToBackground({ type: 'vault.unlock', passphrase: phrase, ttlMs });
    if (res.ok) refresh();
    else document.querySelector('#err')!.textContent = res.error;
  });

  if (showPasskey) {
    document.querySelector('#passkey')!.addEventListener('click', async () => {
      const err = document.querySelector('#err')!;
      err.textContent = '';
      try {
        // Try PRF first, then largeBlob — match whichever method was enrolled.
        let secret = null;
        try {
          secret = await assertPasskeyWithPrf();
        } catch {
          secret = null;
        }
        if (!secret) secret = await readPasskeyLargeBlob();
        if (!secret) { err.textContent = 'This passkey can’t unlock the vault.'; return; }
        const ttlMs = selectedTtl();
        rememberTtl(ttlMs);
        const res = await sendToBackground({
          type: 'auth.webauthn.unlock',
          credentialId: Array.from(secret.credentialId),
          prfOutput: Array.from(secret.prfOutput),
          ttlMs,
        });
        if (res.ok) refresh();
        else err.textContent = res.error;
      } catch (e) {
        err.textContent = String((e as Error)?.message ?? e);
      }
    });
  }
  document.querySelector<HTMLInputElement>('#phrase')!.focus();
}

// --- home -------------------------------------------------------------------

async function renderHome() {
  const statsRes = await sendToBackground({ type: 'vault.stats' });
  const stats = statsRes.ok && 'stats' in statsRes ? statsRes.stats : null;
  const capture = await loadCaptureSettings();
  const defense = await loadDefenseSettings();
  const active: PersonaId = defense.enabled ? defense.activePersona : 'open';

  // Passkey status drives the header chip; if none is enrolled we offer to add
  // one in the SECURITY section. One source, shown in one place.
  const methodsRes = await sendToBackground({ type: 'auth.methods' });
  const methods = methodsRes.ok && 'methods' in methodsRes ? methodsRes.methods : [];
  const hasPasskey = methods.some((m) => m.method === 'webauthn');

  // Training destination — the folder the corpus is aggregated into.
  const fsOk = fsAccessAvailable();
  const trainingFolder = fsOk ? await getTrainingFolder() : null;

  // Active skin + mode, for the appearance picker and the light/dark toggle.
  const skinId = document.documentElement.getAttribute('data-skin') ?? 'synthwave';
  const mode = (document.documentElement.getAttribute('data-mode') as Mode) ?? 'dark';

  // On-page status bar: shown unless hidden; its count segment is opt-out.
  const chipPref = await browser.storage.local.get(['cortex.chip.hidden', 'cortex.chip.count']);
  const chipHidden = chipPref['cortex.chip.hidden'] === true;
  const countShown = chipPref['cortex.chip.count'] !== false;

  // Breakdown as an aligned monospace tally: label left, count right.
  const breakdown = stats
    ? Object.entries(stats.byType)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([t, n]) =>
            `<span class="tally"><span class="tally-k">${esc(t)}</span><span class="tally-n">${n}</span></span>`,
        )
        .join('')
    : '';

  const options = PERSONA_ORDER.map((id) => {
    const p = PERSONA_PROFILES[id];
    const on = id === active;

    // Custom: editable toggle rows (label + live switch + trade-off), each its
    // own paired unit — no separate read-only list.
    // Presets: read-only "what this does" rows (hide-text + trade-off).
    let detailBody: string;
    if (id === 'custom') {
      detailBody = `<div class="detail-rows">${GATE_FLAGS.map((f: GateFlag) => {
        const fx = FLAG_EXPLANATIONS[f];
        return `
          <label class="drow drow-edit">
            <span class="drow-text">
              <span class="drow-title">${esc(fx.label)}</span>
              <span class="drow-trade">${esc(fx.tradeoff || 'No notable downside.')}</span>
            </span>
            <span class="switch switch-sm">
              <input type="checkbox" class="cust-flag" data-flag="${f}" ${defense.custom[f] ? 'checked' : ''} aria-label="${esc(fx.label)}" />
              <span class="track"></span>
            </span>
          </label>`;
      }).join('')}</div>`;
    } else {
      const details = personaProtectionDetails(profileFor(defense, id));
      detailBody = details.length
        ? `<div class="detail-rows">${details
            .map(
              (d) =>
                `<div class="drow">
                  <span class="drow-text">
                    <span class="drow-title">${esc(d.hides)}</span>
                    ${d.tradeoff ? `<span class="drow-trade">Trade-off: ${esc(d.tradeoff)}</span>` : ''}
                  </span>
                </div>`,
            )
            .join('')}</div>`
        : `<p class="detail-none">Nothing is hidden — the site sees the real, full you.</p>`;
    }

    return `
      <div class="opt-wrap">
        <div class="opt-head">
          <button class="opt" role="radio" aria-checked="${on}" data-persona="${id}">
            <span class="opt-text">
              <span class="opt-name">${esc(p.name)}</span>
              <span class="opt-desc">${esc(p.tagline)}</span>
            </span>
          </button>
          <button class="opt-toggle" type="button" data-toggle="${id}"
            aria-expanded="false" aria-label="What ${esc(p.name)} does" title="What this does"></button>
        </div>
        <div class="opt-detail" data-detail="${id}" hidden>${detailBody}</div>
      </div>`;
  }).join('');

  const whyItems = WHY_MORE_THAN_COOKIES.map(
    (t) => `<div class="why-item"><strong>${esc(t.title)}</strong><span>${esc(t.body)}</span></div>`,
  ).join('');

  render(`
    <div class="header">
      <div>
        <h1 class="brand">Alter/Me/A/I</h1>
        <p class="subtitle">Gate your data. Mine yourself.<br>Build your own AI.</p>
      </div>
      <button class="mode-btn" id="mode" aria-label="${mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}" title="${mode === 'dark' ? 'Light mode' : 'Dark mode'}"></button>
    </div>

    ${section('protection', 'Protection', `
      <div class="options" role="radiogroup" aria-label="Tracking protection level">${options}</div>
      <details class="why">
        <summary>Why not just block cookies?</summary>
        <div class="why-body">${whyItems}</div>
      </details>
    `)}

    ${section('capture', 'Capture', `
      <div class="options">
        <div class="opt-wrap">
          <button class="opt" id="capture" role="switch" aria-checked="${capture.enabled}">
            <span class="opt-text">
              <span class="opt-name">${capture.enabled ? 'On' : 'Off'}</span>
              <span class="opt-desc">${capture.enabled ? 'Recording activity to your library' : 'Paused — not being recorded'}</span>
            </span>
          </button>
        </div>
      </div>
      <div class="summary">
        <span class="count">${stats?.total ?? 0}</span><span class="count-label">items captured</span>
        <div class="breakdown">${breakdown}</div>
      </div>
      <div class="actions-row">
        <button class="act" id="train">Training</button>
        <button class="act" id="library">Open</button>
        <button class="act" id="export">Export</button>
      </div>
      ${
        fsOk
          ? `<p id="train-status" class="note">${
              trainingFolder
                ? `Training folder: <strong>${esc(trainingFolder.name)}</strong>/cortex-training.jsonl · <button class="inline-link" id="train-forget">change</button>`
                : 'Training builds a JSONL corpus to fine-tune your own AI — choose a folder to write it to, or it downloads.'
            }</p>`
          : ''
      }
    `)}

    ${section('appearance', 'Appearance', `
      <div class="skins">
        ${SKINS.map(
          (s) =>
            `<button class="skin-chip" data-skin-id="${s.id}" aria-pressed="${s.id === skinId}" title="${esc(s.blurb)}">
               <span class="skin-sw" data-skin="${s.id}"><i></i><i></i></span>
               <span class="skin-name">${esc(s.name)}</span>
             </button>`,
        ).join('')}
      </div>
      <div class="switch-row" style="margin-top:12px">
        <span class="switch-text">
          <span class="switch-title">Status bar</span>
          <span class="switch-sub">On-page</span>
        </span>
        <label class="switch">
          <input type="checkbox" id="chiptoggle" ${chipHidden ? '' : 'checked'} aria-label="Show on-page status bar" />
          <span class="track"></span>
        </label>
      </div>
      <div class="switch-row" style="margin-top:8px">
        <span class="switch-text">
          <span class="switch-title">Item count</span>
          <span class="switch-sub">Show in status bar</span>
        </span>
        <label class="switch">
          <input type="checkbox" id="counttoggle" ${countShown ? 'checked' : ''} aria-label="Show item count in status bar" />
          <span class="track"></span>
        </label>
      </div>
    `)}

    <section class="sec" id="security"></section>

    <div class="linkbar">
      <button class="linkbtn" id="lock">Lock</button>
      <span class="status" title="${hasPasskey ? 'Unlocked · passkey enabled' : 'Unlocked'}">
        <span class="dot"></span>${hasPasskey ? 'Passkey' : 'Unlocked'}
      </span>
      <button class="linkbtn danger" id="wipe">Erase all</button>
    </div>
    <p id="err" class="err" role="alert"></p>
  `);

  await renderSecurity();

  document.querySelector('#library')!.addEventListener('click', renderLibrary);

  // Collapsible section headings — toggle the body, persist, no full re-render.
  document.querySelectorAll<HTMLButtonElement>('.sec-head').forEach((head) => {
    head.addEventListener('click', () => {
      const id = head.dataset.collapse!;
      const body = head.parentElement!.querySelector<HTMLElement>('.sec-body');
      if (!body) return;
      const nowCollapsed = !body.hidden;
      body.hidden = nowCollapsed;
      head.setAttribute('aria-expanded', String(!nowCollapsed));
      setCollapsed(id, nowCollapsed);
    });
  });

  // Scope to persona buttons only — the Capture button is also .opt but must
  // NOT trigger a defense-settings write (that corrupted activePersona).
  document.querySelectorAll<HTMLButtonElement>('.opt[data-persona]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.persona as PersonaId;
      await saveDefenseSettings({
        enabled: id !== 'open',
        ...(id !== 'open' ? { activePersona: id } : {}),
      });
      renderHome();
    });
  });

  // Expand/collapse the "what this does" detail (＋ / －), in place.
  document.querySelectorAll<HTMLButtonElement>('.opt-toggle').forEach((tog) => {
    tog.addEventListener('click', () => {
      const id = tog.dataset.toggle!;
      const detail = document.querySelector<HTMLElement>(`.opt-detail[data-detail="${id}"]`);
      if (!detail) return;
      const open = detail.hidden;
      detail.hidden = !open;
      // aria-expanded drives the +/− glyph (CSS-drawn bars), so no text needed.
      tog.setAttribute('aria-expanded', String(open));
    });
  });

  // Custom flag toggles: persist the flag, and adopt Custom as the active
  // persona. We do NOT re-render (that would collapse the open panel mid-edit);
  // we just update the live header chip + selected ring in place.
  document.querySelectorAll<HTMLInputElement>('.cust-flag').forEach((input) => {
    input.addEventListener('change', async () => {
      const flag = input.dataset.flag as GateFlag;
      const cur = await loadDefenseSettings();
      await saveDefenseSettings({
        enabled: true,
        activePersona: 'custom',
        custom: { ...cur.custom, [flag]: input.checked },
      });
      // Reflect "Custom is now active" without a full re-render (persona opts only).
      document.querySelectorAll<HTMLButtonElement>('.opt[data-persona]').forEach((b) => {
        b.setAttribute('aria-checked', String(b.dataset.persona === 'custom'));
      });
    });
  });

  document.querySelector('#capture')!.addEventListener('click', async () => {
    await saveCaptureSettings({ enabled: !capture.enabled });
    renderHome();
  });

  document.querySelector('#export')!.addEventListener('click', async () => {
    const out = await sendToBackground({ type: 'vault.export' });
    if (out.ok && 'events' in out) download('cortex-export.json', JSON.stringify(out.events, null, 2), 'application/json');
  });

  // Training: write the JSONL corpus to the chosen folder. If no folder yet,
  // pick one (then sync). Where the File System API is unavailable, download.
  const trainStatus = (msg: string) => {
    const el = document.querySelector('#train-status');
    if (el) el.textContent = msg;
  };

  document.querySelector('#train')!.addEventListener('click', async () => {
    if (!fsOk) {
      const out = await sendToBackground({ type: 'vault.trajectories' });
      if (out.ok && 'jsonl' in out) download('cortex-training.jsonl', out.jsonl, 'application/jsonl');
      return;
    }
    try {
      if (!trainingFolder) {
        await pickTrainingFolder();
        await syncTraining(trainStatus);
        renderHome(); // re-render to show the chosen folder line
        return;
      }
      await syncTraining(trainStatus);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') trainStatus(String((e as Error)?.message ?? e));
    }
  });

  document.querySelector('#train-forget')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await clearTrainingFolder();
    renderHome();
  });

  // Skin picker — apply instantly and SNAP to that skin's native mode, so e.g.
  // Terminal shows its B/G CRT immediately. The ◐ toggle still overrides after.
  document.querySelectorAll<HTMLButtonElement>('.skin-chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const id = chip.dataset.skinId!;
      const nativeMode = getSkin(id).defaultMode;
      applyTheme(id, nativeMode);
      await saveSkinId(id);
      await saveMode(nativeMode);
      renderHome(); // header ◐/◑ + labels reflect the new mode
    });
  });

  // On-page status bar show/hide (persisted; the bar reads this on each page).
  document.querySelector('#chiptoggle')!.addEventListener('change', async (e) => {
    const show = (e.target as HTMLInputElement).checked;
    await browser.storage.local.set({ 'cortex.chip.hidden': !show });
    renderHome();
  });

  // Item-count segment in the status bar (default on).
  document.querySelector('#counttoggle')!.addEventListener('change', async (e) => {
    await browser.storage.local.set({ 'cortex.chip.count': (e.target as HTMLInputElement).checked });
  });

  // Light/dark toggle — flips mode for the current skin, persists, re-renders
  // so the header icon + labels update.
  document.querySelector('#mode')!.addEventListener('click', async () => {
    const curMode = (document.documentElement.getAttribute('data-mode') as Mode) ?? 'dark';
    const next: Mode = curMode === 'dark' ? 'light' : 'dark';
    applyTheme(document.documentElement.getAttribute('data-skin') ?? 'synthwave', next);
    await saveMode(next);
    renderHome();
  });

  document.querySelector('#lock')!.addEventListener('click', async () => {
    await sendToBackground({ type: 'vault.lock' });
    refresh();
  });

  document.querySelector('#wipe')!.addEventListener('click', async () => {
    if (!confirm('Erase everything in your library? This cannot be undone.')) return;
    await sendToBackground({ type: 'vault.wipe' });
    renderHome();
  });
}

// --- security (passkey enrollment) ------------------------------------------

/**
 * Turn a raw WebAuthn failure into a human, actionable sentence. The raw codes
 * (PRF0/PRF2, LB3, DOM error names) are precise but meaningless to a user; this
 * maps the ones we actually hit to plain guidance. Returns the friendly message
 * plus whether it's the known macOS capability gap (so the caller can show the
 * fuller explanation under the button rather than a one-liner).
 */
function explainPasskeyError(raw: string): { message: string; capabilityGap: boolean } {
  const r = raw.toLowerCase();

  // User dismissed the system prompt, or it timed out — not a real failure.
  if (r.includes('notallowed') || r.includes('timed out') || r.includes('timeout')) {
    return { message: 'Passkey setup was cancelled. You can try again anytime.', capabilityGap: false };
  }

  // The exact Sonoma + iCloud Keychain gap: no PRF, no writable largeBlob.
  const noPrf = r.includes('prf0') || r.includes('prf unsupported') || r.includes('no prf');
  const noBlob = r.includes('lb3') || r.includes('blob write failed') || r.includes('largeblob');
  if (noPrf && noBlob) {
    return {
      message:
        'This device’s built-in passkey (iCloud Keychain) can’t hold an encryption key on macOS Sonoma. ' +
        'Use a security key, choose “Google Password Manager” in Chrome’s passkey prompt, or update to macOS Sequoia. ' +
        'Your passphrase still unlocks the vault.',
      capabilityGap: true,
    };
  }

  // Already enrolled for this site.
  if (r.includes('excludecredentials') || r.includes('already')) {
    return { message: 'A passkey for Alter/Me/A/I already exists on this device.', capabilityGap: false };
  }

  // Anything else — keep it honest but readable.
  return { message: `Couldn’t set up a passkey: ${raw}`, capabilityGap: false };
}

async function renderSecurity() {
  const el = document.querySelector('#security');
  if (!el) return;
  const res = await sendToBackground({ type: 'auth.methods' });
  const methods = res.ok && 'methods' in res ? res.methods : [];
  const hasPasskey = methods.some((m) => m.method === 'webauthn');

  // Enrolled status lives in the header chip (Unlocked ·🔑) — no duplicate row.
  // Only render this section when there's an action to offer: adding a passkey.
  if (hasPasskey || !webauthnAvailable()) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = `
    <p class="label">Security</p>
    <button class="btn-secondary" id="addpk">${KEY} Add a passkey</button>
    <p class="note" id="pknote">Unlock with Touch ID, Windows Hello, or a security key. Stays on this device.</p>
  `;
  document.querySelector('#addpk')!.addEventListener('click', async () => {
    const errEl = document.querySelector('#err')!;
    const noteEl = document.querySelector('#pknote');
    const btn = document.querySelector<HTMLButtonElement>('#addpk')!;
    errEl.textContent = '';
    errEl.textContent = 'Setting up… approve the Touch ID prompts.';
    try {
      // Prefer PRF (one secret, derived). Fall back to largeBlob (secret stored
      // in the passkey) only for authenticators that report PRF unsupported —
      // iCloud Keychain supports PRF but NOT largeBlob writes, so a real PRF
      // failure must surface, not silently chase a fallback that can't work.
      let secret: PrfResult | null = null;
      let prfErr: unknown = null;
      try {
        secret = await createPasskeyWithPrf();
      } catch (e) {
        prfErr = e;
        secret = null;
      }
      if (!secret) {
        try {
          secret = await enrollPasskeyLargeBlob();
        } catch (lbErr) {
          // Both paths failed — show the PRF cause (the meaningful one on macOS)
          // alongside the largeBlob result so the failure is diagnosable.
          throw new Error(
            `${prfErr ? String((prfErr as Error)?.message ?? prfErr) : 'no PRF'} · ${String((lbErr as Error)?.message ?? lbErr)}`,
          );
        }
      }

      const enroll = await sendToBackground({
        type: 'auth.webauthn.enroll',
        credentialId: Array.from(secret.credentialId),
        prfOutput: Array.from(secret.prfOutput),
        prfSalt: Array.from(secret.prfSalt),
        label: 'Passkey',
      });
      if (enroll.ok) renderHome();
      else errEl.textContent = enroll.error;
    } catch (e) {
      const { message, capabilityGap } = explainPasskeyError(
        String((e as Error)?.message ?? e),
      );
      errEl.textContent = '';
      if (capabilityGap) {
        // Not a transient error: this authenticator can't ever hold the key on
        // this OS. Retreat gracefully — explain it where the hint lives and stop
        // inviting a retry that will fail identically.
        if (noteEl) noteEl.textContent = message;
        btn.disabled = true;
        btn.textContent = 'Passkey unavailable on this device';
      } else {
        errEl.textContent = message;
      }
    }
  });
}

// --- library ----------------------------------------------------------------

async function renderLibrary() {
  render(`
    <button class="back" id="back">← Back</button>
    <h1 class="brand">Your library</h1>
    <p class="subtitle">A model of you, built on this device.</p>
    <div id="profile"><p class="empty">Reading your library…</p></div>
    <form class="search-wrap" id="askForm">
      <input id="q" type="search" placeholder="Ask yourself… e.g. what have I researched about X" aria-label="Ask your history" />
    </form>
    <div id="answer" class="answer" hidden></div>
    <ul id="hits" class="hits"></ul>
  `);

  document.querySelector('#back')!.addEventListener('click', renderHome);

  const res = await sendToBackground({ type: 'mind.profile' });
  const profileEl = document.querySelector('#profile')!;
  if (!res.ok || !('profile' in res)) {
    profileEl.innerHTML = `<p class="err">${res.ok ? 'No profile' : esc(res.error)}</p>`;
    return;
  }
  const p = res.profile;
  if (p.documentCount === 0) {
    profileEl.innerHTML = `<p class="empty">Nothing here yet. Browse a little, then come back.</p>`;
  } else {
    const interests = p.topInterests
      .slice(0, 12)
      .map((i) => `<span class="chip">${esc(i.term)}</span>`)
      .join('');
    const sites = p.topSites
      .slice(0, 6)
      .map((s) => `<li><span>${esc(s.host)}</span><span>${s.count}</span></li>`)
      .join('');
    profileEl.innerHTML = `
      <p class="note">${p.documentCount} items · ${p.vocabularySize} concepts</p>
      <p class="label">Themes</p>
      <div class="chips">${interests}</div>
      <p class="label">Most visited</p>
      <ul class="rows">${sites}</ul>
    `;
  }

  const q = document.querySelector<HTMLInputElement>('#q')!;
  const hits = document.querySelector('#hits')!;
  const answerEl = document.querySelector<HTMLElement>('#answer')!;

  const renderHits = (list: Array<{ host: string; kind: string; snippet: string }>) => {
    hits.innerHTML = list.length
      ? list
          .map(
            (h) =>
              `<li class="hit"><div class="hit-meta">${esc(h.host)} · ${esc(h.kind)}</div><div class="hit-snip">${esc(h.snippet)}</div></li>`,
          )
          .join('')
      : '<li class="empty">No matches yet</li>';
  };

  // Live search-as-you-type fills the hit list (no answer synthesis yet).
  let timer = 0;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const term = q.value.trim();
      if (term.length < 2) {
        hits.innerHTML = '';
        answerEl.hidden = true;
        return;
      }
      const out = await sendToBackground({ type: 'mind.search', query: term, k: 8 });
      if (out.ok && 'hits' in out) renderHits(out.hits);
    }, 220);
  });

  // Submitting the question asks the Mind for a grounded answer + its sources.
  document.querySelector('#askForm')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = q.value.trim();
    if (question.length < 2) return;
    answerEl.hidden = false;
    answerEl.textContent = 'Thinking…';
    const out = await sendToBackground({ type: 'mind.ask', question, k: 5 });
    if (!out.ok || !('answer' in out)) {
      answerEl.textContent = out.ok ? '' : out.error;
      return;
    }
    answerEl.innerHTML = `<p class="answer-text">${esc(out.answer.text)}</p>`;
    renderHits(out.answer.sources);
  });
}

function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Write the full training corpus (JSONL) into the chosen folder. Re-checks
 * permission first (Chrome may drop it across restarts) and reports progress
 * through the supplied status setter.
 */
async function syncTraining(status: (msg: string) => void): Promise<void> {
  const handle = await getTrainingFolder();
  if (!handle) return;
  status('Preparing…');
  if (!(await ensurePermission(handle))) {
    status('Folder permission was declined. Click Sync to grant it again.');
    return;
  }
  const out = await sendToBackground({ type: 'vault.trajectories' });
  if (!out.ok || !('jsonl' in out)) {
    status('Could not read the corpus.');
    return;
  }
  const lines = out.jsonl ? out.jsonl.split('\n').filter(Boolean).length : 0;
  try {
    await writeToFolder(handle, 'cortex-training.jsonl', out.jsonl);
    status(`Synced ${lines} training sample${lines === 1 ? '' : 's'}.`);
  } catch (e) {
    status(`Write failed: ${String((e as Error)?.message ?? e)}`);
  }
}

// Apply the saved skin before first paint, then render.
initSkin().finally(refresh);
