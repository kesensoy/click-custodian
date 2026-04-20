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
├── manifest.json       # Chrome Extension Manifest V3
├── seed-examples.json   # First-install seed (bundled in extension)
├── background.js       # Service worker - monitors tabs, seeds on install
├── content.js         # Smart polling, button clicking
├── content.css        # Countdown overlay styles
├── options.html/css/js # Settings UI
└── popup.html/js      # Extension popup
```

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

### Options Page (`options.js`)
**Single Rule List:**
- All rules render as editable rows with toggle + delete.
- Import/Export buttons in the sticky action bar support rule-set sharing.
- "Reset to defaults" button replaces the current rules with the bundled seed.
- Import dialog offers Replace (destructive, confirm-gated) or Merge (re-IDs imported rules).

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

**Button Click Rules:**
(none shipped — users add their own)

Users can delete seeded rules at any time; they are not restored on update. The "Reset to defaults" button reloads the seed destructively.

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
