#!/usr/bin/env node
// Regenerates the committed screenshot assets in ../../assets/:
//
//   README / GitHub (retina @ DSF=2):
//     hero.png            — top-of-README hero (countdown intercept shot)
//     comparison.png      — narrower before/after for README inline use
//     overlay.png         — the real countdown overlay on a mock host page
//     highlight.png       — green button-highlight indicator on a mock SSO page
//     popup.png           — live extension popup
//     settings.png        — live extension options page
//
//   Chrome Web Store listing (exact canvas @ DSF=1, 24-bit PNG no alpha):
//     cws-screenshot.png  — 1280x800 listing screenshot
//     cws-promo-small.png — 440x280 small promo tile
//     cws-promo-marquee.png — 1400x560 marquee promo
//
// Flow:
//   1. Start a tiny HTTP server on 127.0.0.1:PORT serving the repo root
//      so templates in this dir can reference /content.css etc.
//   2. README templates: plain browser at DSF=2, screenshot at target size.
//   3. CWS templates: plain browser at DSF=1, screenshot at exact canvas
//      size, then re-encode via `sips` (macOS) to strip the alpha channel
//      — CWS rejects 32-bit RGBA PNGs.
//   4. Live popup/settings: launch a persistent context with the extension
//      loaded (+ --force-device-scale-factor=2 for retina output), wait
//      for the SW to register, seed storage with a representative rule
//      set, then screenshot the chrome-extension://<id>/ pages.
//
// Usage: npm run screenshots
//
// Requires: @playwright/test (already a devDependency for e2e).
// macOS-only: sips is used for alpha-stripping the CWS PNGs.

// Imports chromium via @playwright/test rather than the bare `playwright`
// package — @playwright/test is the declared devDependency (see
// package.json) and re-exports the browser launchers, so this avoids
// relying on a transitive resolution of `playwright`.
import { chromium } from '@playwright/test';
import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const ASSETS_DIR = path.join(REPO_ROOT, 'assets');
const PROFILE_DIR = path.join(REPO_ROOT, '.screenshot-profile');
const PORT = 8766;

// README / GitHub assets — captured at DSF=2 so they stay sharp when the
// browser scales them down via the `width="…"` attr in README.md.
const TEMPLATES = [
  {
    label: 'hero',
    html: 'scripts/screenshots/hero.html',
    width: 1280,
    height: 640,
    out: path.join(ASSETS_DIR, 'hero.png'),
  },
  {
    label: 'comparison',
    html: 'scripts/screenshots/comparison.html',
    width: 1200,
    height: 360,
    out: path.join(ASSETS_DIR, 'comparison.png'),
  },
  {
    label: 'overlay',
    html: 'scripts/screenshots/overlay.html',
    width: 1000,
    height: 520,
    out: path.join(ASSETS_DIR, 'overlay.png'),
    // The real overlay is dark-first (matches hero mockup + brand); force
    // the browser's prefers-color-scheme so the capture reflects what
    // users with the system dark-mode default actually see.
    colorScheme: 'dark',
  },
  {
    label: 'highlight',
    html: 'scripts/screenshots/highlight.html',
    width: 720,
    height: 520,
    out: path.join(ASSETS_DIR, 'highlight.png'),
  },
];

// Chrome Web Store listing assets — must match exact physical canvas
// sizes (DSF=1) and must be 24-bit PNG with no alpha channel. Playwright
// always emits 32-bit RGBA PNGs, so after capture we re-encode via `sips`
// (macOS built-in). macOS-only: fine for a dev-time tool, matches the
// sneetches pipeline this one is modeled on.
const CWS_TEMPLATES = [
  {
    label: 'cws-screenshot',
    html: 'scripts/screenshots/cws-screenshot.html',
    width: 1280,
    height: 800,
    out: path.join(ASSETS_DIR, 'cws-screenshot.png'),
  },
  {
    label: 'cws-promo-small',
    html: 'scripts/screenshots/cws-promo-small.html',
    width: 440,
    height: 280,
    out: path.join(ASSETS_DIR, 'cws-promo-small.png'),
  },
  {
    label: 'cws-promo-marquee',
    html: 'scripts/screenshots/cws-promo-marquee.html',
    width: 1400,
    height: 560,
    out: path.join(ASSETS_DIR, 'cws-promo-marquee.png'),
  },
];

// Rules seeded into the extension for the popup/settings shots. We
// reuse the shipped seed (so the shots track what fresh installs
// actually see) and augment it with one disabled close rule + two
// demo click rules so the settings page renders with varied state
// (seed-examples.json ships zero click rules by design).
async function loadSeedRules() {
  const shipped = JSON.parse(
    await fs.readFile(path.join(REPO_ROOT, 'seed-examples.json'), 'utf-8')
  );
  const closeRules = [
    ...shipped.tabCloseRules,
    {
      id: 'shot-company-sso',
      name: 'Company SSO logout',
      urlPattern: '*://sso.mycompany.com/logout*',
      matchType: 'glob',
      enabled: false,
      delay: 2000,
    },
  ];
  const clickRules = [
    {
      id: 'shot-google-continue',
      name: 'Google account picker',
      urlPattern: '*://accounts.google.com/signin/*',
      matchType: 'glob',
      selector: 'button',
      buttonText: 'Continue',
      enabled: true,
      delay: 500,
    },
    {
      id: 'shot-github-sso',
      name: 'GitHub SSO continue',
      urlPattern: '*://github.com/sso*',
      matchType: 'glob',
      selector: 'button[type="submit"]',
      buttonText: '',
      enabled: true,
      delay: 300,
    },
  ];
  return { closeRules, clickRules };
}

// --------------------------------------------------------------------------
// HTTP server — repo root, so templates can `<link rel="stylesheet"
// href="/content.css">` etc. Path-traversal guard anchored to REPO_ROOT +
// path.sep so a sibling dir sharing the textual prefix can't slip past.
// --------------------------------------------------------------------------
function startServer() {
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const rel = url === '/' ? '/index.html' : url;
    const filePath = path.join(REPO_ROOT, rel);
    if (filePath !== REPO_ROOT && !filePath.startsWith(REPO_ROOT + path.sep)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath)
      .then((data) => {
        const ext = path.extname(filePath).toLowerCase();
        const ct =
          ext === '.html'
            ? 'text/html; charset=utf-8'
            : ext === '.css'
              ? 'text/css; charset=utf-8'
              : ext === '.js' || ext === '.mjs'
                ? 'text/javascript; charset=utf-8'
                : ext === '.json'
                  ? 'application/json; charset=utf-8'
                  : ext === '.svg'
                    ? 'image/svg+xml'
                    : ext === '.png'
                      ? 'image/png'
                      : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        res.end(data);
      })
      .catch(() => {
        res.writeHead(404);
        res.end('not found');
      });
  });
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `[screenshots] port ${PORT} is already in use. Kill the other listener (lsof -iTCP:${PORT} -sTCP:LISTEN) or change PORT in capture.mjs.`
          )
        );
      } else {
        reject(err);
      }
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// --------------------------------------------------------------------------
// Static template captures — plain browser, no extension needed.
// --------------------------------------------------------------------------
async function captureTemplates() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const t of TEMPLATES) {
      console.log(`[screenshots:${t.label}] capturing ${t.html}`);
      const context = await browser.newContext({
        viewport: { width: t.width, height: t.height },
        deviceScaleFactor: 2,
        ...(t.colorScheme ? { colorScheme: t.colorScheme } : {}),
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/${t.html}`, {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
      // Wait for webfonts (Inter / Fraunces / JetBrains Mono loaded by
      // overlay.html + highlight.html) to actually become available for
      // layout, so the screenshot doesn't catch a system-font fallback
      // frame. Hero/comparison don't load webfonts; fonts.ready resolves
      // near-instantly there. The extra 150ms is paint-settle insurance
      // after font swap — not strictly required by fonts.ready, but keeps
      // the output deterministic across runs.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.screenshot({
        path: t.out,
        clip: { x: 0, y: 0, width: t.width, height: t.height },
      });
      console.log(`[screenshots:${t.label}] wrote ${path.relative(REPO_ROOT, t.out)}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// --------------------------------------------------------------------------
// Chrome Web Store assets — DSF=1 at exact canvas sizes, then alpha-strip
// via sips so CWS's 24-bit-PNG validator accepts the upload.
// --------------------------------------------------------------------------
async function captureCwsTemplates() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const t of CWS_TEMPLATES) {
      console.log(`[screenshots:${t.label}] capturing ${t.html}`);
      const context = await browser.newContext({
        viewport: { width: t.width, height: t.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/${t.html}`, {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      // Temp filename keeps the .png extension so Playwright can infer
      // format; sips re-encodes over this file into the final `out` path.
      const tmp = t.out.replace(/\.png$/, '.alpha.png');
      await page.screenshot({
        path: tmp,
        type: 'png',
        clip: { x: 0, y: 0, width: t.width, height: t.height },
      });
      const r = spawnSync('sips', ['-s', 'format', 'png', tmp, '--out', t.out], {
        stdio: 'pipe',
      });
      if (r.status !== 0) {
        throw new Error(
          `[screenshots:${t.label}] sips failed (is this macOS?): ${r.stderr?.toString() ?? ''}`
        );
      }
      await fs.unlink(tmp);
      console.log(`[screenshots:${t.label}] wrote ${path.relative(REPO_ROOT, t.out)}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// --------------------------------------------------------------------------
// Live extension captures — persistent context with the extension loaded,
// so chrome.* APIs work on the extension's own pages.
// --------------------------------------------------------------------------
async function captureExtension() {
  // Fresh profile each run — keeps storage state reproducible and avoids
  // inheriting left-over rules from a prior capture.
  await fs.rm(PROFILE_DIR, { recursive: true, force: true });
  await fs.mkdir(PROFILE_DIR, { recursive: true });

  // Playwright on Chromium loads extensions only with a persistent context.
  // headless: false needed on older Chromium; newer builds accept extensions
  // in headless mode, but non-headless is the portable choice. Position
  // the window off-screen so it doesn't flash in front of the user.
  //
  // DSF is forced to 2 per-page below via CDP (see setRetinaViewport) so
  // popup.png / settings.png come out retina-sharp — otherwise they render
  // at DSF=1 and look fuzzy when the README scales them with width="…".
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: [
      `--disable-extensions-except=${REPO_ROOT}`,
      `--load-extension=${REPO_ROOT}`,
      '--window-position=-10000,-10000',
      '--window-size=1280,800',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    // Wait for the MV3 service worker to register. Arm waitForEvent
    // *before* the sync check so we can't miss a registration that
    // happens between these two lines — subscribe first, then look for
    // an already-present worker. Swallow rejection so that when the
    // existingSw branch is taken, the still-armed timeout eventually
    // rejecting doesn't surface as an unhandled rejection.
    const swEventPromise = context
      .waitForEvent('serviceworker', { timeout: 15000 })
      .catch(() => null);
    const existingSw = context.serviceWorkers()[0];
    const sw = existingSw || (await swEventPromise);
    if (!sw) {
      throw new Error('[screenshots] timed out waiting for extension service worker');
    }
    const m = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
    if (!m) throw new Error(`[screenshots] unexpected SW URL: ${sw.url()}`);
    const extId = m[1];
    console.log(`[screenshots:ext] extension ID: ${extId}`);

    // Seed storage via the service worker so the extension pages render
    // with a realistic rule set. Note: this writes to chrome.storage.sync
    // directly — it bypasses background.js's onInstalled seeder, so this
    // pipeline won't catch a regression in the seeder path itself.
    const { closeRules, clickRules } = await loadSeedRules();
    await sw.evaluate(
      async ([close, click]) => {
        await new Promise((r) =>
          chrome.storage.sync.set({ tabCloseRules: close, buttonClickRules: click }, () => r())
        );
      },
      [closeRules, clickRules]
    );
    // Give chrome.storage.sync a tick to propagate before the pages load.
    await new Promise((r) => setTimeout(r, 300));

    // Playwright's page.screenshot() doesn't honor DSF set via CDP
    // Emulation — it captures at DSF=1 no matter what — so for the
    // retina versions of the extension pages we drive the capture
    // through CDP directly. Sets the emulation metrics (CSS viewport
    // size + DSF=2) and asks Page.captureScreenshot for the clip; the
    // output PNG is the CSS clip × DSF in physical pixels.
    const captureRetina = async (page, cssWidth, cssHeight, clipBox, outPath, label) => {
      const session = await context.newCDPSession(page);
      try {
        await session.send('Emulation.setDeviceMetricsOverride', {
          width: cssWidth,
          height: cssHeight,
          deviceScaleFactor: 2,
          mobile: false,
        });
        const { data } = await session.send('Page.captureScreenshot', {
          format: 'png',
          clip: {
            x: 0,
            y: 0,
            width: clipBox.width,
            height: clipBox.height,
            scale: 1,
          },
          captureBeyondViewport: true,
        });
        await fs.writeFile(outPath, Buffer.from(data, 'base64'));
        console.log(
          `[screenshots:${label}] wrote ${path.relative(REPO_ROOT, outPath)} (CSS ${clipBox.width}x${clipBox.height} → physical ${clipBox.width * 2}x${clipBox.height * 2})`
        );
      } finally {
        await session.detach();
      }
    };

    // Popup: render popup.html at its natural popup width and crop to the
    // body bbox so we don't get trailing empty viewport.
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 420, height: 640 });
    await popupPage.goto(`chrome-extension://${extId}/popup.html`, {
      waitUntil: 'networkidle',
      timeout: 15000,
    });
    await popupPage.waitForTimeout(500);
    const popupBox = await popupPage.evaluate(() => {
      const b = document.body;
      return { width: b.offsetWidth, height: b.offsetHeight };
    });
    await captureRetina(
      popupPage,
      420,
      640,
      popupBox,
      path.join(ASSETS_DIR, 'popup.png'),
      'popup'
    );
    await popupPage.close();

    // Settings: wide viewport so the two-column layout renders correctly.
    const settingsPage = await context.newPage();
    await settingsPage.setViewportSize({ width: 1280, height: 820 });
    await settingsPage.goto(`chrome-extension://${extId}/options.html`, {
      waitUntil: 'networkidle',
      timeout: 15000,
    });
    // Wait for the rule rows to render so the grab isn't empty.
    await settingsPage
      .waitForSelector('#close-user-list .rule-row, #close-user-list [data-rule-id]', {
        timeout: 5000,
      })
      .catch(() => console.warn('[screenshots:settings] rule rows never appeared — proceeding'));
    await settingsPage.waitForTimeout(600);
    await captureRetina(
      settingsPage,
      1280,
      820,
      { width: 1280, height: 820 },
      path.join(ASSETS_DIR, 'settings.png'),
      'settings'
    );
    await settingsPage.close();
  } finally {
    await context.close();
  }
}

async function main() {
  if (!existsSync(path.join(REPO_ROOT, 'manifest.json'))) {
    throw new Error(`[screenshots] manifest.json not found in ${REPO_ROOT}`);
  }
  await fs.mkdir(ASSETS_DIR, { recursive: true });

  console.log(`[screenshots] starting HTTP server on 127.0.0.1:${PORT}`);
  const server = await startServer();

  try {
    await captureTemplates();
    await captureCwsTemplates();
    await captureExtension();
  } finally {
    server.close();
  }
  console.log('[screenshots] done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
