# Screenshot generation

Regenerates the committed PNGs in `../../assets/` that the project README and store listings point at.

## Run

```bash
npm run screenshots
```

Playwright is already a `devDependency` via the e2e suite, so no extra install is needed on a fresh clone.

## What gets written

All outputs land in `assets/`:

The pipeline produces two tiers of assets, modeled on the sister project in `../../../sneetches/assets`:

### README / GitHub assets (retina @ DSF=2)

Captured at logical dimensions then rendered at 2× for retina sharpness, so they stay crisp when the README scales them down via `width="…"`.

| File             | Source                      | Purpose                                                                 |
| ---------------- | --------------------------- | ----------------------------------------------------------------------- |
| `hero.png`       | `hero.html`                 | GitHub social preview / README header — logical 1280×640 (physical 2560×1280) |
| `comparison.png` | `comparison.html`           | Narrower before/after panel for inline README use                        |
| `overlay.png`    | `overlay.html`              | The real countdown overlay layered on a mock host page                   |
| `highlight.png`  | `highlight.html`            | The green button-highlight indicator on a mock SSO page                  |
| `popup.png`      | live `popup.html`           | Real extension popup, cropped to body bbox                               |
| `settings.png`   | live `options.html`         | Real extension settings page with a seeded rule set                      |

### Chrome Web Store listing assets (exact canvas @ DSF=1, 24-bit PNG)

Captured at exact physical dimensions required by the CWS listing page, then re-encoded to strip the alpha channel (CWS rejects 32-bit RGBA PNGs).

| File                    | Source                          | CWS slot          | Size      |
| ----------------------- | ------------------------------- | ----------------- | --------- |
| `cws-screenshot.png`    | `cws-screenshot.html`           | Store screenshot  | 1280×800  |
| `cws-promo-small.png`   | `cws-promo-small.html`          | Small promo tile  | 440×280   |
| `cws-promo-marquee.png` | `cws-promo-marquee.html`        | Marquee promo     | 1400×560  |

## How it works

- `capture.mjs` spins up a tiny HTTP server on `127.0.0.1:8766` rooted at the repo. This lets `overlay.html` reference the real `/content.css` — so that screenshot shows the same overlay styling the extension ships. Port is hardcoded; if `8766` is already in use, change `PORT` in `capture.mjs`.
- **README templates** render in a plain Chromium context with `deviceScaleFactor: 2`. `captureTemplates()` awaits `document.fonts.ready` so webfont-styled templates (overlay, highlight — Inter / Fraunces) don't screenshot a system-font fallback frame.
- **CWS templates** render in a second plain context at `deviceScaleFactor: 1` (exact canvas size), then `captureCwsTemplates()` pipes the screenshot through `sips -s format png` to produce a 24-bit PNG without alpha. **macOS-only** (sips is built in); port to `sharp` or ImageMagick if you need cross-platform.
- **Live popup/settings** captures launch a persistent Chromium context with the unpacked extension loaded. Because `page.setViewportSize()` resets the device-scale-factor to 1 in Playwright, retina-sharp output for these pages is produced by driving the capture directly over CDP (`Emulation.setDeviceMetricsOverride` with `deviceScaleFactor: 2` + `Page.captureScreenshot`). The profile dir (`.screenshot-profile/`) is wiped before every run.
- The seeded rules are built from `seed-examples.json` (so the screenshots track what fresh installs actually see) plus a couple of extras to exercise varied UI states (one disabled close rule, two demo click rules). Storage is written directly; this bypasses `background.js`'s `onInstalled` seeder, so regressions in the seeder path itself won't surface here — run the extension manually to exercise that.

## Editing

- To change the hero/comparison wording or any CWS promo content: edit the corresponding `.html` template. Dark-mode brand palette (`#0B1426` bg, `#9FCBED` accent) is wired in across all of them.
- To change what rules the popup/settings show: edit `seed-examples.json` (for the shipped ones) or the extras inside `loadSeedRules()` in `capture.mjs`.
- To change output sizes: edit the relevant entry in `TEMPLATES` / `CWS_TEMPLATES`, or the viewport values inside `captureExtension()`.
