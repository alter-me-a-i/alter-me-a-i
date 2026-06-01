/*
 * Pure text tokenization for the Mind. No dependencies — lowercases, splits on
 * non-alphanumerics, drops very short tokens and common stopwords. Deterministic
 * and auditable: the same text always yields the same tokens, and you can read
 * exactly what gets kept.
 */

/** Common English stopwords — removed so they don't dominate your "interests". */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her',
  'was', 'one', 'our', 'out', 'has', 'had', 'his', 'how', 'man', 'new', 'now',
  'old', 'see', 'two', 'way', 'who', 'did', 'its', 'let', 'put', 'say', 'she',
  'too', 'use', 'that', 'this', 'with', 'have', 'from', 'they', 'will', 'would',
  'there', 'their', 'what', 'about', 'which', 'when', 'your', 'said', 'were',
  'been', 'than', 'them', 'into', 'more', 'some', 'could', 'then', 'these',
  'http', 'https', 'www', 'com', 'org', 'net', 'html', 'php', 'aspx',
]);

/** Split text into normalized, meaningful tokens. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 3 && t.length <= 30 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}
