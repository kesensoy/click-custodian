# Click Custodian - AI Assistant Reference

## Project Purpose
Chrome extension that auto-closes confirmation tabs and auto-clicks repetitive buttons for workflow automation.

## Architecture

### Single-Tier Rules
- All rules are user-owned and fully editable.
- Fresh installs seed from `seed-examples.json` (bundled with extension); updates never touch storage.
- Import/export provides the mechanism for sharing rule sets.

### Storage Structure
```javascript
{
  tabCloseRules: [...],
  buttonClickRules: [...]
}
```

### File Structure
```
click-custodian/
├── manifest.json        # Chrome Extension Manifest V3
├── seed-examples.json   # First-install seed (bundled in extension)
├── background.js        # Service worker - monitors tabs, seeds on install
├── content.js           # Smart polling + button clicking + GH star detection
├── content.css          # Countdown overlay styles (palette-aware)
├── theme-init.js        # Synchronous flash-prevention for theme + palette
├── fonts.css            # @font-face declarations for the bundled fonts
├── fonts/               # Bundled variable woff2 + sources/hashes README
├── options.html/css/js  # Settings UI (rules, palette/theme picker, JSON editor)
└── popup.html/css/js    # Extension popup (stats + actions + Star CTA)
```

**Fonts:** The popup and settings pages load three variable woff2 files
(`Inter`, `Fraunces`, `JetBrains Mono`) from the bundled `fonts/`
directory via `fonts.css`. The countdown overlay (`content.css`)
intentionally does NOT load these — it relies on system-font fallbacks
to avoid injecting `@font-face` rules into every page the user visits.
See `fonts/README.md` for sources, versions, hashes, and update guidance.

## Key Components

### Background Service Worker (`background.js`)
- On fresh install: seeds from `seed-examples.json` via `chrome.runtime.onInstalled` (`reason === 'install'`).
- On extension update: runs one-shot legacy-shape migration if `defaultRules`/`userRules` keys exist; otherwise untouched.
- Monitors tabs via `chrome.tabs.onUpdated`.
- Reads flat `tabCloseRules` / `buttonClickRules` arrays when matching URLs.
- Injects countdown overlay for tab close; sends messages to content script for button clicks.

### Content Script (`content.js`)
**Smart Button Polling:**
- Uses `waitForElement(selector, 3000)` with MutationObserver
- Searches for button up to 3 seconds
- Shows green highlight immediately when found
- Waits `rule.delay` ms (default 200ms) then clicks

**Flow:**
```
Page complete → Poll for button (max 3s) → Found? → Green highlight → Wait rule.delay → Click
```

**GitHub Star Detection (`detectRepoStar()` IIFE at top of file):**
- Runs on every page load (content.js is `<all_urls>`); cheap hostname + pathname guard bails out before any DOM work elsewhere.
- On `github.com/kesensoy/click-custodian/*`, polls for the `/unstar` form (up to ~3s) — its presence means the visitor has starred.
- One-way write: only sets `hasStarred=true` in `chrome.storage.sync`. Un-starring does NOT revoke the popup's "Thanks!" state (intentional — see Star CTA section).

### Options Page (`options.js`)
**Single Rule List:**
- All rules render as editable rows with toggle + delete.
- Import/Export buttons in the sticky action bar support rule-set sharing.
- "Reset to defaults" button replaces the current rules with the bundled seed.
- Import dialog offers Replace (destructive, confirm-gated) or Merge (re-IDs imported rules).

**JSON Editor View:**
- Toggle between Form (default) and JSON view via the view switch in the action bar.
- JSON view exposes the raw `tabCloseRules` / `buttonClickRules` payload for power-user edits.
- Save validates structure before writing back to storage; invalid JSON keeps the previous state.

**Theme + Palette Picker:**
- Theme: Light / Dark / Auto (Auto follows `prefers-color-scheme`).
- Palette: Navy (default) / Moss / Graphite / Ember.
- Selection persists in `chrome.storage.sync` (`theme`, `palette` keys) and mirrors to `localStorage` for flash-free reload (see Theming).

### Popup (`popup.html/js`)
- Stats card: "enabled / total" per rule type, tinted with `--warn` when any rule of that type is disabled.
- Open Settings + Test on Current Tab actions.
- Star CTA (top-right of brand row): see Star CTA section below.
- Status footer: pulsing dot, transient success/error/warning/info messages auto-revert after 5s.

## Rule Schema

### Tab Close Rule
```javascript
{
  id: string,         // Unique identifier
  name: string,       // Display name
  urlPattern: string, // Pattern to match
  matchType: string,  // 'glob' | 'regex' | 'exact' | 'contains'
  enabled: boolean,   // Whether rule is active (defaults to true; false disables without deleting)
  delay: number      // Countdown duration in ms
}
```

### Button Click Rule
```javascript
{
  id: string,         // Unique identifier
  name: string,       // Display name
  urlPattern: string, // Pattern to match
  matchType: string,  // 'glob' | 'regex' | 'exact' | 'contains'
  selector: string,   // CSS selector
  buttonText: string, // Optional text filter
  enabled: boolean,   // Whether rule is active (defaults to true; false disables without deleting)
  delay: number      // Wait time AFTER finding button (not search time)
}
```

## Seed Example Rules

Bundled in `seed-examples.json`, loaded once on first install:

**Tab Close Rules:**
1. Localhost OAuth callback: `*://localhost:*/*callback*` (glob, 3s delay)
2. Azure AD device code approval: `https://login.microsoftonline.com/appverify` (exact, 3s delay)
3. AWS CLI OAuth Callback: `*://127.0.0.1:*/oauth/callback*` (glob, 3s delay)

**Button Click Rules:**
(none shipped — users add their own)

Users can delete seeded rules at any time; they are not restored on update. The "Reset to defaults" button reloads the seed destructively.

## Theming

### Theme (light/dark/auto)
- Stored as `theme` in `chrome.storage.sync`. Resolved value (`light`|`dark`) is applied to `<html data-theme="...">`.
- `theme-init.js` is a synchronous script loaded in `<head>` BEFORE the stylesheet to prevent a flash of wrong colors. It reads `localStorage` (mirror of the sync value) since `chrome.storage` is async; the popup/options scripts re-sync from `chrome.storage` after load and update both attribute and localStorage if they drift.
- The `prefers-color-scheme` media query feeds the resolution when the stored value is `auto` (or absent).

### Palettes
Four palettes live as CSS custom-property blocks: `navy` (default — bare `:root`), `moss`, `graphite`, `ember`. Each defines both light and dark variants:

```css
[data-palette="moss"] { --navy:...; --cornflower:...; --cream:...; ... }
[data-palette="moss"][data-theme="dark"] { /* dark overrides */ }
```

The default palette is implied by absence of the `data-palette` attribute. The countdown overlay uses parallel `[data-cc-palette="..."]` blocks in `content.css` (separate prefix to avoid clobbering host-page tokens).

### Adding a Palette
The palette name appears in **six** places — keep them in sync (the regression test in `tests/unit/palette-tokens.test.js` enforces this):
1. `popup.css` — light + dark blocks
2. `options.css` — light + dark blocks + `.pop-row[data-pal="..."] .sw { background:...; }` swatch
3. `content.css` — overlay light + dark blocks (using `--cc-` prefix)
4. `options.html` — `<button data-pal="..."` row in the picker dropdown
5. `options.js`, `popup.js` — `VALID_PALETTES` / inline `valid` array
6. `theme-init.js` — flash-prevention allowlist (inline OR-chain)

## Star CTA

**Popup widget (top-right of brand row):**
- Default state: small outline star icon, hover reveals "Star us?" tooltip-style text.
- Click in default state: opens `https://github.com/kesensoy/click-custodian` in a new tab; popup closes naturally.
- After the user actually stars the repo, `content.js:detectRepoStar()` writes `hasStarred=true` (see Content Script section).
- On next popup open, hydrate adds `.starred` to the CTA: gold color, "Thanks!" label.
- Click in starred state: `preventDefault()` stops navigation, icon spins as click feedback. The widget becomes a pure affirmation; users can't accidentally land on a repo state that disagrees with the popup.

**Why one-way:** un-starring should not flip the popup back to "Star us?" — that would feel punishing and the user already earned the thanks.

**Known limitation:** detection runs once per page load with a brief retry window for late-rendered headers. Starring the repo via in-page (turbo) navigation without a full reload won't flip the popup until the next time GitHub loads the repo page fresh. Acceptable for now since the natural flow is "click → new tab → star → close tab" anyway.

## Pattern Matching

**Glob:** `*` wildcard (e.g., `*://example.com/*`)
**Regex:** JavaScript regex
**Exact:** String equality
**Contains:** Substring match

Implementation in `background.js:matchesPattern()`

## Editing the Seed

If you want to change what fresh installs get:
1. Edit `seed-examples.json`.
2. Bump `manifest.json` version so the extension reloads.

The seed is not re-applied on update; only fresh installs see changes. Existing users need to click "Reset to defaults" to pick up new seed content.

## Key Behaviors

**Tab Close:**
- Countdown overlay injected into page
- Shows "This tab will close in X seconds"
- Button: "Cancel (Esc)"
- Press Esc or click button to abort

**Button Click:**
- Max 3s to find button (MutationObserver)
- Green highlight when found
- Configured delay, then click
- Logs to console for debugging

## Duplicate Event Prevention

**Issue:** Chrome fires multiple `chrome.tabs.onUpdated` events with `status: 'complete'` for the same page load in hash-routed SPAs.

**Solution:** Background service worker tracks processed tab/URL combinations in a Set:
- Creates unique key: `${tabId}-${tab.url}`
- Skips processing if key already in Set
- Auto-cleanup after 5 seconds (prevents memory leaks)
- Emergency cleanup at 100 entries (defensive programming)

**Why needed:** On hash-routed SPAs (common in OAuth approval flows), duplicate events cause the same button to be clicked twice, which can trigger backend errors on the second click.

**Code location:** `background.js:3-14` (tracking data structure), `background.js:71-95` (duplicate check)

## Important Notes

- Seed example rules live in `seed-examples.json` (bundled with the extension; only applied on fresh install)
- All rules are user-owned once installed; updates do not touch storage
- `rule.delay` means different things:
  - Tab close: countdown duration
  - Button click: wait time AFTER finding button
- Smart polling uses existing `waitForElement()` helper
- All user data in Chrome sync storage (syncs across devices)

## Development Workflow

### Initial Load
1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select project directory: `/path/to/click-custodian`

### Reloading After Changes

**Quick Reload (for most changes):**
1. `chrome://extensions/` → Click refresh icon on extension
2. Close and reopen test tabs (content scripts are cached in pages)

**Nuclear Reload (if stuck on old version):**
1. Remove extension completely (not just disable)
2. Click "Load unpacked" again
3. Verify version number matches your manifest.json

**Version Stuck Issues:**
- If version won't update: Bump `manifest.json` version
- Chrome caches aggressively - full remove/reload may be needed

### Debugging

**Background Service Worker Logs:**
1. `chrome://extensions/` → Click "service worker" link
2. Look for: `[DEBUG]` prefixed messages
3. Check for rule matching: `"Close rule check:"` and `"Button rule check:"`

**Content Script Logs:**
1. Open test page → F12 → Console tab
2. Look for: `"[DEBUG] Click Custodian content script loaded"`
3. Button polling: `"Button found!"` or `"Button not found"`

**Common Issues:**

| Issue | Cause | Solution |
|-------|-------|----------|
| Green square, no click | Old content script cached | Close and reopen test tab |
| Wrong version showing | Chrome cache | Remove extension, reload unpacked |
| Rules not triggering | Rule disabled or pattern mismatch | Check storage in service worker console |
| Button not found | Selector or timing issue | Check content script console for polling logs |

### Testing

**Unit tests (Jest + jsdom):** `npm run test:unit`
- Source files don't export functions, so unit tests copy the function under test into the test file (see `tests/unit/pattern-matching.test.js` for the canonical pattern).
- `tests/unit/palette-tokens.test.js` is a regression test that enforces palette-name agreement across all six surfaces — run it after any palette add/rename/remove.
- `tests/unit/star-detection.test.js` covers the GitHub star form selector and the URL guard predicates.

**E2E (Playwright):** `npm run test:e2e`

**Manual Testing:**
1. Load extension (see above)
2. Open test URL matching a rule
3. Verify behavior (countdown or button click)

**Service Worker Storage Check:**
```javascript
// In service worker console:
chrome.storage.sync.get(null, (data) => console.log(data))
// Verify tabCloseRules / buttonClickRules arrays look correct
```

**Content Script Injection Check:**
```javascript
// In page console:
console.log('Content script loaded:', !!chrome.runtime?.id)
```
