/*
 * Alter/Me/A/I vault data model.
 *
 * The vault is an append-only log of AlterMeAIEvents — observations of YOUR own
 * behavior, captured locally and owned by you. This schema is the single most
 * load-bearing decision in the project: everything you can ever train your own
 * AI on is bounded by what an event is allowed to record. Keep it expressive,
 * provenance-rich, and extensible (the union grows; old events never break).
 */

export const SCHEMA_VERSION = 1;

/**
 * How sensitive a piece of captured behavior is. Drives retention, whether an
 * event may ever feed a disclosure to a site, and how aggressively it is
 * redacted before training. Ordered least -> most sensitive.
 */
export type Sensitivity = 'public' | 'personal' | 'sensitive' | 'secret';

/** Discriminant for the event union. Add new kinds here as capture grows. */
export type EventType =
  | 'navigation' // you visited / dwelled on a page
  | 'interaction' // you engaged: search, click, text selection
  | 'ai_exchange' // a prompt/response on an AI surface — training gold
  | 'disclosure' // the gating layer revealed or withheld data from a site
  | 'decision'; // a choice you made among options — unmasked revealed preference

/**
 * Which life-stream an event came from. Orthogonal to EventType: `type` is the
 * SHAPE of the observation, `stream` is the SOURCE DOMAIN it belongs to. Capture
 * is source-pluggable — new streams (gaming/health/shopping) flow into the same
 * cortex, permission gate, and neurotype. Absent ⇒ 'web' (back-compat: every
 * event written before this field existed is web behaviour).
 *
 * Per-stream sensitivity + permission scoping differ (health ≠ web); see
 * docs/DATA-STREAMS.md.
 */
export type Stream =
  | 'web' // browsing, search, AI exchanges (the built-in stream)
  | 'gaming' // play data across platforms (Steam, console, mobile)
  | 'health' // opt-in, disclosure-gated wellness data
  | 'shopping'; // purchases / IRL decisions

/**
 * Where an observation came from. Provenance is mandatory, but its fields vary
 * by stream: web events carry a host/url; a gaming event carries an app/title;
 * a health event may carry only a device. `host` is therefore optional — use
 * `originLabel()` to get a human source label for any event.
 */
export interface Provenance {
  /** Normalized web host (no leading www.), e.g. "nytimes.com". Web stream. */
  host?: string;
  /** Full URL. Sensitive (browsing history) — encrypted at rest. Web stream. */
  url?: string;
  /** Browser tab the event originated in, when known. Web stream. */
  tabId?: number;
  /** Non-web origin label, e.g. "Steam", "Apple Health", a store name. */
  app?: string;
}

/** Fields shared by every event regardless of type. */
interface BaseEvent {
  /** UUID, assigned on append. */
  id: string;
  /** Epoch milliseconds, assigned on append. */
  ts: number;
  /** Schema version this record was written under (for migrations). */
  v: number;
  type: EventType;
  source: Provenance;
  sensitivity: Sensitivity;
  /** Source life-stream. Absent ⇒ 'web' (back-compat). Set by the capture source. */
  stream?: Stream;
  /** Free-form tags for later querying/training slices. */
  tags?: string[];
}

export interface NavigationEvent extends BaseEvent {
  type: 'navigation';
  title?: string;
  /** Extracted page content (meta description + main text). Encrypted at rest. */
  content?: string;
  /** Milliseconds spent on the page, if measured. */
  dwellMs?: number;
  /** Host of the page you came from, within this session. */
  fromHost?: string;
}

export interface InteractionEvent extends BaseEvent {
  type: 'interaction';
  action: 'search' | 'click' | 'select' | 'submit';
  /** Search query you typed, or selected text. Content — encrypted at rest. */
  text?: string;
  /** Optional descriptor of the element interacted with (role/label). */
  target?: string;
}

export interface AiExchangeEvent extends BaseEvent {
  type: 'ai_exchange';
  /** Which assistant, e.g. "chatgpt", "claude". */
  assistant: string;
  /** What you asked. */
  prompt?: string;
  /** What it answered. */
  response?: string;
}

export interface DisclosureEvent extends BaseEvent {
  type: 'disclosure';
  decision: 'revealed' | 'withheld' | 'redacted';
  /** What field/category the site wanted, e.g. "email", "location". */
  field: string;
  /** The persona/policy that made the call. */
  policy?: string;
}

/** One option that was on the table at a decision point. */
export interface DecisionOption {
  /** Stable id/label for the option, e.g. "renegade", "buy", "rest". */
  id: string;
  /** Human label, if different from id. */
  label?: string;
  /** Whether THIS option is the one chosen. Exactly one option is chosen. */
  chosen?: boolean;
}

/**
 * A DECISION — a choice you made among options. The "unmasked revealed
 * preference" stream: who you are when you choose under constraint, often with
 * no audience (a single-player game choice is the purest case). First-class
 * because the structure (what was offered, what you picked, why, what
 * resulted) is the signal — flattening it into an interaction would lose it.
 *
 * xAPI-MAPPABLE (deliberate): actor=you, verb=`chose`, object=the picked
 * option, context=`prompt`/source/stream, result=`outcome`. So a DecisionEvent
 * converts losslessly to/from an xAPI statement, and game telemetry / learning-
 * record tooling can interoperate — without us storing the heavier xAPI shape.
 */
export interface DecisionEvent extends BaseEvent {
  type: 'decision';
  /** What was being decided — the question/situation. Content (encrypted). */
  prompt: string;
  /** The options that were available. The chosen one has chosen:true. */
  options: DecisionOption[];
  /** Convenience: id of the chosen option (must match one in `options`). */
  chosen: string;
  /** Free-text reasoning, if the user/source surfaced it. Content (encrypted). */
  rationale?: string;
  /** What happened as a result, if known/observed later. */
  outcome?: string;
  /**
   * How constrained / consequential the choice was, when known — e.g. a forced
   * irreversible game decision vs. a casual pick. Helps weight the signal.
   */
  weight?: 'trivial' | 'normal' | 'major';
}

export type AlterMeAIEvent =
  | NavigationEvent
  | InteractionEvent
  | AiExchangeEvent
  | DisclosureEvent
  | DecisionEvent;

/**
 * A human-readable source label for any event, across streams: the web host,
 * else the non-web app/origin, else the stream name. Never returns undefined,
 * so consumers (Mind, trajectory) can rely on a string for grouping/display.
 */
export function originLabel(e: { source: Provenance; stream?: Stream }): string {
  return e.source.host ?? e.source.app ?? e.stream ?? 'web';
}

/**
 * Distributive Omit. Plain `Omit<Union, K>` collapses a discriminated union to
 * only its shared keys (it takes keyof the whole union = the intersection),
 * which would silently drop every type-specific field like `title` or `prompt`.
 * Distributing over each member preserves them.
 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown
  ? Omit<T, K>
  : never;

/** An event before the vault stamps it with id/ts/v. */
export type NewEvent = DistributiveOmit<AlterMeAIEvent, 'id' | 'ts' | 'v'>;

/** Filter for querying the log. All fields optional and AND-combined. */
export interface EventQuery {
  type?: EventType;
  /** Only events at or after this epoch-ms. */
  since?: number;
  /** Only events at or before this epoch-ms. */
  until?: number;
  /** Max results, newest first. */
  limit?: number;
}

/** Aggregate view of the corpus, safe to show without decrypting content. */
export interface VaultStats {
  total: number;
  byType: Record<EventType, number>;
  earliest?: number;
  latest?: number;
}
