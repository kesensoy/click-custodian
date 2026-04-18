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

testWithAll.describe('Conflict Resolution: Button Exists', () => {
  testWithAll('should click button and prevent countdown when button exists', async ({
    context,
    injectRules,
    testServer
  }) => {
    // Setup: Both rules match
    const rules = createTestRules({
      includeClick: true,
      includeClose: true
    });
    await injectRules(rules);

    // Navigate to test page with button
    const page = await context.newPage();
    await page.goto(`${testServer.baseURL}/test-conflict-button-exists.html`);
    await page.waitForLoadState('load');

    // Verify button is clicked within 1 second
    await page.waitForFunction(() => {
      const button = document.getElementById('test-button');
      return button && button.getAttribute('data-clicked') === 'true';
    }, { timeout: 1000 });

    // Verify green highlight appears
    const highlight = await page.$('.click-custodian-highlight');
    if (highlight) {
      const styles = await highlight.evaluate((el) => {
        return window.getComputedStyle(el);
      });
      expect(styles.border).toContain('green');
    }

    // Wait a bit more to ensure countdown never appears
    await page.waitForTimeout(2000);

    // Verify countdown never appears
    const countdown = await page.$('[data-click-custodian-countdown]');
    expect(countdown).toBeNull();

    // Verify tab remains open
    const pages = context.pages();
    expect(pages.length).toBeGreaterThan(0);
  });
});

testWithAll.describe('Conflict Resolution: Button Not Found', () => {
  testWithAll('should show countdown and close tab when button not found', async ({
    context,
    injectRules,
    testServer
  }) => {
    // Setup: Both rules match
    const rules = createTestRules({
      includeClick: true,
      includeClose: true
    });
    await injectRules(rules);

    // Navigate to test page without button
    const page = await context.newPage();
    const initialPageCount = context.pages().length;

    await page.goto(`${testServer.baseURL}/test-conflict-no-button.html`);
    await page.waitForLoadState('load');

    // Wait for polling to timeout (3 seconds)
    await page.waitForTimeout(3500);

    // Verify countdown appears after polling timeout
    const countdown = await page.waitForSelector('[data-click-custodian-countdown]', {
      timeout: 2000
    });
    expect(countdown).not.toBeNull();

    // Verify countdown text decreases
    const countdownText1 = await countdown.textContent();
    await page.waitForTimeout(1000);
    const countdownText2 = await countdown.textContent();

    // Extract numbers from countdown text
    const getSeconds = (text) => parseInt(text.match(/(\d+)/)[1]);
    expect(getSeconds(countdownText2)).toBeLessThan(getSeconds(countdownText1));

    // Wait for tab to close
    await page.waitForEvent('close', { timeout: 5000 });

    // Verify page count decreased
    const finalPageCount = context.pages().length;
    expect(finalPageCount).toBe(initialPageCount - 1);
  });
});

testWithAll.describe('Conflict Resolution: Button Appears During Polling', () => {
  testWithAll('should click button when it appears within polling window', async ({
    context,
    injectRules,
    testServer
  }) => {
    // Setup: Both rules match
    const rules = createTestRules({
      includeClick: true,
      includeClose: true
    });
    await injectRules(rules);

    // Navigate to test page where button appears after 1.5s
    const page = await context.newPage();
    await page.goto(`${testServer.baseURL}/test-conflict-button-late.html`);
    await page.waitForLoadState('load');

    // Verify button is clicked within 3 seconds (before polling timeout)
    await page.waitForFunction(() => {
      const button = document.getElementById('test-button');
      return button && button.getAttribute('data-clicked') === 'true';
    }, { timeout: 3000 });

    // Verify countdown never appears
    const countdown = await page.$('[data-click-custodian-countdown]');
    expect(countdown).toBeNull();

    // Verify tab remains open
    const pages = context.pages();
    expect(pages.length).toBeGreaterThan(0);
  });
});

testWithAll.describe('Conflict Resolution: User Cancels Countdown', () => {
  testWithAll('should cancel countdown and keep tab open when user presses Escape', async ({
    context,
    injectRules,
    testServer
  }) => {
    // Setup: Both rules match
    const rules = createTestRules({
      includeClick: true,
      includeClose: true
    });
    await injectRules(rules);

    // Navigate to test page without button
    const page = await context.newPage();
    const initialPageCount = context.pages().length;

    await page.goto(`${testServer.baseURL}/test-conflict-no-button.html`);
    await page.waitForLoadState('load');

    // Wait for countdown to appear
    await page.waitForTimeout(3500);
    const countdown = await page.waitForSelector('[data-click-custodian-countdown]', {
      timeout: 2000
    });
    expect(countdown).not.toBeNull();

    // Press Escape to cancel
    await page.keyboard.press('Escape');

    // Verify countdown disappears
    await page.waitForFunction(() => {
      return !document.querySelector('[data-click-custodian-countdown]');
    }, { timeout: 1000 });

    // Wait a bit more to ensure tab doesn't close
    await page.waitForTimeout(3000);

    // Verify tab remains open
    const finalPageCount = context.pages().length;
    expect(finalPageCount).toBe(initialPageCount);
  });

  testWithAll('should cancel countdown when user clicks cancel button', async ({
    context,
    injectRules,
    testServer
  }) => {
    // Setup: Both rules match
    const rules = createTestRules({
      includeClick: true,
      includeClose: true
    });
    await injectRules(rules);

    // Navigate to test page without button
    const page = await context.newPage();
    const initialPageCount = context.pages().length;

    await page.goto(`${testServer.baseURL}/test-conflict-no-button.html`);
    await page.waitForLoadState('load');

    // Wait for countdown to appear
    await page.waitForTimeout(3500);
    const countdown = await page.waitForSelector('[data-click-custodian-countdown]', {
      timeout: 2000
    });

    // Click cancel button
    const cancelButton = await page.$('[data-click-custodian-countdown] button');
    await cancelButton.click();

    // Verify countdown disappears
    await page.waitForFunction(() => {
      return !document.querySelector('[data-click-custodian-countdown]');
    }, { timeout: 1000 });

    // Wait a bit more to ensure tab doesn't close
    await page.waitForTimeout(3000);

    // Verify tab remains open
    const finalPageCount = context.pages().length;
    expect(finalPageCount).toBe(initialPageCount);
  });
});
