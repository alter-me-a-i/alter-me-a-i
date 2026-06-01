import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    // Display/brand name = the slashed wordmark (infrastructure-layer cortex).
    name: 'Alter/Me/A/I',
    description: 'The membrane between public expression and private repository — local-first, open-source. Gate your data, build your own AI.',
    // storage: vault salt + capture/defense settings live in chrome.storage.local.
    // declarativeNetRequest: tracker blocking + 3rd-party cookie/referrer rules.
    // scripting: register the MAIN-world fingerprint gate at runtime per persona.
    // alarms: fire the auto-lock at the chosen deadline even if the worker slept.
    permissions: ['storage', 'declarativeNetRequest', 'scripting', 'alarms'],
    // Capture runs on every page; defense header rules need broad host access.
    host_permissions: ['<all_urls>'],
    // Static tracker blocklist toggled by persona (enabled at runtime, not load).
    declarative_net_request: {
      rule_resources: [
        { id: 'trackers', enabled: false, path: 'rules/trackers.json' },
      ],
    },
    // The status-bar content script loads bundled skin fonts on any page, so the
    // font files must be reachable from web-page contexts.
    web_accessible_resources: [
      {
        resources: ['fonts/VT323-Regular.ttf', 'fonts/Michroma-Regular.ttf'],
        matches: ['<all_urls>'],
      },
    ],
    // Alter/Me/A/I sends nothing off-device. Declare zero data collection for Firefox.
    browser_specific_settings: {
      gecko: {
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
});
