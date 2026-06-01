/*
 * Background service worker (Chrome) / event page (Firefox).
 *
 * Responsibilities:
 *   - Hold default settings and seed them on install.
 *   - Translate the active persona into network-level controls:
 *       * enable/disable the static tracker blocklist (declarativeNetRequest)
 *       * dynamic header rules for third-party cookies and the referrer
 *   - Keep the toolbar badge in sync with the effective persona per tab.
 *   - Handle a couple of imperative actions (clear cookies for a host).
 *
 * Per-site overrides change on-page behaviour and the badge. Network rules are
 * global and follow the active persona (declarativeNetRequest is not scoped to a
 * single tab), so that limitation is intentional and documented in the README.
 */

// In Firefox the event page loads personas.js via the manifest scripts array.
// In a Chrome classic service worker importScripts is available; pull it in only
// if the globals are not already present.
if (typeof PersonaCore === "undefined" && typeof importScripts === "function") {
  importScripts("personas.js");
}

const ext = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_SETTINGS = {
  enabled: true,
  activePersona: PersonaCore.DEFAULT_PERSONA,
  perSite: {},
};

const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other",
];

// Fixed IDs so we can deterministically replace dynamic rules each apply.
const RULE_ID = {
  STRIP_COOKIE_REQUEST: 1001,
  STRIP_COOKIE_RESPONSE: 1002,
  STRIP_REFERER: 1003,
};

async function getSettings() {
  const stored = await ext.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

// The profile that drives global network rules (master switch forces "open").
function networkProfile(settings) {
  if (!settings.enabled) return PersonaCore.getProfile("open");
  return PersonaCore.getProfile(settings.activePersona);
}

async function applyTrackerRuleset(profile) {
  try {
    if (profile.blockTrackers) {
      await ext.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ["trackers"],
      });
    } else {
      await ext.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ["trackers"],
      });
    }
  } catch (err) {
    console.warn("[Persona] tracker ruleset toggle failed:", err);
  }
}

async function applyDynamicRules(profile) {
  const addRules = [];

  if (profile.blockThirdPartyCookies) {
    addRules.push({
      id: RULE_ID.STRIP_COOKIE_REQUEST,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "cookie", operation: "remove" }],
      },
      condition: { domainType: "thirdParty", resourceTypes: RESOURCE_TYPES },
    });
    addRules.push({
      id: RULE_ID.STRIP_COOKIE_RESPONSE,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [{ header: "set-cookie", operation: "remove" }],
      },
      condition: { domainType: "thirdParty", resourceTypes: RESOURCE_TYPES },
    });
  }

  if (profile.spoofReferrer) {
    addRules.push({
      id: RULE_ID.STRIP_REFERER,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "referer", operation: "remove" }],
      },
      condition: { domainType: "thirdParty", resourceTypes: RESOURCE_TYPES },
    });
  }

  try {
    await ext.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: Object.values(RULE_ID),
      addRules,
    });
  } catch (err) {
    console.warn("[Persona] dynamic rule update failed:", err);
  }
}

async function applyNetworkControls() {
  const settings = await getSettings();
  const profile = networkProfile(settings);
  await applyTrackerRuleset(profile);
  await applyDynamicRules(profile);
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return "";
  }
}

async function updateBadgeForTab(tabId, url) {
  if (tabId == null) return;
  const settings = await getSettings();
  let profile;
  if (!settings.enabled) {
    profile = PersonaCore.getProfile("open");
  } else {
    const host = hostFromUrl(url);
    profile = PersonaCore.getProfile(
      PersonaCore.resolvePersonaId(settings, host)
    );
  }
  try {
    await ext.action.setBadgeText({ tabId, text: profile.emoji });
    if (ext.action.setBadgeBackgroundColor) {
      await ext.action.setBadgeBackgroundColor({ tabId, color: profile.accent });
    }
    await ext.action.setTitle({
      tabId,
      title: `Persona: ${profile.name} — ${profile.tagline}`,
    });
  } catch (err) {
    // setBadgeText with emoji can fail on some platforms; fall back to letter.
    try {
      await ext.action.setBadgeText({
        tabId,
        text: profile.name.charAt(0),
      });
    } catch (_) {
      /* ignore */
    }
  }
}

async function refreshAllBadges() {
  try {
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null) updateBadgeForTab(tab.id, tab.url || tab.pendingUrl);
    }
  } catch (err) {
    console.warn("[Persona] badge refresh failed:", err);
  }
}

async function clearCookiesForHost(host) {
  if (!host || !ext.cookies) return { cleared: 0 };
  let cleared = 0;
  const variants = new Set([host, host.replace(/^www\./, ""), "www." + host]);
  for (const h of variants) {
    let cookies = [];
    try {
      cookies = await ext.cookies.getAll({ domain: h });
    } catch (_) {
      continue;
    }
    for (const c of cookies) {
      const prefix = c.secure ? "https://" : "http://";
      const cookieHost = c.domain.replace(/^\./, "");
      const url = prefix + cookieHost + c.path;
      try {
        await ext.cookies.remove({
          url,
          name: c.name,
          storeId: c.storeId,
        });
        cleared++;
      } catch (_) {
        /* ignore individual failures */
      }
    }
  }
  return { cleared };
}

// --- Event wiring ---------------------------------------------------------

ext.runtime.onInstalled.addListener(async () => {
  const current = await ext.storage.sync.get(null);
  const seeded = { ...DEFAULT_SETTINGS, ...current };
  await ext.storage.sync.set(seeded);
  await applyNetworkControls();
  await refreshAllBadges();
});

if (ext.runtime.onStartup) {
  ext.runtime.onStartup.addListener(async () => {
    await applyNetworkControls();
    await refreshAllBadges();
  });
}

ext.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") return;
  if (changes.activePersona || changes.enabled || changes.perSite) {
    await applyNetworkControls();
    await refreshAllBadges();
  }
});

if (ext.tabs.onActivated) {
  ext.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await ext.tabs.get(tabId);
      updateBadgeForTab(tabId, tab.url || tab.pendingUrl);
    } catch (_) {
      /* tab may have closed */
    }
  });
}

if (ext.tabs.onUpdated) {
  ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === "loading") {
      updateBadgeForTab(tabId, changeInfo.url || tab.url);
    }
  });
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message && message.type) {
        case "clearCookies": {
          const result = await clearCookiesForHost(message.host);
          sendResponse({ ok: true, ...result });
          break;
        }
        case "reapply": {
          await applyNetworkControls();
          await refreshAllBadges();
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // keep the channel open for the async response
});

// Apply once when the worker first spins up.
applyNetworkControls();
refreshAllBadges();
