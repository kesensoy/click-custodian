# Click Custodian - AI Assistant Reference

## Project Purpose
Chrome extension that auto-closes confirmation tabs and auto-clicks repetitive buttons for workflow automation.

## Architecture

### Two-Tier Rules System
- **Default Rules**: Stored in `defaults.json`, auto-update when extension updates
- **User Rules**: Custom rules, never touched by updates
- Storage keeps them completely separate

### Storage Structure
```javascript
{
  defaultRules: {              // From defaults.json
    version: "1.0",
    tabCloseRules: [...],
    buttonClickRules: [...]
  },
  userRules: {                 // User's custom rules
    tabCloseRules: [...],
    buttonClickRules: [...]
  },
  defaultRulesEnabled: {       // Per-user enable/disable state
    "rule-id": true/false
  },
  defaultsVersion: "1.0"
}
```

### File Structure
```
click-custodian/
├── manifest.json       # Chrome Extension Manifest V3
├── defaults.json       # Default rules (edit this to add new defaults)
├── background.js       # Service worker - monitors tabs, loads defaults
├── content.js         # Smart polling, button clicking
├── content.css        # Countdown overlay styles
├── options.html/css/js # Two-tier settings UI
└── popup.html/js      # Extension popup
```

## Key Components

### Background Service Worker (`background.js`)
- Loads `defaults.json` on install/update via `loadDefaultRules()`
- Version checking: updates defaults when version changes
- Monitors tabs: `chrome.tabs.onUpdated`
- Combines default + user rules when matching URLs
- Injects countdown overlay for tab close
- Sends messages to content script for button clicks

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
**Two-Tier Display:**
- Default rules: Light blue background, read-only fields, toggle only, 📌 icon
- User rules: Gray background, fully editable, delete button
- Saves: `userRules` + `defaultRulesEnabled` to Chrome storage

## Rule Schema

### Tab Close Rule
```javascript
{
  id: string,         // Unique identifier
  name: string,       // Display name
  urlPattern: string, // Pattern to match
  matchType: string,  // 'glob' | 'regex' | 'exact' | 'contains'
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
  delay: number      // Wait time AFTER finding button (not search time)
}
```

## Current Default Rules

**All defaults enabled by default:**

**Tab Close Rules:**
1. AWS CLI OAuth Callback: `*://127.0.0.1:*/oauth/callback*` (glob, 3s delay)
2. Azure App Verify: `https://login.microsoftonline.com/appverify` (exact, 3s delay)
3. Generic Localhost OAuth Callback: `*://localhost:*/callback?code=*` (glob, 3s delay)

**Button Click Rules:**
(none shipped by default — users add their own)

## Pattern Matching

**Glob:** `*` wildcard (e.g., `*://example.com/*`)
**Regex:** JavaScript regex
**Exact:** String equality
**Contains:** Substring match

Implementation in `background.js:matchesPattern()`

## Adding New Default Rules

1. Edit `defaults.json`
2. Add rule to appropriate array (`tabCloseRules` or `buttonClickRules`)
3. Bump `version` field in `defaults.json`
4. **CRITICAL:** Bump `version` field in `manifest.json` to match
5. Extension will auto-update defaults on reload

**Why both versions?**
- Chrome uses `manifest.json` version to detect extension updates
- `defaults.json` version triggers defaults refresh in storage
- Both must be bumped or extension won't reload properly

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

## UI Styling

**Default Rules (`.rule-card-default`):**
- Background: `#e3f2fd` (light blue)
- Border: `#90caf9`
- Read-only fields with monospace font
- Only toggle switch, no edit/delete buttons

**Custom Rules (`.rule-card`):**
- Background: `#f8f9fa` (light gray)
- Border: `#e9ecef`
- Fully editable inputs
- Toggle + Delete buttons

## Important Notes

- Default rules stored in `defaults.json` (not hardcoded in JS)
- User rules completely separate from defaults
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
- If defaults won't update: Bump `defaults.json` version
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
| Rules not triggering | Rule disabled or version mismatch | Check storage in service worker console |
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
// Verify defaultRules.version matches defaults.json
```

**Content Script Injection Check:**
```javascript
// In page console:
console.log('Content script loaded:', !!chrome.runtime?.id)
```
