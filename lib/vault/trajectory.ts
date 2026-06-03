/*
 * Trajectory export — the bridge from "captured corpus" to "training data".
 *
 * The vault stores raw AlterMeAIEvents. To train YOUR model on YOUR behavior, that
 * corpus has to come out in a shape a fine-tuner understands. The de-facto
 * standard for supervised fine-tuning (OpenAI, Hugging Face, axolotl, etc.) is
 * JSONL where each line is one sample: { "messages": [{role, content}, ...] }.
 *
 * Designing this NOW — before capture begins — means the events we start
 * collecting are trajectory-shaped from the first write, with no later
 * migration. This is the open-source idea Hermes validates: the export format is
 * the valuable artifact, so we bake it in rather than bolt it on.
 *
 * Pure module: no IO, no crypto. It transforms decrypted events into samples so
 * it can be unit-tested in isolation and reused by any future training helper.
 */

import { originLabel, type AlterMeAIEvent, type Sensitivity } from './types';

/** A single chat turn, role-tagged. Matches the OpenAI/HF SFT message shape. */
export interface TrajectoryMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** One training sample = one JSONL line. */
export interface TrajectorySample {
  messages: TrajectoryMessage[];
  /** Provenance kept out of `messages` so it never pollutes the training text. */
  meta: {
    host: string;
    ts: number;
    kind: AlterMeAIEvent['type'];
    tags?: string[];
  };
}

export interface TrajectoryOptions {
  /**
   * Highest sensitivity allowed into training data. Events above this are
   * dropped entirely. Default 'personal' — public + personal in, sensitive +
   * secret out. Your most private behavior never leaves the vault as training
   * fodder unless you explicitly raise this.
   */
  maxSensitivity?: Sensitivity;
  /** Scrub emails / phones / cards / SSNs from free text. Default true. */
  redact?: boolean;
  /**
   * Prepend a compact behavioral-context system message describing what you
   * were doing around each AI exchange. Default true — this is what makes the
   * model learn *you*, not just generic Q&A.
   */
  includeContext?: boolean;
  /** Window (ms) of prior events summarized into the context message. */
  contextWindowMs?: number;
}

const SENSITIVITY_RANK: Record<Sensitivity, number> = {
  public: 0,
  personal: 1,
  sensitive: 2,
  secret: 3,
};

const DEFAULTS: Required<TrajectoryOptions> = {
  maxSensitivity: 'personal',
  redact: true,
  includeContext: true,
  contextWindowMs: 5 * 60_000, // 5 minutes of lead-up behavior
};

/** Redaction patterns for the most common PII leaks in free text. */
const REDACTIONS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b(?:\d[ -]*?){13,16}\b/g, '[card]'], // 13-16 digit sequences
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/\b\+?\d[\d\s().-]{7,}\d\b/g, '[phone]'],
];

export function redactText(text: string): string {
  return REDACTIONS.reduce((acc, [re, sub]) => acc.replace(re, sub), text);
}

function clean(text: string | undefined, redact: boolean): string {
  if (!text) return '';
  return redact ? redactText(text) : text;
}

/** Short human-readable summary of one non-AI event, for context lines. */
function describe(event: AlterMeAIEvent): string | null {
  const where = originLabel(event);
  switch (event.type) {
    case 'navigation':
      return `visited ${where}${event.title ? ` — "${event.title}"` : ''}`;
    case 'interaction':
      return event.text
        ? `${event.action} "${event.text}" on ${where}`
        : `${event.action} on ${where}`;
    case 'disclosure':
      return `${event.decision} ${event.field} from ${where}`;
    case 'decision': {
      const pick = event.options.find((o) => o.id === event.chosen);
      return `chose "${pick?.label ?? pick?.id ?? event.chosen}" — ${event.prompt} (${where})`;
    }
    case 'ai_exchange':
      return null; // AI exchanges are samples, not context lines
  }
}

/**
 * Convert a flat event log into training trajectories.
 *
 * Current strategy: every AI exchange with both a prompt and a response becomes
 * one faithful chat sample (your prompt as `user`, the assistant reply as
 * `assistant`), optionally grounded by a system message summarizing what you
 * were doing in the minutes before. Roles are preserved as they actually
 * happened; whether you later flip them to clone your own voice is a
 * training-time choice, not baked into the export. As capture grows, additional
 * event kinds can graduate into their own sample shapes here without touching
 * the stored schema.
 */
export function toTrajectories(
  events: AlterMeAIEvent[],
  options: TrajectoryOptions = {},
): TrajectorySample[] {
  const opts = { ...DEFAULTS, ...options };
  const maxRank = SENSITIVITY_RANK[opts.maxSensitivity];

  // Ascending by time so "prior context" means what it says.
  const sorted = [...events]
    .filter((e) => SENSITIVITY_RANK[e.sensitivity] <= maxRank)
    .sort((a, b) => a.ts - b.ts);

  const samples: TrajectorySample[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    if (event.type !== 'ai_exchange') continue;
    if (!event.prompt || !event.response) continue;

    const messages: TrajectoryMessage[] = [];

    if (opts.includeContext) {
      const since = event.ts - opts.contextWindowMs;
      const context = sorted
        .slice(0, i)
        .filter((e) => e.ts >= since)
        .map(describe)
        .filter((line): line is string => line !== null);
      if (context.length) {
        messages.push({
          role: 'system',
          content: `Recent activity:\n- ${context.join('\n- ')}`,
        });
      }
    }

    messages.push({ role: 'user', content: clean(event.prompt, opts.redact) });
    messages.push({
      role: 'assistant',
      content: clean(event.response, opts.redact),
    });

    samples.push({
      messages,
      meta: {
        host: originLabel(event),
        ts: event.ts,
        kind: event.type,
        tags: event.tags,
      },
    });
  }

  return samples;
}

/** Serialize samples to JSONL — one sample per line, ready for a fine-tuner. */
export function toJSONL(samples: TrajectorySample[]): string {
  return samples.map((s) => JSON.stringify(s)).join('\n');
}
