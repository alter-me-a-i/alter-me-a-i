/*
 * Pure URL tracking-param stripping. No DOM, no extension APIs — so it can be
 * unit-tested directly and reused anywhere. Removes known tracking parameters
 * and reports which ones were removed, so the caller can record a disclosure
 * event (defense feeding the corpus).
 */

import { TRACKING_PARAMS } from './personas';

export interface CleanResult {
  /** The cleaned URL (unchanged if nothing was stripped). */
  url: string;
  /** Names of the tracking params that were removed. */
  removed: string[];
}

/**
 * Strip known tracking params from a URL. Returns the original string verbatim
 * if it can't be parsed or nothing matched, so callers can cheaply detect
 * "no change" via `removed.length === 0`.
 */
export function cleanUrl(
  input: string,
  params: ReadonlySet<string> = TRACKING_PARAMS,
): CleanResult {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { url: input, removed: [] };
  }

  const removed: string[] = [];
  for (const key of [...parsed.searchParams.keys()]) {
    if (params.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
      removed.push(key);
    }
  }

  if (removed.length === 0) return { url: input, removed: [] };
  return { url: parsed.toString(), removed };
}
