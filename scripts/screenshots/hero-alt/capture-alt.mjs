#!/usr/bin/env node
// One-off: renders the three hero candidates in this directory to
// ../../../assets/hero-alt/*.png. Not wired into `npm run screenshots`
// because these are explorations — once a winner is picked, move its
// template into ../hero.html and retire this script.
//
// Usage: node scripts/screenshots/hero-alt/capture-alt.mjs
import { chromium } from '@playwright/test';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ALT_DIR = path.dirname(__filename);
const REPO_ROOT = path.resolve(ALT_DIR, '..', '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'assets', 'hero-alt');

const OPTIONS = ['a', 'b', 'c'];

const browser = await chromium.launch({ headless: true });
try {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const id of OPTIONS) {
    const src = path.join(ALT_DIR, `option-${id}.html`);
    const out = path.join(OUT_DIR, `option-${id}.png`);
    console.log(`[hero-alt:${id}] capturing ${path.relative(REPO_ROOT, src)}`);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 640 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(`file://${src}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: 1280, height: 640 },
    });
    console.log(`[hero-alt:${id}] wrote ${path.relative(REPO_ROOT, out)}`);
    await context.close();
  }
} finally {
  await browser.close();
}
