/*
 * Content-extraction tests — pure, run against happy-dom documents.
 * Run via `npm test`.
 */

import { Window } from 'happy-dom';
import { extractContent } from './content';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: unknown, detail = '') =>
  results.push({ name, ok: !!ok, detail });

function doc(html: string): Document {
  const win = new Window({ url: 'https://example.com/' });
  win.document.write(html);
  return win.document as unknown as Document;
}

// meta description
{
  const d = doc('<html><head><meta name="description" content="A concise summary of neural networks and deep learning."></head><body></body></html>');
  const c = extractContent(d);
  check('extracts meta description', c.includes('neural networks'), c);
}

// article paragraph text
{
  const d = doc('<html><body><article><h1>Transformers</h1><p>The transformer is a neural network architecture based on self-attention mechanisms.</p></article></body></html>');
  const c = extractContent(d);
  check('extracts article text', c.includes('self-attention'), c.slice(0, 80));
  check('includes heading', c.includes('Transformers'), c.slice(0, 40));
}

// boilerplate skipped
{
  const d = doc('<html><body><nav><p>home about contact navigation menu links</p></nav><main><p>The actual content paragraph about machine learning models.</p></main><footer><p>copyright footer boilerplate text here</p></footer></body></html>');
  const c = extractContent(d);
  check('keeps main content', c.includes('machine learning'), c);
  check('skips nav boilerplate', !c.includes('navigation menu'), c);
  check('skips footer boilerplate', !c.includes('copyright footer'), c);
}

// cap respected
{
  const long = 'word '.repeat(2000);
  const d = doc(`<html><body><article><p>${long}</p></article></body></html>`);
  const c = extractContent(d, 500);
  check('respects max length', c.length <= 500, String(c.length));
}

// empty page
{
  const d = doc('<html><body></body></html>');
  check('empty page -> empty string', extractContent(d) === '', JSON.stringify(extractContent(d)));
}

const failed = results.filter((r) => !r.ok);
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${r.ok ? '' : `  -> got: ${r.detail}`}`);
lines.push(`\n${results.length - failed.length}/${results.length} passed`);
process.stdout.write(lines.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
