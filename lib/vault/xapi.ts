/*
 * xAPI bridge — proves (and enforces) that a Alter/Me/A/I DecisionEvent is losslessly
 * mappable to the xAPI / "Tin Can" statement standard (actor–verb–object,
 * with context + result). xAPI is the de-facto standard for capturing
 * experiences/choices, including in games and learning sims, so making our
 * decisions convertible means we can export to standard tooling (an LRS) and
 * import game telemetry — without storing the heavier xAPI shape natively.
 *
 * Pure, dependency-free, no IO — unit-testable in isolation.
 */

import type { DecisionEvent } from './types';

/** The subset of an xAPI statement we produce. Stable, JSON-serialisable. */
export interface XapiStatement {
  actor: { objectType: 'Agent'; name: string };
  verb: { id: string; display: { 'en-US': string } };
  object: {
    objectType: 'Activity';
    id: string;
    definition: {
      name: { 'en-US': string };
      description?: { 'en-US': string };
      /** The options that were available, as xAPI "choices". */
      choices?: Array<{ id: string; description: { 'en-US': string } }>;
    };
  };
  result?: {
    response: string; // the chosen option id
    extensions?: Record<string, unknown>;
  };
  context?: {
    extensions: Record<string, unknown>;
  };
  timestamp: string; // ISO-8601
}

const VERB_CHOSE = 'http://adlnet.gov/expapi/verbs/chose'; // standard xAPI verb
const EXT = 'https://alter-me-a-i.local/xapi/ext'; // our extension namespace

/**
 * Convert a Alter/Me/A/I DecisionEvent into an xAPI statement. `actorName` defaults
 * to a neutral pseudonym — we never leak the real identity into an export.
 */
export function decisionToXapi(e: DecisionEvent, actorName = 'me'): XapiStatement {
  return {
    actor: { objectType: 'Agent', name: actorName },
    verb: { id: VERB_CHOSE, display: { 'en-US': 'chose' } },
    object: {
      objectType: 'Activity',
      id: `${EXT}/decision/${e.id}`,
      definition: {
        name: { 'en-US': e.prompt },
        description: e.rationale ? { 'en-US': e.rationale } : undefined,
        choices: e.options.map((o) => ({
          id: o.id,
          description: { 'en-US': o.label ?? o.id },
        })),
      },
    },
    result: {
      response: e.chosen,
      extensions: {
        [`${EXT}/outcome`]: e.outcome,
        [`${EXT}/weight`]: e.weight,
      },
    },
    context: {
      extensions: {
        [`${EXT}/stream`]: e.stream ?? 'web',
        [`${EXT}/source`]: e.source,
      },
    },
    timestamp: new Date(e.ts).toISOString(),
  };
}
