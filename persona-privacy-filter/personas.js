/*
 * Shared persona definitions and helpers.
 * Classic (non-module) script: attaches to globalThis so it can be reused by
 * the service worker (importScripts), the content script, and the popup/options
 * pages (via <script src>).
 */
(function (root) {
  "use strict";

  // A persona is a privacy profile. Each flag controls one layer of leakage.
  //   blockTrackers          -> enable the declarativeNetRequest tracker ruleset
  //   blockThirdPartyCookies -> strip Cookie / Set-Cookie on cross-site requests
  //   stripUrlParams         -> remove tracking params from links and the URL bar
  //   redactSensitive        -> blur emails / phones / cards / SSNs shown on pages
  //   guardLLM               -> warn before sending sensitive text to AI chat sites
  //   spoofReferrer          -> drop the Referer header on cross-site navigation
  const PERSONA_PROFILES = {
    ghost: {
      id: "ghost",
      name: "Ghost",
      emoji: "👻",
      tagline: "Share almost nothing",
      description:
        "Maximum privacy. Blocks trackers and third-party cookies, strips tracking parameters, blurs sensitive data on pages, and guards what you paste into AI chats.",
      accent: "#6c5ce7",
      blockTrackers: true,
      blockThirdPartyCookies: true,
      stripUrlParams: true,
      redactSensitive: true,
      guardLLM: true,
      spoofReferrer: true,
    },
    pseudonym: {
      id: "pseudonym",
      name: "Pseudonym",
      emoji: "🕶️",
      tagline: "Blend into the crowd",
      description:
        "Balanced. Blocks trackers and third-party cookies and strips tracking parameters, but leaves page content untouched so sites keep working.",
      accent: "#0984e3",
      blockTrackers: true,
      blockThirdPartyCookies: true,
      stripUrlParams: true,
      redactSensitive: false,
      guardLLM: true,
      spoofReferrer: false,
    },
    casual: {
      id: "casual",
      name: "Casual",
      emoji: "🙂",
      tagline: "Light touch",
      description:
        "Blocks the worst tracking offenders and cleans tracking parameters from links. Cookies and page content are left alone.",
      accent: "#00b894",
      blockTrackers: true,
      blockThirdPartyCookies: false,
      stripUrlParams: true,
      redactSensitive: false,
      guardLLM: false,
      spoofReferrer: false,
    },
    open: {
      id: "open",
      name: "Open",
      emoji: "🌐",
      tagline: "Filtering off",
      description:
        "No filtering. Everything passes through untouched — useful for sites that break with privacy protections on.",
      accent: "#b2bec3",
      blockTrackers: false,
      blockThirdPartyCookies: false,
      stripUrlParams: false,
      redactSensitive: false,
      guardLLM: false,
      spoofReferrer: false,
    },
  };

  const PERSONA_ORDER = ["ghost", "pseudonym", "casual", "open"];
  const DEFAULT_PERSONA = "pseudonym";

  // Hosts treated as AI / LLM chat surfaces for the guardLLM feature.
  const LLM_HOSTS = [
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "bard.google.com",
    "copilot.microsoft.com",
    "www.bing.com",
    "perplexity.ai",
    "www.perplexity.ai",
    "poe.com",
    "huggingface.co",
    "x.com",
    "grok.com",
    "chat.deepseek.com",
    "chat.mistral.ai",
    "meta.ai",
  ];

  // Known tracking query parameters stripped when stripUrlParams is on.
  const TRACKING_PARAMS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "utm_name",
    "utm_cid",
    "utm_reader",
    "utm_referrer",
    "utm_social",
    "utm_social-type",
    "fbclid",
    "gclid",
    "gclsrc",
    "dclid",
    "gbraid",
    "wbraid",
    "msclkid",
    "mc_cid",
    "mc_eid",
    "igshid",
    "igsh",
    "_hsenc",
    "_hsmi",
    "vero_id",
    "vero_conv",
    "oly_anon_id",
    "oly_enc_id",
    "yclid",
    "ysclid",
    "_openstat",
    "wickedid",
    "twclid",
    "rb_clickid",
    "s_cid",
    "ml_subscriber",
    "ml_subscriber_hash",
    "spm",
    "scm",
    "ref_src",
    "ref_url",
  ];

  function normalizeHost(host) {
    if (!host) return "";
    return host.replace(/^www\./i, "").toLowerCase();
  }

  function getProfile(id) {
    return PERSONA_PROFILES[id] || PERSONA_PROFILES[DEFAULT_PERSONA];
  }

  function isLLMHost(host) {
    if (!host) return false;
    const h = host.toLowerCase();
    return LLM_HOSTS.some((entry) => h === entry || h.endsWith("." + entry));
  }

  // Resolve the effective persona id for a host given global + per-site settings.
  function resolvePersonaId(settings, host) {
    const s = settings || {};
    const perSite = s.perSite || {};
    const key = normalizeHost(host);
    if (key && Object.prototype.hasOwnProperty.call(perSite, key)) {
      return perSite[key];
    }
    return s.activePersona || DEFAULT_PERSONA;
  }

  const api = {
    PERSONA_PROFILES,
    PERSONA_ORDER,
    DEFAULT_PERSONA,
    LLM_HOSTS,
    TRACKING_PARAMS,
    normalizeHost,
    getProfile,
    isLLMHost,
    resolvePersonaId,
  };

  root.PersonaCore = api;
  // Convenience top-level globals for contexts that expect them directly.
  root.PERSONA_PROFILES = PERSONA_PROFILES;
})(typeof self !== "undefined" ? self : this);
