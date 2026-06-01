/*
 * Mind unit tests — pure logic (tokenize, TF-IDF, profile, search).
 * Run via `npm test`.
 */

import { tokenize } from './tokenize';
import { TfIdf, cosine } from './vectorize';
import { Mind } from './index';
import type { CortexEvent, DecisionEvent } from '../vault/types';
import { decisionToXapi } from '../vault/xapi';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: unknown, detail = '') =>
  results.push({ name, ok: !!ok, detail });

// --- tokenize ---
{
  const t = tokenize('The Transformer architecture, and FINE-tuning!');
  check('tokenize lowercases + splits', t.includes('transformer') && t.includes('architecture'), t.join(','));
  check('tokenize drops stopwords', !t.includes('the') && !t.includes('and'), t.join(','));
  check('tokenize drops short tokens', !t.includes('to'), t.join(','));
}

// --- tf-idf + cosine ---
{
  const corpus = [
    tokenize('machine learning neural networks'),
    tokenize('machine learning training data'),
    tokenize('cooking recipes italian pasta'),
  ];
  const tfidf = new TfIdf().fit(corpus);
  const a = tfidf.transform(tokenize('neural networks machine learning'));
  const b = tfidf.transform(tokenize('machine learning training'));
  const c = tfidf.transform(tokenize('italian pasta recipes'));
  check('cosine: related docs > unrelated', cosine(a, b) > cosine(a, c), `${cosine(a, b).toFixed(3)} vs ${cosine(a, c).toFixed(3)}`);
  check('cosine: self-similarity ~1', Math.abs(cosine(a, a) - 1) < 1e-9, cosine(a, a).toFixed(6));
  check('vocab built', tfidf.vocabularySize > 0, String(tfidf.vocabularySize));
}

// --- Mind end-to-end ---
const base = (over: Partial<CortexEvent>): CortexEvent =>
  ({ id: Math.random().toString(36).slice(2), ts: Date.now(), v: 1, source: { host: 'x.com' }, sensitivity: 'personal', ...over } as CortexEvent);

const events: CortexEvent[] = [
  base({ type: 'navigation', source: { host: 'arxiv.org' }, title: 'Attention Is All You Need transformer' } as any),
  base({ type: 'interaction', action: 'search', source: { host: 'google.com' }, text: 'how to fine-tune a transformer with LoRA' } as any),
  base({ type: 'ai_exchange', assistant: 'claude', source: { host: 'claude.ai' }, prompt: 'explain neural network embeddings', response: 'embeddings are dense vectors' } as any),
  base({ type: 'navigation', source: { host: 'allrecipes.com' }, title: 'Best italian pasta carbonara recipe' } as any),
  base({ type: 'disclosure', source: { host: 'tracker.com' }, decision: 'redacted', field: 'utm_source' } as any),
];

{
  const mind = new Mind().build(events);
  check('mind builds', mind.ready, '');

  const prof = mind.profile();
  // disclosure event has no text → excluded; 4 text docs remain.
  check('profile excludes textless events', prof.documentCount === 4, String(prof.documentCount));
  check('profile has interests', prof.topInterests.length > 0, JSON.stringify(prof.topInterests.slice(0, 3)));
  check('profile top sites', prof.topSites.some((s) => s.host === 'arxiv.org'), JSON.stringify(prof.topSites));

  const hits = mind.search('transformer fine-tuning');
  check('search returns hits', hits.length > 0, String(hits.length));
  check('search ranks ML over cooking', hits[0].host !== 'allrecipes.com', hits[0]?.host);

  const cooking = mind.search('pasta recipe');
  check('search finds cooking doc for cooking query', cooking[0]?.host === 'allrecipes.com', cooking[0]?.host);

  const empty = mind.search('zzzznonexistentterm');
  check('search returns nothing for unknown terms', empty.length === 0, String(empty.length));

  // --- ask (grounded answer) ---
  const ans = mind.ask('transformer fine-tuning');
  check('ask returns a non-empty answer', !ans.empty && ans.text.length > 0, ans.text);
  check('ask cites sources', ans.sources.length > 0, String(ans.sources.length));
  check('ask grounds answer in relevant host', ans.sources[0].host !== 'allrecipes.com', ans.sources[0]?.host);
  check('ask answer mentions item count', /\d+ item/.test(ans.text), ans.text);

  const noAns = mind.ask('zzzznonexistentterm');
  check('ask reports empty for unknown question', noAns.empty && noAns.sources.length === 0, String(noAns.sources.length));
}

// --- non-web stream: a gaming event (no host, has app) flows + labels right ---
{
  const gaming: CortexEvent[] = [
    base({
      type: 'interaction',
      action: 'search',
      stream: 'gaming',
      source: { app: 'Steam' },
      text: 'roguelike deckbuilder slay the spire strategy',
    } as any),
  ];
  const mind = new Mind().build(gaming);
  const prof = mind.profile();
  check('gaming event is modeled (host-less)', prof.documentCount === 1, String(prof.documentCount));
  check('gaming event labelled by app, not undefined', prof.topSites[0]?.host === 'Steam', JSON.stringify(prof.topSites));
  const hit = mind.search('deckbuilder strategy');
  check('gaming event is searchable', hit[0]?.host === 'Steam', hit[0]?.host);
}

// --- decision events: feed the neurotype + map to xAPI ---
{
  const decision: DecisionEvent = base({
    type: 'decision',
    stream: 'gaming',
    source: { app: 'Mass Effect' },
    prompt: 'Save the council or prioritise the human fleet?',
    options: [
      { id: 'save-council', label: 'Save the alien council', chosen: true },
      { id: 'human-fleet', label: 'Prioritise the human fleet' },
    ],
    chosen: 'save-council',
    rationale: 'sacrifice now for long-term galactic unity',
    outcome: 'council survived, fleet losses',
    weight: 'major',
  } as any) as DecisionEvent;

  const mind = new Mind().build([decision]);
  check('decision event is modeled', mind.profile().documentCount === 1, String(mind.profile().documentCount));
  const hits = mind.search('galactic unity council');
  check('decision text feeds the neurotype (searchable)', hits.length > 0, String(hits.length));

  // xAPI mapping — lossless of the load-bearing fields.
  const x = decisionToXapi(decision);
  check('xapi verb is chose', /\/chose$/.test(x.verb.id), x.verb.id);
  check('xapi response = chosen id', x.result?.response === 'save-council', x.result?.response);
  check('xapi carries both choices', x.object.definition.choices?.length === 2, String(x.object.definition.choices?.length));
  check('xapi actor is pseudonymous by default', x.actor.name === 'me', x.actor.name);
  check('xapi timestamp is ISO', /^\d{4}-\d\d-\d\dT/.test(x.timestamp), x.timestamp);
}

const failed = results.filter((r) => !r.ok);
const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${r.ok ? '' : `  -> got: ${r.detail}`}`);
lines.push(`\n${results.length - failed.length}/${results.length} passed`);
process.stdout.write(lines.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
