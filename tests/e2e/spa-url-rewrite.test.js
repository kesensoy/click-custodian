const { test: base, expect } = require('@playwright/test');
const path = require('path');
const { chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');

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
    if (!background) background = await context.waitForEvent('serviceworker');
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
  injectRules: async ({ context, extensionId }, use) => {
    const injectRules = async (rulesConfig) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await page.evaluate((rules) => {
        return new Promise((resolve) => chrome.storage.sync.set(rules, resolve));
      }, rulesConfig);
      await page.close();
    };
    await use(injectRules);
  },
  testServer: async ({ }, use) => {
    // Match the directory baseline.test.js uses for fixtures.
    const fixturesDir = path.resolve(__dirname, '../../e2e');
    const connections = new Set();
    const server = http.createServer((req, res) => {
      // Strip the query string before resolving to a file path — this fixture
      // explicitly exercises a navigation with query parameters, and naive
      // `path.join` would otherwise try to open a file whose name includes
      // the query string and 404.
      const pathname = req.url.split('?')[0];
      const filePath = path.join(fixturesDir, pathname === '/' ? 'index.html' : pathname);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('File not found'); return; }
        const ext = path.extname(filePath);
        const contentType = ext === '.html' ? 'text/html' : 'text/plain';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
    server.on('connection', (conn) => {
      connections.add(conn);
      conn.on('close', () => connections.delete(conn));
    });
    await new Promise((resolve) => server.listen(0, 'localhost', resolve));
    const port = server.address().port;
    await use({ baseURL: `http://localhost:${port}`, port });
    connections.forEach(conn => conn.destroy());
    await new Promise((resolve) => server.close(resolve));
  },
});

test.describe('SPA URL rewrite', () => {
  test('close rule matching only the cleaned URL fires after rewrite', async ({
    context, injectRules, testServer
  }) => {
    // Rule pattern matches the clean URL exactly (no query string).
    const cleanPath = '/test-spa-url-rewrite.html';
    const exactPattern = `${testServer.baseURL}${cleanPath}`;

    await injectRules({
      tabCloseRules: [{
        id: 'spa-rewrite-close', name: 'spa-rewrite-close', enabled: true,
        urlPattern: exactPattern, matchType: 'exact', delay: 5000
      }],
      buttonClickRules: []
    });

    const page = await context.newPage();
    // Load with a query string the rule does not match.
    await page.goto(`${testServer.baseURL}${cleanPath}?spa=1&extra=2`);
    await page.waitForLoadState('load');

    // Before the rewrite (which fires at ~600ms), no countdown should exist.
    // Sample at ~300ms.
    await page.waitForTimeout(300);
    expect(await page.$('[data-click-custodian-countdown]')).toBeNull();

    // After the rewrite + cooldown, the countdown should appear.
    // Cooldown is 1500ms; rewrite at ~600ms; allow ~3s total.
    const countdown = await page.waitForSelector('[data-click-custodian-countdown]', { timeout: 5000 });
    expect(countdown).not.toBeNull();

    // Sanity check: the URL the page actually has now is the clean one.
    const currentUrl = page.url();
    expect(currentUrl).toBe(exactPattern);
  });
});
