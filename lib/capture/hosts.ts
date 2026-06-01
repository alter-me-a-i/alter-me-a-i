/*
 * Host helpers for capture: normalization, AI-surface detection, and a
 * sensitivity screen for hosts that should never feed training by default.
 */

/** Strip leading www. and lowercase. "WWW.NYTimes.com" -> "nytimes.com". */
export function normalizeHost(host: string): string {
  if (!host) return '';
  return host.replace(/^www\./i, '').toLowerCase();
}

/** Known AI/LLM surfaces mapped to a stable assistant id. */
const AI_HOSTS: Record<string, string> = {
  'chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'claude.ai': 'claude',
  'gemini.google.com': 'gemini',
  'perplexity.ai': 'perplexity',
  'poe.com': 'poe',
  'copilot.microsoft.com': 'copilot',
  'chat.deepseek.com': 'deepseek',
  'chat.mistral.ai': 'mistral',
  'grok.com': 'grok',
  'meta.ai': 'meta',
};

/** Returns the assistant id for an AI host, or null if it isn't one. */
export function aiAssistantFor(host: string): string | null {
  const h = normalizeHost(host);
  for (const [entry, assistant] of Object.entries(AI_HOSTS)) {
    if (h === entry || h.endsWith('.' + entry)) return assistant;
  }
  return null;
}

/**
 * Hosts whose mere visit is sensitive — finance, health, government. Events
 * from these are classified 'sensitive', so the default training export
 * (maxSensitivity 'personal') drops them. Your bank and your doctor never
 * become training data unless you explicitly opt in.
 */
const SENSITIVE_HOST_RE =
  /(^|\.)(bank|chase|wellsfargo|bankofamerica|citi|capitalone|paypal|venmo|cashapp|coinbase|kraken|fidelity|schwab|vanguard|etrade|robinhood|aetna|cigna|kaiser|unitedhealth|mychart|epic|labcorp|questdiagnostics|irs|ssa|healthcare)\b|health|patient|medical|clinic|hospital|insur|\.gov$/i;

export function isSensitiveHost(host: string): boolean {
  return SENSITIVE_HOST_RE.test(normalizeHost(host));
}
