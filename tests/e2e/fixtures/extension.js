const { test: base, chromium } = require('@playwright/test');
const path = require('path');
const { createTestRules } = require('../helpers/rules');

/**
 * Extension fixture that loads Click Custodian with test rules
 */
const test = base.extend({
  context: async ({ }, use) => {
    const extensionPath = path.resolve(__dirname, '../../../'); // Root of extension

    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
      ],
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // Get extension ID from chrome://extensions page
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }

    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },

  injectRules: async ({ context, extensionId }, use) => {
    // Helper to inject rules into extension storage
    const injectRules = async (rulesConfig) => {
      const page = await context.newPage();

      await page.goto(`chrome-extension://${extensionId}/options.html`);

      // Inject rules directly into chrome.storage.sync
      await page.evaluate((rules) => {
        return new Promise((resolve) => {
          chrome.storage.sync.set(rules, resolve);
        });
      }, rulesConfig);

      await page.close();
    };

    await use(injectRules);
  },
});

module.exports = { test };
