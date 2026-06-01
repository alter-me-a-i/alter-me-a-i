/*
 * TF-IDF vectorizer + cosine similarity — pure, zero-dependency. This is the
 * "embedding" that keeps Cortex pure: no model download, no shipped runtime
 * dep, fully auditable. A document becomes a sparse vector of term -> tf*idf
 * weight; similarity is cosine between sparse vectors.
 *
 * Designed behind a small surface (fit / transform / cosine) so a heavier
 * neural backend (transformers.js) could later implement the same shape as an
 * opt-in upgrade without touching callers.
 */

export type Vector = Map<string, number>;

export class TfIdf {
  /** term -> inverse document frequency, learned in fit(). */
  #idf = new Map<string, number>();
  #docCount = 0;

  /** Learn idf weights from the corpus (array of token arrays). */
  fit(corpus: string[][]): this {
    this.#docCount = corpus.length;
    const df = new Map<string, number>();
    for (const tokens of corpus) {
      for (const term of new Set(tokens)) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
    this.#idf.clear();
    for (const [term, count] of df) {
      // Smoothed idf: ln((1 + N) / (1 + df)) + 1, always positive.
      this.#idf.set(term, Math.log((1 + this.#docCount) / (1 + count)) + 1);
    }
    return this;
  }

  /** Turn one token list into a normalized tf-idf vector. */
  transform(tokens: string[]): Vector {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    const vec: Vector = new Map();
    const n = tokens.length || 1;
    for (const [term, count] of tf) {
      const idf = this.#idf.get(term);
      if (idf === undefined) continue; // unseen term carries no signal
      vec.set(term, (count / n) * idf);
    }
    return normalize(vec);
  }

  /** Aggregate tf-idf mass per term across the corpus — your "top interests". */
  topTerms(corpus: string[][], k: number): Array<{ term: string; score: number }> {
    const totals = new Map<string, number>();
    for (const tokens of corpus) {
      for (const [term, w] of this.transform(tokens)) {
        totals.set(term, (totals.get(term) ?? 0) + w);
      }
    }
    return [...totals.entries()]
      .map(([term, score]) => ({ term, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  get vocabularySize(): number {
    return this.#idf.size;
  }
}

/** L2-normalize so cosine similarity is just a dot product. */
function normalize(vec: Vector): Vector {
  let sum = 0;
  for (const w of vec.values()) sum += w * w;
  const mag = Math.sqrt(sum);
  if (mag === 0) return vec;
  const out: Vector = new Map();
  for (const [t, w] of vec) out.set(t, w / mag);
  return out;
}

/** Cosine similarity of two L2-normalized sparse vectors (iterate smaller). */
export function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += w * other;
  }
  return dot;
}
