const { test: base } = require('@playwright/test');
const { expect } = require('@playwright/test');
const { createTestRules } = require('./helpers/rules');
const path = require('path');
const { chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');

// Combine fixtures inline
const test = base.extend({
  context: async ({ }, use) => {
    const extensionPath = path.resolve(__dirname, '../../');
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
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },

  injectRules: async ({ context, extensionId }, use) => {
    const injectRules = async (rulesConfig) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await page.evaluate((rules) => {
        return new Promise((resolve) => {
          chrome.storage.sync.set(rules, resolve);
        });
      }, rulesConfig);
      await page.close();
    };
    await use(injectRules);
  },

  testServer: async ({ }, use) => {
    const e2eDir = path.resolve(__dirname, '../../e2e');
    const connections = new Set();
    const server = http.createServer((req, res) => {
      const filePath = path.join(e2eDir, req.url === '/' ? 'index.html' : req.url);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }
        const ext = path.extname(filePath);
        const contentType = ext === '.html' ? 'text/html' : 'text/plain';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
    // Track connections to force-close them on teardown
    server.on('connection', (conn) => {
      connections.add(conn);
      conn.on('close', () => connections.delete(conn));
    });
    await new Promise((resolve) => {
      server.listen(0, 'localhost', resolve);
    });
    const port = server.address().port;
    const baseURL = `http://localhost:${port}`;
    await use({ baseURL, port });
    // Force-close all connections before closing server
    connections.forEach(conn => conn.destroy());
    await new Promise((resolve) => {
      server.close(resolve);
    });
  },
});

const testWithAll = test;

testWithAll.describe('Baseline: Click Rule Only', () => {
  testWithAll('should click button when only click rule matches', async ({
    context,
    injectRules,
    testServer
  }) => {
    // Setup: Only click rule, no close rule
    const rules = createTestRules({
      includeClick: true,
      includeClose: false
    });
    await injectRules(rules);

    // Navigate to test page
    const page = await context.newPage();
    await page.goto(`${testServer.baseURL}/test-conflict-button-exists.html`);

    // Wait for page load
    await page.waitForLoadState('load');

    // Verify button is clicked
    await page.waitForFunction(() => {
      const button = document.getElementById('test-button');
      return button && button.getAttribute('data-clicked') === 'true';
    }, { timeout: 3000 });

    // Verify tab remains open
    const pages = context.pages();
    expect(pages.length).toBeGreaterThan(0);

    // Verify countdown never appears
    const countdown = await page.$('[data-click-custodian-countdown]');
    expect(countdown).toBeNull();
  });
});

testWithAll.describe('Baseline: Close Rule Only', () => {
  testWithAll('should close tab with countdown when only close rule matches', async ({
    context,
    injectRules,
    testServer
  }) => {
    // Setup: Only close rule, no click rule
    const rules = createTestRules({
      includeClick: false,
      includeClose: true
    });
    await injectRules(rules);

    // Navigate to test page
    const page = await context.newPage();
    const initialPageCount = context.pages().length;

    await page.goto(`${testServer.baseURL}/test-conflict-no-button.html`);
    await page.waitForLoadState('load');

    // Verify countdown appears
    const countdown = await page.waitForSelector('[data-click-custodian-countdown]', {
      timeout: 5000
    });
    expect(countdown).not.toBeNull();

    // Verify the overlay's user-facing copy and that a live countdown
    // number is rendered. The pre-redesign copy ("close in N seconds")
    // was replaced by a heading + a standalone number inside the ring.
    const countdownText = await countdown.textContent();
    expect(countdownText).toMatch(/closing this tab/i);
    const secondsValue = await page.locator('#click-custodian-seconds').textContent();
    expect(parseInt(secondsValue, 10)).toBeGreaterThan(0);

    // Wait for tab to close
    await page.waitForEvent('close', { timeout: 5000 });

    // Verify page count decreased
    const finalPageCount = context.pages().length;
    expect(finalPageCount).toBe(initialPageCount - 1);
  });
});

testWithAll.describe('Baseline: No Matching Rules', () => {
  testWithAll('should do nothing when no rules match', async ({
    context,
    injectRules,
    testServer
  }) => {
    // Setup: Rules that don't match test page URL
    const rules = createTestRules({
      clickRule: { urlPattern: 'http://example.com/*' },
      closeRule: { urlPattern: 'http://example.com/*' }
    });
    await injectRules(rules);

    // Navigate to test page
    const page = await context.newPage();
    const initialPageCount = context.pages().length;

    await page.goto(`${testServer.baseURL}/test-conflict-button-exists.html`);
    await page.waitForLoadState('load');

    // Wait a bit to ensure nothing happens
    await page.waitForTimeout(3000);

    // Verify button not clicked
    const buttonClicked = await page.evaluate(() => {
      const button = document.getElementById('test-button');
      return button && button.getAttribute('data-clicked') === 'true';
    });
    expect(buttonClicked).toBe(false);

    // Verify countdown never appears
    const countdown = await page.$('[data-click-custodian-countdown]');
    expect(countdown).toBeNull();

    // Verify tab remains open
    const finalPageCount = context.pages().length;
    expect(finalPageCount).toBe(initialPageCount);
  });
});
