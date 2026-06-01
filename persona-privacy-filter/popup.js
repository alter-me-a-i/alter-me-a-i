/* Popup controller. Reads/writes settings in storage.sync; the background
 * worker reacts to those changes to apply network rules and badges. */
(function () {
  "use strict";

  const ext = typeof browser !== "undefined" ? browser : chrome;
  const Core = PersonaCore;

  const DEFAULTS = { enabled: true, activePersona: Core.DEFAULT_PERSONA, perSite: {} };

  const FEATURE_LABELS = [
    ["blockTrackers", "Block trackers & ads"],
    ["blockThirdPartyCookies", "Block third-party cookies"],
    ["stripUrlParams", "Strip tracking parameters"],
    ["redactSensitive", "Blur sensitive data on pages"],
    ["guardLLM", "Warn before sharing with AI"],
    ["spoofReferrer", "Hide referrer"],
  ];

  const els = {
    master: document.getElementById("masterToggle"),
    host: document.getElementById("siteHost"),
    scopeRow: document.getElementById("scopeRow"),
    personaList: document.getElementById("personaList"),
    featureList: document.getElementById("featureList"),
    clearCookies: document.getElementById("clearCookies"),
    openOptions: document.getElementById("openOptions"),
    toast: document.getElementById("toast"),
    brand: document.getElementById("brandEmoji"),
  };

  let settings = { ...DEFAULTS };
  let host = "";
  let scope = "site"; // "site" | "global"

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    setTimeout(() => els.toast.classList.remove("show"), 1400);
  }

  async function getActiveHost() {
    try {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const u = new URL(tab.url);
        if (/^https?:$/.test(u.protocol)) return u.hostname;
      }
    } catch (_) {
      /* ignore */
    }
    return "";
  }

  function hasOverride() {
    const key = Core.normalizeHost(host);
    return key && Object.prototype.hasOwnProperty.call(settings.perSite, key);
  }

  // Which persona id is selected in the current scope view.
  function selectedId() {
    if (scope === "site" && hasOverride()) {
      return settings.perSite[Core.normalizeHost(host)];
    }
    if (scope === "site") {
      return Core.resolvePersonaId(settings, host);
    }
    return settings.activePersona;
  }

  function render() {
    document.body.classList.toggle("is-disabled", !settings.enabled);
    els.master.checked = settings.enabled;
    els.host.textContent = host || "this page";

    // scope availability: "this site" only meaningful with a real host
    els.scopeRow.style.display = host ? "flex" : "none";
    els.scopeRow.querySelectorAll(".pp-scope-btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.scope === scope);
    });

    const activeId = selectedId();
    const activeProfile = Core.getProfile(activeId);
    els.brand.textContent = activeProfile.emoji;

    // personas
    els.personaList.innerHTML = "";
    Core.PERSONA_ORDER.forEach((id) => {
      const p = Core.PERSONA_PROFILES[id];
      const btn = document.createElement("button");
      btn.className = "pp-persona" + (id === activeId ? " is-active" : "");
      btn.style.setProperty("--p-accent", p.accent);
      btn.innerHTML =
        `<span class="pp-persona-emoji">${p.emoji}</span>` +
        `<span class="pp-persona-body">` +
        `<span class="pp-persona-name">${p.name}</span>` +
        `<span class="pp-persona-tag">${p.tagline}</span>` +
        `</span>` +
        `<span class="pp-persona-check">✓</span>`;
      btn.addEventListener("click", () => choosePersona(id));
      els.personaList.appendChild(btn);
    });

    // feature breakdown
    els.featureList.innerHTML = "";
    FEATURE_LABELS.forEach(([flag, label]) => {
      const row = document.createElement("div");
      row.className = "pp-feature" + (activeProfile[flag] ? " on" : "");
      row.innerHTML = `<span class="dot"></span><span>${label}</span>`;
      els.featureList.appendChild(row);
    });
  }

  async function save() {
    await ext.storage.sync.set(settings);
  }

  async function choosePersona(id) {
    const key = Core.normalizeHost(host);
    if (scope === "site" && key) {
      settings.perSite = { ...settings.perSite, [key]: id };
      toast(`This site → ${Core.getProfile(id).name}`);
    } else {
      settings.activePersona = id;
      if (key && hasOverride()) {
        // switching the global default also clears this site's override so the
        // change is visible here
        const copy = { ...settings.perSite };
        delete copy[key];
        settings.perSite = copy;
      }
      toast(`Default → ${Core.getProfile(id).name}`);
    }
    await save();
    render();
  }

  function bind() {
    els.master.addEventListener("change", async () => {
      settings.enabled = els.master.checked;
      await save();
      render();
    });

    els.scopeRow.querySelectorAll(".pp-scope-btn").forEach((b) => {
      b.addEventListener("click", () => {
        scope = b.dataset.scope;
        render();
      });
    });

    els.clearCookies.addEventListener("click", async () => {
      if (!host) {
        toast("No site detected");
        return;
      }
      try {
        const res = await ext.runtime.sendMessage({ type: "clearCookies", host });
        toast(res && res.ok ? `Cleared ${res.cleared} cookies` : "Failed");
      } catch (_) {
        toast("Failed");
      }
    });

    els.openOptions.addEventListener("click", () => {
      if (ext.runtime.openOptionsPage) ext.runtime.openOptionsPage();
      else window.open("options.html");
    });
  }

  async function init() {
    const stored = await ext.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
    host = await getActiveHost();
    if (!host) scope = "global";
    bind();
    render();
  }

  init();
})();
