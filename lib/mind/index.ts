/*
 * The Mind — Alter/Me/A/I's personal model layer. Turns your decrypted corpus into:
 *   - a profile (top interests, top sites, activity shape) — "what my data says
 *     about me", and
 *   - semantic search ("what have I looked into about X") over your own history.
 *
 * Pure + zero-dependency: TF-IDF + cosine, computed in-extension. No model
 * download, nothing leaves the device. Behind a small surface so a neural
 * backend could later slot in as an opt-in upgrade without touching callers.
 *
 * This is the "trains our AI" payoff in its portable, pure-by-default form:
 * the corpus becomes a usable model of you, owned entirely by you.
 */

import { originLabel, type AlterMeAIEvent } from '../vault/types';
import { tokenize } from './tokenize';
import { TfIdf, cosine, type Vector } from './vectorize';

/** A searchable unit built from one event: its text + provenance. */
interface MindDoc {
  id: string;
  ts: number;
  host: string;
  kind: AlterMeAIEvent['type'];
  text: string;
  tokens: string[];
  vec: Vector;
}

export interface SearchHit {
  id: string;
  ts: number;
  host: string;
  kind: AlterMeAIEvent['type'];
  snippet: string;
  score: number;
}

export interface Answer {
  /** A grounded, natural-language-ish summary synthesised from your own data. */
  text: string;
  /** The events the answer draws on, best-first. */
  sources: SearchHit[];
  /** True when nothing in the corpus matched the question. */
  empty: boolean;
}

export interface MindProfile {
  /** Number of events that contributed text to the model. */
  documentCount: number;
  vocabularySize: number;
  /** Your strongest interests, by aggregate tf-idf weight. */
  topInterests: Array<{ term: string; score: number }>;
  /** Sites you engage with most (by contributing-event count). */
  topSites: Array<{ host: string; count: number }>;
  /** Event-kind distribution among modeled docs. */
  byKind: Record<string, number>;
  /** Time span covered, epoch-ms. */
  earliest?: number;
  latest?: number;
}

/** Pull the trainable text out of an event (varies by kind). */
function textOf(e: AlterMeAIEvent): string {
  switch (e.type) {
    case 'navigation':
      return [e.title, e.content].filter(Boolean).join('. ');
    case 'interaction':
      return e.text ?? '';
    case 'ai_exchange':
      return [e.prompt, e.response].filter(Boolean).join(' — ');
    case 'decision': {
      // The decision IS revealed preference — feed prompt, the chosen option's
      // label, rationale, and outcome into the neurotype.
      const pick = e.options.find((o) => o.id === e.chosen);
      return [e.prompt, pick?.label ?? pick?.id ?? e.chosen, e.rationale, e.outcome]
        .filter(Boolean)
        .join(' — ');
    }
    case 'disclosure':
      return ''; // disclosure events carry no free text to model
  }
}

export class Mind {
  #docs: MindDoc[] = [];
  #tfidf = new TfIdf();
  #built = false;

  /** Build (or rebuild) the model from a decrypted corpus. */
  build(events: AlterMeAIEvent[]): this {
    const staged = events
      .map((e) => ({ e, text: textOf(e).trim() }))
      .filter(({ text }) => text.length > 0)
      .map(({ e, text }) => ({
        id: e.id,
        ts: e.ts,
        host: originLabel(e),
        kind: e.type,
        text,
        tokens: tokenize(text),
      }))
      .filter((d) => d.tokens.length > 0);

    this.#tfidf.fit(staged.map((d) => d.tokens));
    this.#docs = staged.map((d) => ({ ...d, vec: this.#tfidf.transform(d.tokens) }));
    this.#built = true;
    return this;
  }

  get ready(): boolean {
    return this.#built;
  }

  /** Semantic search over your corpus. Returns the closest events to a query. */
  search(query: string, k = 10): SearchHit[] {
    if (!this.#built) return [];
    const qVec = this.#tfidf.transform(tokenize(query));
    if (qVec.size === 0) return [];
    return this.#docs
      .map((d) => ({
        id: d.id,
        ts: d.ts,
        host: d.host,
        kind: d.kind,
        snippet: d.text.length > 160 ? d.text.slice(0, 160) + '…' : d.text,
        score: cosine(qVec, d.vec),
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Answer a question about YOUR history, grounded in your own corpus. Pure +
   * local: it retrieves the most relevant events (semantic search) and
   * synthesises a plain summary from them — no LLM, nothing leaves the device.
   * An optional neural backend could later replace the synthesis step behind
   * this same surface.
   */
  ask(question: string, k = 5): Answer {
    const sources = this.search(question, k);
    if (sources.length === 0) {
      return {
        text: "I don't see anything about that in your history yet.",
        sources: [],
        empty: true,
      };
    }

    // Group the matched sources by host to describe where the interest lives.
    const byHost = new Map<string, number>();
    for (const s of sources) byHost.set(s.host, (byHost.get(s.host) ?? 0) + 1);
    const hosts = [...byHost.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);

    const when = timeSpan(sources.map((s) => s.ts));
    const topHosts =
      hosts.length === 1
        ? hosts[0]
        : hosts.length === 2
          ? `${hosts[0]} and ${hosts[1]}`
          : `${hosts.slice(0, 2).join(', ')} and ${hosts.length - 2} other site${hosts.length - 2 === 1 ? '' : 's'}`;

    const lead =
      `Based on ${sources.length} item${sources.length === 1 ? '' : 's'} in your history` +
      `${when ? ` (${when})` : ''}, this comes up mostly on ${topHosts}.`;

    // Quote the single best-matching snippet as concrete grounding.
    const best = sources[0];
    const quote = best.snippet ? ` Most relevant: “${best.snippet}”` : '';

    return { text: lead + quote, sources, empty: false };
  }

  /** Synthesize a profile of you from the modeled corpus. */
  profile(topK = 15): MindProfile {
    const corpus = this.#docs.map((d) => d.tokens);
    const siteCounts = new Map<string, number>();
    const byKind: Record<string, number> = {};
    let earliest: number | undefined;
    let latest: number | undefined;

    for (const d of this.#docs) {
      siteCounts.set(d.host, (siteCounts.get(d.host) ?? 0) + 1);
      byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
      if (earliest === undefined || d.ts < earliest) earliest = d.ts;
      if (latest === undefined || d.ts > latest) latest = d.ts;
    }

    const topSites = [...siteCounts.entries()]
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topK);

    return {
      documentCount: this.#docs.length,
      vocabularySize: this.#tfidf.vocabularySize,
      topInterests: this.#tfidf.topTerms(corpus, topK),
      topSites,
      byKind,
      earliest,
      latest,
    };
  }
}

/** A coarse human phrase for the span of some timestamps ("over the past week"). */
function timeSpan(timestamps: number[]): string {
  if (timestamps.length === 0) return '';
  const max = Math.max(...timestamps);
  const min = Math.min(...timestamps);
  const dayMs = 86_400_000;
  const spanDays = (max - min) / dayMs;
  if (spanDays < 1) return 'all around the same time';
  if (spanDays < 7) return 'over the past few days';
  if (spanDays < 31) return 'over the past few weeks';
  if (spanDays < 365) return 'over the past several months';
  return 'across more than a year';
}
