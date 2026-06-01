/*
 * Content script. Runs in every frame at document_start.
 *
 * It resolves the effective persona for the current host and applies the
 * on-page layers:
 *   - stripUrlParams : clean tracking params from the address bar and links
 *   - redactSensitive: blur emails / phones / cards / SSNs / secrets (reveal on click)
 *   - guardLLM       : warn before sending sensitive text into AI chat composers
 *
 * personas.js runs just before this file (see manifest content_scripts) and
 * exposes PersonaCore on the shared isolated-world global.
 */
(function () {
  "use strict";

  if (typeof PersonaCore === "undefined") return; // personas.js failed to load
  const ext = typeof browser !== "undefined" ? browser : chrome;

  const HOST = location.hostname;
  const Core = PersonaCore;

  let profile = Core.getProfile(Core.DEFAULT_PERSONA);
  let started = false;

  // --- Sensitive data detection ------------------------------------------

  const DETECTORS = [
    { type: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { type: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
    {
      type: "card",
      re: /\b(?:\d[ -]?){13,19}\b/g,
      validate: luhnValid,
    },
    {
      type: "phone",
      re: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{2,4}[\s.-]?\d{2,4}\b/g,
      validate: (s) => (s.replace(/\D/g, "").length >= 9),
    },
    { type: "secret", re: /\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/g },
  ];

  function luhnValid(raw) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // Returns array of { type, start, end } matches within a string, sorted and
  // non-overlapping (earliest match of any type wins).
  function findSensitive(text) {
    const hits = [];
    for (const det of DETECTORS) {
      det.re.lastIndex = 0;
      let m;
      while ((m = det.re.exec(text)) !== null) {
        const value = m[0];
        if (det.validate && !det.validate(value)) continue;
        hits.push({ type: det.type, start: m.index, end: m.index + value.length });
      }
    }
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const result = [];
    let lastEnd = -1;
    for (const h of hits) {
      if (h.start >= lastEnd) {
        result.push(h);
        lastEnd = h.end;
      }
    }
    return result;
  }

  function detectTypes(text) {
    const set = new Set();
    for (const h of findSensitive(text)) set.add(h.type);
    return [...set];
  }

  // --- URL parameter stripping -------------------------------------------

  function cleanUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch (_) {
      return { url: rawUrl, changed: false };
    }
    let changed = false;
    for (const param of Core.TRACKING_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    }
    return { url: url.toString(), changed };
  }

  function cleanCurrentLocation() {
    if (location.search.length <= 1) return;
    const { url, changed } = cleanUrl(location.href);
    if (changed) {
      try {
        history.replaceState(history.state, document.title, url);
      } catch (_) {
        /* some pages disallow replaceState; ignore */
      }
    }
  }

  function cleanLinksIn(root) {
    const anchors =
      root.nodeType === Node.ELEMENT_NODE && root.matches && root.matches("a[href]")
        ? [root]
        : root.querySelectorAll
        ? root.querySelectorAll("a[href]")
        : [];
    anchors.forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      const { url, changed } = cleanUrl(href);
      if (changed) a.setAttribute("href", url);
    });
  }

  // --- Page redaction -----------------------------------------------------

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "CODE",
    "PRE",
  ]);
  const processedText = new WeakSet();

  function shouldSkipNode(node) {
    let el = node.parentElement;
    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.isContentEditable) return true;
      if (el.classList && el.classList.contains("persona-redacted")) return true;
      el = el.parentElement;
    }
    return false;
  }

  function redactTextNode(node) {
    if (processedText.has(node)) return;
    const text = node.nodeValue;
    if (!text || text.length < 5 || !/[@\d]/.test(text)) {
      processedText.add(node);
      return;
    }
    if (shouldSkipNode(node)) return;

    const hits = findSensitive(text);
    if (!hits.length) {
      processedText.add(node);
      return;
    }

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const h of hits) {
      if (h.start > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, h.start)));
      }
      const span = document.createElement("span");
      span.className = "persona-redacted";
      span.dataset.personaType = h.type;
      span.title = "Hidden by Persona — click to reveal";
      span.textContent = text.slice(h.start, h.end);
      frag.appendChild(span);
      cursor = h.end;
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    if (node.parentNode) node.parentNode.replaceChild(frag, node);
  }

  function redactSubtree(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(redactTextNode);
  }

  // Reveal on click (delegated, registered once).
  let revealBound = false;
  function bindReveal() {
    if (revealBound) return;
    revealBound = true;
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains("persona-redacted")) {
          t.classList.toggle("revealed");
        }
      },
      true
    );
  }

  // --- LLM composer guard -------------------------------------------------

  let banner = null;
  function ensureBanner() {
    if (banner && document.body.contains(banner)) return banner;
    banner = document.createElement("div");
    banner.className = "persona-llm-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML =
      '<span class="persona-llm-icon">🛡️</span>' +
      '<span class="persona-llm-text"></span>' +
      '<button class="persona-llm-dismiss" type="button" aria-label="Dismiss">✕</button>';
    banner.querySelector(".persona-llm-dismiss").addEventListener("click", () => {
      banner.classList.remove("show");
    });
    (document.body || document.documentElement).appendChild(banner);
    return banner;
  }

  const LABELS = {
    email: "email address",
    phone: "phone number",
    ssn: "SSN",
    card: "card number",
    secret: "API key / secret",
  };

  function showGuard(types) {
    const b = ensureBanner();
    const names = types.map((t) => LABELS[t] || t).join(", ");
    b.querySelector(".persona-llm-text").textContent =
      "Heads up — this looks like it contains: " + names + ". Sensitive info shared with AI services can be stored or used for training.";
    b.classList.add("show");
  }

  function hideGuard() {
    if (banner) banner.classList.remove("show");
  }

  function composerText(el) {
    if (!el) return "";
    if (el.value != null) return el.value;
    return el.innerText || el.textContent || "";
  }

  let guardTimer = null;
  function handleComposerInput(e) {
    const el = e.target;
    if (!el) return;
    const isComposer =
      (el.tagName === "TEXTAREA") ||
      (el.tagName === "INPUT" && /text|search|email/.test(el.type || "")) ||
      el.isContentEditable;
    if (!isComposer) return;
    clearTimeout(guardTimer);
    guardTimer = setTimeout(() => {
      const types = detectTypes(composerText(el));
      if (types.length) showGuard(types);
      else hideGuard();
    }, 350);
  }

  // --- Orchestration ------------------------------------------------------

  let observer = null;

  function runInitialSweep() {
    if (profile.stripUrlParams) {
      cleanCurrentLocation();
      if (document.body) cleanLinksIn(document.body);
    }
    if (profile.redactSensitive && document.body) {
      bindReveal();
      redactSubtree(document.body);
    }
    if (profile.guardLLM && Core.isLLMHost(HOST)) {
      document.addEventListener("input", handleComposerInput, true);
    }
  }

  function startObserver() {
    if (observer) observer.disconnect();
    if (!(profile.stripUrlParams || profile.redactSensitive)) return;
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (profile.stripUrlParams) cleanLinksIn(node);
            if (profile.redactSensitive) redactSubtree(node);
          } else if (
            node.nodeType === Node.TEXT_NODE &&
            profile.redactSensitive
          ) {
            redactTextNode(node);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function teardown() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    document.removeEventListener("input", handleComposerInput, true);
    hideGuard();
  }

  function apply() {
    teardown();
    runInitialSweep();
    startObserver();
  }

  function start() {
    if (started) return;
    started = true;
    apply();
  }

  function loadAndApply() {
    ext.storage.sync.get(null).then((stored) => {
      const settings = { enabled: true, ...stored };
      if (settings.enabled === false) {
        profile = Core.getProfile("open");
      } else {
        profile = Core.getProfile(Core.resolvePersonaId(settings, HOST));
      }
      if (document.body) start();
      else
        document.addEventListener("DOMContentLoaded", start, { once: true });
    });
  }

  // React to live settings changes from the popup/options page. New protections
  // (param stripping, redaction, guard) apply immediately; already-redacted text
  // is only restored on the next page load.
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.activePersona || changes.enabled || changes.perSite) {
      started = false;
      loadAndApply();
    }
  });

  loadAndApply();
})();
