/*
 * Pure page-content extraction. Pulls the meaningful text out of a document so
 * the corpus carries real content (not just titles) — which makes the Mind's
 * vocabulary and search dramatically richer. No extension imports; takes an
 * explicit Document so it can be unit-tested under a simulated DOM.
 *
 * Strategy (cheap, robust, no dependency): prefer the page's own summary signals
 * (meta description, <article>/<main>), fall back to paragraph text, strip
 * boilerplate-heavy containers (nav/header/footer/aside/script/style).
 */

/** Tags whose text is almost always chrome, not content. */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'ASIDE',
  'FORM', 'BUTTON', 'SVG', 'TEMPLATE',
]);

function metaDescription(doc: Document): string {
  const sel =
    'meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]';
  for (const m of Array.from(doc.querySelectorAll(sel))) {
    const c = m.getAttribute('content')?.trim();
    if (c) return c;
  }
  return '';
}

function closestSkip(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (SKIP_TAGS.has(cur.tagName)) return true;
    cur = cur.parentElement;
  }
  return false;
}

/** Visible-ish text of an element, skipping boilerplate descendants. */
function textFromContainer(el: Element): string {
  const parts: string[] = [];
  const nodes = el.querySelectorAll('p, h1, h2, h3, li');
  for (const n of Array.from(nodes)) {
    if (closestSkip(n)) continue;
    const t = (n.textContent ?? '').trim();
    // Headings are short but high-signal — keep them regardless of length;
    // hold paragraphs/list items to a floor so we skip one-word chrome.
    const isHeading = /^H[1-3]$/.test(n.tagName);
    if (isHeading ? t.length >= 2 : t.length >= 20) parts.push(t);
  }
  return parts.join(' ');
}

/**
 * Extract page content, capped to `max` chars. Combines the meta description
 * with the best content container's text. Returns '' if nothing usable.
 */
export function extractContent(doc: Document, max = 4000): string {
  const desc = metaDescription(doc);
  const main =
    doc.querySelector('article') ??
    doc.querySelector('main') ??
    doc.querySelector('[role="main"]') ??
    doc.body;
  const body = main ? textFromContainer(main) : '';

  const combined = [desc, body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return combined.length > max ? combined.slice(0, max) : combined;
}
