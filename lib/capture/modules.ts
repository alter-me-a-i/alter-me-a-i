/*
 * Pure DOM-capture modules — the part of the engine that reads the page.
 *
 * Deliberately free of any `wxt`/extension imports so it can run under a
 * simulated DOM (happy-dom) in a plain Node test. Each module is a function
 * that wires up listeners against the current document and reports AlterMeAIEvents
 * through the injected `ctx.report`, returning a teardown function.
 */

import type { NewEvent } from '../vault/types';
import { aiAssistantFor, isSensitiveHost } from './hosts';
import { classify } from './sensitivity';
import { extractContent } from './content';
import type { CaptureSettings } from './settings';

export const LIMITS = {
  search: 1000,
  selection: 4000,
  prompt: 8000,
  response: 16000,
  content: 4000,
};

/** How long the DOM must be quiet before we treat an AI reply as complete. */
export const AI_SETTLE_MS = 4000;
/** Absolute backstop so a prompt is never left dangling without a response. */
export const AI_HARDSTOP_MS = 60_000;

/** Shared context handed to each capture module. */
export interface Ctx {
  host: string;
  settings: CaptureSettings;
  report: (event: NewEvent) => void;
}

export function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) : t;
}

/** True if the element lives in (or is) a form that handles a password. */
export function touchesPassword(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement && el.type === 'password') return true;
  const form = el.closest('form');
  return !!form?.querySelector('input[type="password"]');
}

// --- navigation -----------------------------------------------------------

export function startNavigation(ctx: Ctx): () => void {
  const fire = () => {
    // Skip content extraction on sensitive hosts (bank/health/gov) — their page
    // text never enters the corpus; only the bare visit (classified sensitive,
    // excluded from training) is recorded.
    const content = isSensitiveHost(ctx.host)
      ? undefined
      : clip(extractContent(document, LIMITS.content), LIMITS.content) || undefined;
    ctx.report({
      type: 'navigation',
      source: { host: ctx.host, url: location.href },
      sensitivity: classify(ctx.host, 'navigation'),
      title: clip(document.title || '', 300) || undefined,
      content,
    });
  };
  if (document.readyState === 'complete') fire();
  else window.addEventListener('load', fire, { once: true });
  return () => {};
}

// --- interaction: searches + selections -----------------------------------

const SEARCH_PARAMS = ['q', 'query', 'search', 'p', 'wd', 'text'];

export function searchQueryFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  for (const key of SEARCH_PARAMS) {
    const v = params.get(key);
    if (v && v.trim()) return v;
  }
  return null;
}

export function startInteraction(ctx: Ctx): () => void {
  const cleanups: Array<() => void> = [];

  const q = searchQueryFromUrl();
  if (q) {
    ctx.report({
      type: 'interaction',
      action: 'search',
      source: { host: ctx.host, url: location.href },
      sensitivity: classify(ctx.host, 'interaction'),
      text: clip(q, LIMITS.search),
    });
  }

  const onSubmit = (e: Event) => {
    const form = e.target as HTMLFormElement;
    if (!(form instanceof HTMLFormElement) || touchesPassword(form)) return;
    const input = form.querySelector<HTMLInputElement>(
      'input[type="search"], input[name="q"], input[name="query"], input[role="searchbox"]',
    );
    if (input?.value?.trim()) {
      ctx.report({
        type: 'interaction',
        action: 'search',
        source: { host: ctx.host, url: location.href },
        sensitivity: classify(ctx.host, 'interaction'),
        text: clip(input.value, LIMITS.search),
      });
    }
  };
  document.addEventListener('submit', onSubmit, true);
  cleanups.push(() => document.removeEventListener('submit', onSubmit, true));

  if (ctx.settings.captureSelections) {
    let timer = 0;
    const onSelect = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = document.getSelection();
        const text = sel?.toString() ?? '';
        if (text.trim().length < 12) return;
        if (touchesPassword(sel?.anchorNode?.parentElement ?? null)) return;
        ctx.report({
          type: 'interaction',
          action: 'select',
          source: { host: ctx.host, url: location.href },
          sensitivity: classify(ctx.host, 'interaction'),
          text: clip(text, LIMITS.selection),
        });
      }, 700) as unknown as number;
    };
    document.addEventListener('selectionchange', onSelect);
    cleanups.push(() =>
      document.removeEventListener('selectionchange', onSelect),
    );
  }

  return () => cleanups.forEach((c) => c());
}

// --- ai exchanges ---------------------------------------------------------

/** Best-effort selectors for the assistant's latest reply, per surface. */
export const AI_RESPONSE_SELECTORS: Record<string, string> = {
  chatgpt: '[data-message-author-role="assistant"]',
  claude: '[data-testid="assistant-turn"], .font-claude-message',
  gemini: 'message-content, .model-response-text',
  perplexity: '.prose',
};

export function startAi(ctx: Ctx): () => void {
  const assistant = aiAssistantFor(ctx.host);
  if (!assistant || !ctx.settings.captureAi) return () => {};

  let composer: HTMLElement | null = null;
  let pending: { prompt: string; at: number } | null = null;
  let observer: MutationObserver | null = null;
  let settle = 0;
  let hardStop = 0;

  const composerText = (el: HTMLElement | null): string => {
    if (!el) return '';
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return el.value;
    }
    return el.innerText ?? el.textContent ?? '';
  };

  const emit = (prompt: string, response: string) => {
    ctx.report({
      type: 'ai_exchange',
      assistant,
      source: { host: ctx.host, url: location.href },
      sensitivity: classify(ctx.host, 'ai_exchange'),
      prompt: clip(prompt, LIMITS.prompt),
      response: response ? clip(response, LIMITS.response) : undefined,
    });
  };

  const stopObserving = () => {
    observer?.disconnect();
    observer = null;
    clearTimeout(settle);
    clearTimeout(hardStop);
  };

  const flush = () => {
    if (!pending) return;
    const sel = AI_RESPONSE_SELECTORS[assistant];
    let response = '';
    if (sel) {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      const last = nodes[nodes.length - 1];
      response = last?.innerText ?? last?.textContent ?? '';
    }
    emit(pending.prompt, response);
    pending = null;
    stopObserving();
  };

  const watchForResponse = () => {
    stopObserving();
    observer = new MutationObserver(() => {
      clearTimeout(settle);
      settle = setTimeout(flush, AI_SETTLE_MS) as unknown as number;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    hardStop = setTimeout(flush, AI_HARDSTOP_MS) as unknown as number;
  };

  const capturePrompt = (raw: string) => {
    const prompt = raw.trim();
    if (prompt.length < 2) return;
    if (pending && pending.prompt === prompt && Date.now() - pending.at < 2000) {
      return;
    }
    flush();
    pending = { prompt, at: Date.now() };
    watchForResponse();
  };

  const onFocusIn = (e: Event) => {
    const t = (e.target as HTMLElement)?.closest<HTMLElement>(
      'textarea, [contenteditable="true"], [role="textbox"]',
    );
    if (t) composer = t;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const t = (e.target as HTMLElement)?.closest<HTMLElement>(
      'textarea, [contenteditable="true"], [role="textbox"]',
    );
    if (t) capturePrompt(composerText(t));
  };
  const onClick = (e: Event) => {
    const btn = (e.target as HTMLElement)?.closest('button');
    if (!btn) return;
    const label =
      (btn.getAttribute('aria-label') || '') +
      (btn.getAttribute('data-testid') || '');
    if (/send|submit/i.test(label)) capturePrompt(composerText(composer));
  };

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onClick, true);

  return () => {
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onClick, true);
    stopObserving();
  };
}

/** All capture modules, in boot order. */
export const MODULES = [startNavigation, startInteraction, startAi];
