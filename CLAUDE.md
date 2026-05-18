# Click Custodian - AI Assistant Reference

## Project Purpose
Browser extension that auto-closes confirmation tabs and auto-clicks repetitive buttons for workflow automation.

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
- On `github.com/kesensoy/click-custodian/*`, inspects which of the `/star` and `/unstar` forms is the *visibly rendered* one (GitHub renders both with display:none toggling — verified live 2026-04-20). Up to ~3s of polling for late-rendered headers.
- **Bidirectional write:** sets `hasStarred=true` when the unstar form is visible, `hasStarred=false` when the star form is visible. Logged-out visitors (neither form rendered) are left alone — we don't punish someone with stale state for being signed out.
- Re-runs on Hotwire `turbo:load` so in-page navigation between repo subpages and in-place star/unstar clicks update storage without a full reload.

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

**Bidirectional `hasStarred`:** if the user un-stars the repo on GitHub, the next time content.js sees the page (page load OR `turbo:load`) it writes `hasStarred=false` and the next popup open reverts to "Star us?". This is the honest signal. Logged-out visits don't flip the flag — only an explicit star/unstar form being visibly rendered does.

**Toolbar icon swap:** when `hasStarred=true` AND the user has chosen a non-navy palette (moss/graphite/ember), `background.js:applyIconForCurrentState()` calls `chrome.action.setIcon()` to swap to the palette-tinted icon set. Navy palette OR not-starred always shows the default brand icon. The swap re-fires on `chrome.storage.onChanged` for either the `palette` or `hasStarred` key, plus on every service-worker boot. PNG sources live in `icons/icon{16,48,128}-{moss,graphite,ember}.png`; regenerate via `bash scripts/render-icons.sh` after editing the source SVGs.

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
- Triggered on full page load AND on in-page URL changes (e.g., when a page rewrites its URL via `history.replaceState` post-load)

**Button Click:**
- Max 3s to find button (MutationObserver)
- Green highlight when found
- Configured delay, then click
- Logs to console for debugging
- Triggered on full page load AND on in-page URL changes

## Event Handling and Duplicate Prevention

**The listener processes two kinds of `chrome.tabs.onUpdated` events:**

1. **Load-complete:** `changeInfo.status === 'complete'`. The classic "page finished loading" signal.
2. **In-page URL change:** `changeInfo.url` is set, status is not `'loading'` and not `'complete'`. This is what Chrome reports when JS calls `history.pushState` or `history.replaceState` — required for SPAs that rewrite their URL after load (e.g., OAuth-style flows that strip query parameters post-approval).

Events with `status === 'loading'` are ignored — a fresh navigation will produce a `'complete'` shortly, and processing both would double-fire.

**Two layers of duplicate prevention:**

- **Per-URL dedup Set (`processedTabs`):** keys are `${tabId}-${url}` (using `changeInfo.url` for in-page events, `tab.url` otherwise). The same URL won't be processed twice for the same tab within `TAB_TRACKING_TIMEOUT` (5s). Auto-cleaned after the timeout; emergency-cleared at `MAX_TRACKED_TABS` (100).

- **Per-tab post-load cooldown (`POST_LOAD_QUIET_MS`, 1.5s):** the cooldown is **only engaged when a rule actually fires on the load-complete event**. When engaged, an in-page URL change that arrives within the window is suppressed. This prevents permissive patterns (e.g., a `contains` rule that matches both the dirty and rewritten URL forms) from firing twice across one user-visible navigation. Without the rule-fired condition, an exact-match rule that matches only the cleaned post-rewrite URL would never trigger — the dirty load would set the cooldown without firing anything, then suppress the in-page event that should have fired. A rule with `enabled: false` does not count as "firing" — disabled rules never engage the cooldown. A subsequent load-complete on the same tab that matches no rule clears any stale cooldown left over from a previous page, so a SPA event on the new page isn't suppressed by an inherited window. In conflict mode (close + button rules both match), the cooldown is cleared **synchronously** when `buttonCheckResult.found === true` arrives — before the click message goes out — so the page's own post-click `history.replaceState` can re-evaluate even when `rule.delay < POST_CLICK_REEVAL_MS`.

Both `processedTabs` and `lastLoadCompleteAt` are in-memory state on the service worker. Manifest V3 service workers can be terminated when idle and restarted on demand; either or both maps reset on termination. This is acceptable: a fresh listener will see a fresh `'complete'` event for any active tab and re-derive its state.

`lastLoadCompleteAt` is cleared when a tab closes (via `chrome.tabs.onRemoved`).

**User-visible behavior:**

- Narrow `exact` rules: behave the same as before for full loads, AND now correctly fire on URL rewrites that produce a match after the load completes (the canonical bug this fix addresses).
- Permissive `contains` / broad `glob` rules: the cooldown specifically covers the load-complete event plus any immediate post-load rewrite that arrives within `POST_LOAD_QUIET_MS`. In-page URL changes that arrive past the quiet window evaluate normally; per-URL dedup (`processedTabs`) still suppresses an exact-URL replay within `TAB_TRACKING_TIMEOUT`, but two SPA rewrites to *different* matching URLs more than the quiet window after the original load will each fire. This is intentional, so SPA-routed apps that match a broad pattern still work as the user navigates around inside them.

**Code location:** `background.js` (top-of-file constants for `processedTabs`, `lastLoadCompleteAt`, `POST_LOAD_QUIET_MS`); the `chrome.tabs.onUpdated.addListener` body (the trigger detection, dedup, rule matching, and rule-conditional cooldown set); the `chrome.tabs.onRemoved.addListener` for cleanup.

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
