/*
 * Capture engine smoke test — drives the REAL capture modules against a
 * simulated DOM (happy-dom), exercising the fragile choke-points:
 *   - AI prompt capture via Enter and via send-button (deduped)
 *   - AI response scrape from per-assistant selectors after a settle delay
 *   - password-form skip
 *   - URL + search-box search detection
 *   - navigation title + sensitivity classification
 *
 * Run with tsx (resolves extensionless TS imports): `npm test`.
 * Modules read DOM globals at call-time, so we install one window's globals per
 * scenario BEFORE invoking a module, and import the modules ONCE so instanceof
 * checks resolve against a single set of DOM classes.
 */

import { Window } from 'happy-dom';
import {
  startAi,
  startInteraction,
  startNavigation,
  AI_SETTLE_MS,
  type Ctx,
} from './modules';
import type { CaptureSettings } from './settings';

const DOM_GLOBALS = [
  'window', 'document', 'location', 'navigator', 'MutationObserver',
  'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLFormElement',
  'Event', 'KeyboardEvent', 'URLSearchParams', 'Node',
] as const;

function setGlobal(key: string, value: unknown): void {
  if (value === undefined) return;
  try {
    (globalThis as Record<string, unknown>)[key] = value;
  } catch {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
}

function makeDom(url: string, html: string, opts: { complete?: boolean } = {}): Window {
  const win = new Window({ url });
  win.document.write(html);
  for (const k of DOM_GLOBALS) setGlobal(k, k === 'window' ? win : (win as any)[k]);
  if (opts.complete) {
    try {
      Object.defineProperty(win.document, 'readyState', { value: 'complete', configurable: true });
    } catch {
      /* ignore */
    }
  }
  return win;
}

const SETTINGS: CaptureSettings = {
  enabled: true,
  excludeHosts: [],
  captureSelections: true,
  captureAi: true,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: unknown, detail = '') =>
  results.push({ name, ok: !!ok, detail });

function collector(host: string): { ctx: Ctx; events: any[] } {
  const events: any[] = [];
  return { events, ctx: { host, settings: SETTINGS, report: (e) => events.push(e) } };
}

async function main() {
  // 1. AI: prompt via Enter, response scraped after settle (ChatGPT)
  {
    const win = makeDom(
      'https://chatgpt.com/',
      '<!doctype html><html><head><title>ChatGPT</title></head><body><div id="thread"></div><textarea id="composer"></textarea></body></html>',
    );
    const { ctx, events } = collector('chatgpt.com');
    const teardown = startAi(ctx);
    const composer = win.document.getElementById('composer') as any;
    composer.value = 'How do I fine-tune a model?';
    composer.dispatchEvent(new win.Event('focusin', { bubbles: true }));
    composer.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const msg = win.document.createElement('div');
    msg.setAttribute('data-message-author-role', 'assistant');
    msg.textContent = 'Use LoRA with the peft library.';
    win.document.getElementById('thread')!.appendChild(msg);
    await sleep(AI_SETTLE_MS + 700);
    teardown();
    const ai = events.find((e) => e.type === 'ai_exchange');
    check('AI: prompt captured via Enter', ai?.prompt === 'How do I fine-tune a model?', ai?.prompt);
    check('AI: response scraped from selector', ai?.response === 'Use LoRA with the peft library.', ai?.response);
    check('AI: assistant id correct', ai?.assistant === 'chatgpt', ai?.assistant);
    check('AI: exactly one exchange', events.filter((e) => e.type === 'ai_exchange').length === 1, String(events.length));
  }

  // 2. AI: prompt via send BUTTON, deduped with Enter (Claude)
  {
    const win = makeDom(
      'https://claude.ai/',
      '<!doctype html><html><head><title>Claude</title></head><body><div id="thread"></div><div id="composer" contenteditable="true"></div><button data-testid="send-button" aria-label="Send message">Send</button></body></html>',
    );
    const { ctx, events } = collector('claude.ai');
    const teardown = startAi(ctx);
    const composer = win.document.getElementById('composer') as any;
    composer.textContent = 'Explain transformers';
    composer.dispatchEvent(new win.Event('focusin', { bubbles: true }));
    composer.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    win.document.querySelector('button')!.dispatchEvent(new win.Event('click', { bubbles: true }));
    const msg = win.document.createElement('div');
    msg.setAttribute('data-testid', 'assistant-turn');
    msg.textContent = 'They use self-attention.';
    win.document.getElementById('thread')!.appendChild(msg);
    await sleep(AI_SETTLE_MS + 700);
    teardown();
    check('AI(button): single exchange despite Enter+click', events.filter((e) => e.type === 'ai_exchange').length === 1, String(events.length));
    check('AI(button): prompt text correct', events[0]?.prompt === 'Explain transformers', events[0]?.prompt);
    check('AI(button): response scraped', events[0]?.response === 'They use self-attention.', events[0]?.response);
  }

  // 3. AI on a non-AI host: nothing captured
  {
    makeDom('https://nytimes.com/', '<!doctype html><html><body></body></html>');
    const { ctx, events } = collector('nytimes.com');
    startAi(ctx);
    check('AI: no-op on non-AI host', events.length === 0, String(events.length));
  }

  // 4. Search via URL param
  {
    makeDom('https://google.com/search?q=transformer+architecture', '<!doctype html><html><head><title>x</title></head><body></body></html>');
    const { ctx, events } = collector('google.com');
    startInteraction(ctx);
    const s = events.find((e) => e.action === 'search');
    check('Search: captured from URL ?q=', s?.text === 'transformer architecture', s?.text);
  }

  // 5. Search via search-box submit; password form is SKIPPED
  {
    const win = makeDom('https://example.com/', '<!doctype html><html><body><form id="searchform"><input type="search" name="q" value="local AI tools"></form><form id="loginform"><input type="search" name="q" value="should-not-capture"><input type="password"></form></body></html>');
    const { ctx, events } = collector('example.com');
    startInteraction(ctx);
    win.document.getElementById('searchform')!.dispatchEvent(new win.Event('submit', { bubbles: true }));
    win.document.getElementById('loginform')!.dispatchEvent(new win.Event('submit', { bubbles: true }));
    await sleep(50);
    const searches = events.filter((e) => e.action === 'search');
    check('Search: search-form captured', searches.some((e) => e.text === 'local AI tools'), JSON.stringify(searches.map((e) => e.text)));
    check('Search: password form SKIPPED', !searches.some((e) => e.text === 'should-not-capture'), JSON.stringify(searches.map((e) => e.text)));
  }

  // 6. Navigation: title + sensitivity
  {
    makeDom('https://en.wikipedia.org/wiki/Transformer', '<!doctype html><html><head><title>Transformer - Wikipedia</title></head><body></body></html>', { complete: true });
    const { ctx, events } = collector('en.wikipedia.org');
    startNavigation(ctx);
    const nav = events.find((e) => e.type === 'navigation');
    check('Nav: title captured', nav?.title === 'Transformer - Wikipedia', nav?.title);
    check('Nav: normal host = personal', nav?.sensitivity === 'personal', nav?.sensitivity);
  }

  // 7. Navigation on a sensitive (bank) host = sensitive
  {
    makeDom('https://chase.com/', '<!doctype html><html><head><title>Chase</title></head><body></body></html>', { complete: true });
    const { ctx, events } = collector('chase.com');
    startNavigation(ctx);
    const nav = events.find((e) => e.type === 'navigation');
    check('Nav: bank host = sensitive (excluded from training)', nav?.sensitivity === 'sensitive', nav?.sensitivity);
  }

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${r.ok ? '' : `  -> got: ${r.detail}`}`);
  lines.push(`\n${results.length - failed.length}/${results.length} passed`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  process.stdout.write('SMOKE TEST CRASHED: ' + (e?.stack || e) + '\n');
  process.exit(1);
});
