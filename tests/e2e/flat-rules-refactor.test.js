const { test: base, expect, chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLegacyRules } = require('./helpers/rules');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const PROBE_PREFIX = '[CC_PROBE]';

/**
 * Launch a persistent Chromium context with the extension loaded,
 * piping console messages through a collector so tests can await
 * [CC_PROBE] envelopes deterministically.
 *
 * Returns { context, extensionId, probes, waitForProbe, userDataDir, cleanup }
 */
async function launchWithProbes({ userDataDir } = {}) {
  const dir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-'));
  const context = await chromium.launchPersistentContext(dir, {
    headless: process.env.CI !== undefined,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });

  const probes = [];
  const listeners = [];

  const attachConsoleListener = (worker) => {
    const handler = (msg) => {
      try {
        const args = msg.args();
        if (args.length < 2) return;
        // msg.text() gives us space-joined stringified args; check prefix quickly
        const text = msg.text();
        if (!text.startsWith(PROBE_PREFIX)) return;
        // Format: [CC_PROBE] event_name {json}
        const space1 = text.indexOf(' ');
        if (space1 < 0) return;
        const rest = text.slice(space1 + 1);
        const space2 = rest.indexOf(' ');
        if (space2 < 0) return;
        const event = rest.slice(0, space2);
        const payloadText = rest.slice(space2 + 1);
        let payload = {};
        try { payload = JSON.parse(payloadText); } catch (e) { payload = { _raw: payloadText }; }
        probes.push({ event, payload, raw: text });
      } catch (e) {
        // Defensive: never let listener throw
      }
    };
    worker.on('console', handler);
    listeners.push({ worker, handler });
  };

  // Listen on existing + future service workers
  for (const sw of context.serviceWorkers()) attachConsoleListener(sw);
  context.on('serviceworker', attachConsoleListener);

  // Discover extension ID
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  const extensionId = background.url().split('/')[2];

  const waitForProbe = async (eventName, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = probes.find(p => p.event === eventName);
      if (found) return found;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for probe "${eventName}". ` +
      `Seen events: [${probes.map(p => p.event).join(', ')}]`
    );
  };

  const cleanup = async () => {
    for (const { worker, handler } of listeners) {
      try { worker.off('console', handler); } catch (e) {}
    }
    await context.close();
    // Clean up user data dir
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  };

  return { context, extensionId, probes, waitForProbe, userDataDir: dir, cleanup };
}

/**
 * Read the full flat storage via the service worker.
 */
async function readStorage(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return worker.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.sync.get(null, resolve);
    });
  });
}

/**
 * Write storage via the service worker (so writes happen in the
 * extension's own storage partition).
 */
async function writeStorage(context, data) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return worker.evaluate((d) => {
    return new Promise((resolve) => {
      chrome.storage.sync.clear(() => {
        chrome.storage.sync.set(d, resolve);
      });
    });
  }, data);
}

/**
 * Invoke the migration function in the service worker context directly.
 * This is equivalent to firing onInstalled with reason='update' but
 * without the Chrome-level extension-reload dance that Playwright can't
 * easily perform in a persistent context.
 */
async function triggerMigration(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return worker.evaluate(() => migrateLegacyShape());
}

// ---------- Tests ----------

const test = base;

test.describe('Fresh install seeding', () => {
  let env;

  test.beforeEach(async () => {
    env = await launchWithProbes();
  });

  test.afterEach(async () => {
    if (env) await env.cleanup();
  });

  test('seeds two tab-close rules and zero button-click rules', async () => {
    const probe = await env.waitForProbe('install_seed', 8000);
    expect(probe.payload).toEqual({ tabCloseCount: 2, buttonClickCount: 0 });

    // Verify options page renders the two rules
    const page = await env.context.newPage();
    await page.goto(`chrome-extension://${env.extensionId}/options.html`);
    await page.waitForSelector('#close-user-list .rule-row:not(.header):not(.add-row)', { timeout: 5000 });

    const ruleNames = await page.$$eval(
      '#close-user-list .rule-row:not(.header) .name-input',
      inputs => inputs.map(i => i.value)
    );
    expect(ruleNames).toContain('Localhost OAuth callback');
    expect(ruleNames).toContain('Azure AD device code approval');
    await page.close();
  });
});

test.describe('Legacy migration', () => {
  let env;

  test.beforeEach(async () => {
    env = await launchWithProbes();
    // Wait for any initial install-seed to settle before we overwrite storage
    await env.waitForProbe('install_seed', 8000).catch(() => {});
  });

  test.afterEach(async () => {
    if (env) await env.cleanup();
  });

  test('migrates with all defaults enabled', async () => {
    const legacy = createLegacyRules({
      defaultRules: [
        { id: 'd1', name: 'Default 1', urlPattern: 'https://d1.example/*', matchType: 'glob', delay: 3000 }
      ],
      userRules: [
        { id: 'u1', name: 'User 1', urlPattern: 'https://u1.example/*', matchType: 'glob', delay: 3000, enabled: true }
      ],
      defaultRulesEnabled: { d1: true }
    });
    await writeStorage(env.context, legacy);

    await triggerMigration(env.context);

    const probe = await env.waitForProbe('update_migrate_done', 5000);
    expect(probe.payload).toMatchObject({
      keptDefaults: 1,
      userRules: 1,
      resultTabClose: 2,
      droppedDefaults: 0
    });

    const storage = await readStorage(env.context);
    expect(storage.defaultRules).toBeUndefined();
    expect(storage.userRules).toBeUndefined();
    expect(storage.defaultRulesEnabled).toBeUndefined();
    expect(storage.defaultsVersion).toBeUndefined();
    expect(Array.isArray(storage.tabCloseRules)).toBe(true);
    expect(storage.tabCloseRules).toHaveLength(2);
    expect(storage.buttonClickRules).toEqual([]);
  });

  test('drops disabled legacy defaults', async () => {
    const legacy = createLegacyRules({
      defaultRules: [
        { id: 'd1', name: 'Default 1', urlPattern: 'https://d1.example/*', matchType: 'glob', delay: 3000 }
      ],
      userRules: [
        { id: 'u1', name: 'User 1', urlPattern: 'https://u1.example/*', matchType: 'glob', delay: 3000, enabled: true }
      ],
      defaultRulesEnabled: { d1: false }
    });
    await writeStorage(env.context, legacy);

    await triggerMigration(env.context);

    const probe = await env.waitForProbe('update_migrate_done', 5000);
    expect(probe.payload).toMatchObject({
      droppedDefaults: 1,
      keptDefaults: 0,
      userRules: 1,
      resultTabClose: 1
    });

    const storage = await readStorage(env.context);
    expect(storage.tabCloseRules).toHaveLength(1);
    expect(storage.tabCloseRules[0].id).toBe('u1');
  });

  test('skip fires when already flat', async () => {
    // Storage is already flat from initial seed; clear probes and trigger migration
    env.probes.length = 0;
    await triggerMigration(env.context);
    const skip = await env.waitForProbe('update_migrate_skip', 3000);
    expect(skip).toBeDefined();
    // Ensure migrate_done did NOT fire
    const done = env.probes.find(p => p.event === 'update_migrate_done');
    expect(done).toBeUndefined();
  });
});

test.describe('Options UI — import/export/reset', () => {
  let env;

  test.beforeEach(async () => {
    env = await launchWithProbes();
    await env.waitForProbe('install_seed', 8000).catch(() => {});
  });

  test.afterEach(async () => {
    if (env) await env.cleanup();
  });

  async function openOptions() {
    const page = await env.context.newPage();
    await page.goto(`chrome-extension://${env.extensionId}/options.html`);
    // Wait for DOMContentLoaded + storage load
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.waitForTimeout(200); // let loadConfig finish
    return page;
  }

  async function writeImportFile(payload) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-import-'));
    const filePath = path.join(dir, 'rules.json');
    fs.writeFileSync(filePath, payload);
    return filePath;
  }

  test('import merge re-IDs rules on ID collision', async () => {
    // Start fresh: set known flat storage via page
    await writeStorage(env.context, {
      tabCloseRules: [{
        id: 'known-id-x',
        name: 'Existing',
        urlPattern: 'https://existing.example/*',
        matchType: 'glob',
        delay: 3000,
        enabled: true
      }],
      buttonClickRules: []
    });

    const page = await openOptions();

    // Build import file with colliding id
    const importPayload = JSON.stringify({
      tabCloseRules: [{
        id: 'known-id-x',
        name: 'Imported',
        urlPattern: 'https://imported.example/*',
        matchType: 'glob',
        delay: 2000,
        enabled: true
      }],
      buttonClickRules: []
    });
    const filePath = await writeImportFile(importPayload);

    // Click the real Import button; this triggers the hidden file input
    await page.setInputFiles('#import-file', filePath);

    // Modal appears
    await page.waitForSelector('#import-overlay.open', { timeout: 3000 });
    await page.click('#import-merge');

    // Save (merge marks dirty, tests storage after save)
    await page.click('#save-config');
    await page.waitForFunction(() => {
      const el = document.getElementById('actionbar-info-text');
      return el && el.textContent === 'saved';
    }, { timeout: 3000 });

    const storage = await readStorage(env.context);
    expect(storage.tabCloseRules).toHaveLength(2);
    const existing = storage.tabCloseRules.find(r => r.name === 'Existing');
    const imported = storage.tabCloseRules.find(r => r.name === 'Imported');
    expect(existing.id).toBe('known-id-x');
    expect(imported.id).toMatch(/^rule_\d+_[a-z0-9]+$/);
    await page.close();
  });

  test('import replace wipes existing after confirm', async () => {
    await writeStorage(env.context, {
      tabCloseRules: [
        { id: 'a', name: 'A', urlPattern: 'https://a/*', matchType: 'glob', delay: 3000, enabled: true },
        { id: 'b', name: 'B', urlPattern: 'https://b/*', matchType: 'glob', delay: 3000, enabled: true },
        { id: 'c', name: 'C', urlPattern: 'https://c/*', matchType: 'glob', delay: 3000, enabled: true }
      ],
      buttonClickRules: []
    });

    const page = await openOptions();

    const importPayload = JSON.stringify({
      tabCloseRules: [{
        id: 'fresh',
        name: 'Fresh',
        urlPattern: 'https://fresh/*',
        matchType: 'glob',
        delay: 3000,
        enabled: true
      }],
      buttonClickRules: []
    });
    const filePath = await writeImportFile(importPayload);

    // Accept the native confirm() fired by commitImport('replace')
    page.on('dialog', dialog => dialog.accept());

    await page.setInputFiles('#import-file', filePath);
    await page.waitForSelector('#import-overlay.open', { timeout: 3000 });
    await page.click('#import-replace');

    await page.click('#save-config');
    await page.waitForFunction(() => {
      const el = document.getElementById('actionbar-info-text');
      return el && el.textContent === 'saved';
    }, { timeout: 3000 });

    const storage = await readStorage(env.context);
    expect(storage.tabCloseRules).toHaveLength(1);
    expect(storage.tabCloseRules[0].name).toBe('Fresh');
    await page.close();
  });

  test('import cancel preserves state', async () => {
    await writeStorage(env.context, {
      tabCloseRules: [
        { id: 'a', name: 'A', urlPattern: 'https://a/*', matchType: 'glob', delay: 3000, enabled: true }
      ],
      buttonClickRules: []
    });

    const page = await openOptions();

    const importPayload = JSON.stringify({
      tabCloseRules: [{
        id: 'fresh',
        name: 'Fresh',
        urlPattern: 'https://fresh/*',
        matchType: 'glob',
        delay: 3000,
        enabled: true
      }],
      buttonClickRules: []
    });
    const filePath = await writeImportFile(importPayload);

    await page.setInputFiles('#import-file', filePath);
    await page.waitForSelector('#import-overlay.open', { timeout: 3000 });
    await page.click('#import-cancel');

    // Overlay closes
    await page.waitForFunction(() => !document.getElementById('import-overlay').classList.contains('open'));

    const storage = await readStorage(env.context);
    expect(storage.tabCloseRules).toHaveLength(1);
    expect(storage.tabCloseRules[0].name).toBe('A');
    await page.close();
  });

  test('invalid JSON import shows error toast and preserves state', async () => {
    await writeStorage(env.context, {
      tabCloseRules: [
        { id: 'a', name: 'A', urlPattern: 'https://a/*', matchType: 'glob', delay: 3000, enabled: true }
      ],
      buttonClickRules: []
    });

    const page = await openOptions();
    const filePath = await writeImportFile('this is not json {');
    await page.setInputFiles('#import-file', filePath);

    await page.waitForFunction(() => {
      const el = document.getElementById('status-message');
      return el && /Failed to parse/i.test(el.textContent);
    }, { timeout: 3000 });

    const storage = await readStorage(env.context);
    expect(storage.tabCloseRules).toHaveLength(1);
    expect(storage.tabCloseRules[0].name).toBe('A');
    await page.close();
  });

  test('reset to examples restores seed rules', async () => {
    await writeStorage(env.context, {
      tabCloseRules: [
        { id: 'custom', name: 'Custom', urlPattern: 'https://custom/*', matchType: 'glob', delay: 3000, enabled: true }
      ],
      buttonClickRules: []
    });

    const page = await openOptions();

    page.on('dialog', dialog => dialog.accept());
    await page.click('#reset-config');

    // Wait for toast success
    await page.waitForFunction(() => {
      const el = document.getElementById('status-message');
      return el && /Reset to example/i.test(el.textContent);
    }, { timeout: 3000 });

    const storage = await readStorage(env.context);
    const names = storage.tabCloseRules.map(r => r.name);
    expect(names).toContain('Localhost OAuth callback');
    expect(names).toContain('Azure AD device code approval');
    expect(names).not.toContain('Custom');
    await page.close();
  });

  test('unsaved changes guards export (dismiss cancels download)', async () => {
    await writeStorage(env.context, {
      tabCloseRules: [
        { id: 'a', name: 'A', urlPattern: 'https://a/*', matchType: 'glob', delay: 3000, enabled: true }
      ],
      buttonClickRules: []
    });

    const page = await openOptions();

    // Edit the name input to mark dirty
    const nameInput = await page.waitForSelector('#close-user-list .rule-row:not(.header) .name-input');
    await nameInput.click({ clickCount: 3 });
    await nameInput.type('A-edited');
    // Tab out to ensure change event fires
    await page.keyboard.press('Tab');

    await page.waitForFunction(() => {
      const el = document.getElementById('actionbar-info-text');
      return el && el.textContent === 'unsaved changes';
    }, { timeout: 3000 });

    // Dismiss the confirm dialog
    page.on('dialog', dialog => dialog.dismiss());

    let downloadStarted = false;
    page.on('download', () => { downloadStarted = true; });

    await page.click('#export-config');
    // Give it a moment
    await page.waitForTimeout(500);

    expect(downloadStarted).toBe(false);
    await page.close();
  });
});
