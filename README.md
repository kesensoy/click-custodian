<table>
<tr>
<td style="background: white; padding: 10px; border-radius: 8px;"><img src="icons/clickCustodianLogo.png" width="100"></td>
<td>
<h1>Click Custodian</h1>
<p>Chrome extension that auto-closes confirmation tabs and auto-clicks repetitive buttons.</p>
</td>
</tr>
</table>

## What It Does

Browser workflows are full of meaningless clicks — OAuth callback tabs that sit around until you close them, "Continue" buttons on SSO pages you always click, confirmation screens that exist only to be dismissed. Click Custodian automates those away:

- **Tab Auto-Close** — Automatically closes matching tabs with a short countdown (press Esc to cancel).
- **Button Auto-Click** — Automatically finds and clicks buttons on matching pages using smart polling (`MutationObserver`, 3s max).
- **Two-tier rules** — Ships with a small set of universally useful defaults; you add your own custom rules on top.
- **Pattern matching** — `glob`, `regex`, `exact`, or `contains`.
- **Visual feedback** — Green highlight confirms a button was found before it's clicked.

## Installation

```bash
git clone git@github.com:kesensoy/click-custodian.git
```

Then in Chrome:
1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the cloned folder

The extension loads with default rules enabled. Click the extension icon → **Open Settings** to customize.

## Default Rules

Three generic rules ship enabled by default:

- **AWS CLI OAuth Callback** — `*://127.0.0.1:*/oauth/callback*` (tab close)
- **Microsoft Azure App Verify** — `https://login.microsoftonline.com/appverify` (tab close)
- **Generic Localhost OAuth Callback** — `*://localhost:*/callback?code=*` (tab close)

Disable any default you don't want in Settings. Add your own rules alongside them.

## Usage

### Tab Close Rules

Automatically close tabs whose URL matches a pattern, after a short countdown.

| Field | Description | Example |
|---|---|---|
| URL Pattern | Pattern to match | `*://127.0.0.1:*/oauth/callback*` |
| Match Type | `glob`, `regex`, `exact`, `contains` | `glob` |
| Delay | Countdown duration (ms) | `3000` |

Press **Esc** during the countdown to cancel.

### Button Click Rules

Automatically click a button on matching pages.

| Field | Description | Example |
|---|---|---|
| URL Pattern | Pattern to match | `*://sso.example.com/login*` |
| Match Type | `glob`, `regex`, `exact`, `contains` | `glob` |
| CSS Selector | Button selector | `button` |
| Button Text | Optional text filter | `Continue` |
| Delay | Wait time **after** finding button before clicking (ms) | `200` |

**How it works:**
1. Page loads → searches for button (up to 3s via `MutationObserver`)
2. Button found → green highlight shown immediately
3. After configured delay → button is clicked

## Configuration

### Two-Tier System

- **Default rules** (light blue card, 📌 icon) — Ship with the extension. You can toggle them on/off but not edit them. Update automatically when `defaults.json` version bumps.
- **Custom rules** (gray card) — Fully editable, fully yours. Never touched by extension updates.

### Export / Import

Settings page → **Export Config** downloads your custom rules and default-toggle state as JSON. **Import Config** loads them back. Use this to sync between machines or share a rule set.

### Adding to Defaults (for forks)

Edit `defaults.json`, bump its `version` field, and bump `manifest.json`'s `version` to match. Reload the extension. Existing user toggles are preserved; new defaults enable by default.

## Architecture

```
background.js (service worker)
├─ Loads defaults.json on install/update
├─ Monitors chrome.tabs.onUpdated
├─ Matches URLs against combined default + user rules
├─ Handles conflicts when both rule types match
├─ Injects countdown for tab close
└─ Sends messages to content.js for button clicks

content.js (content script)
├─ Receives button click messages
├─ Uses waitForElement() to poll for button (max 3s)
├─ Shows green highlight when found
└─ Clicks after configured delay

options.js (settings UI)
├─ Renders default rules (read-only, toggle only)
├─ Renders user rules (fully editable)
└─ Saves to Chrome sync storage
```

## Storage Schema

```javascript
chrome.storage.sync = {
  defaultRules: {          // From defaults.json
    version: "1.0.0",
    tabCloseRules: [...],
    buttonClickRules: [...]
  },
  userRules: {             // User's custom rules
    tabCloseRules: [...],
    buttonClickRules: [...]
  },
  defaultRulesEnabled: {   // Per-user toggles
    "rule-id": boolean
  },
  defaultsVersion: "1.0.0"
}
```

## Development

No build step. Vanilla JavaScript loaded directly.

**Tests:**
```bash
npm run test:unit       # Jest unit tests
npm run test:e2e        # Playwright end-to-end
npm run test:all        # Both
```

**Debugging:**
- Background worker: `chrome://extensions/` → click **service worker**
- Content scripts: DevTools → Console on the target page
- Look for `[DEBUG]` log prefixes

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Rules not triggering | Rule disabled, or cached content script | Check toggle state; close and reopen the test tab |
| Button never clicked | Wrong selector or wrong button text | Inspect the element; confirm selector and text |
| Extension stuck on old version | Chrome cache | Remove and re-load unpacked |
| Button found, never clicked | Content script cached from earlier install | Close and reopen the target tab |

## Contributing

Issues and pull requests welcome. For substantial changes, open an issue first so we can align on scope.

## Acknowledgments

Major contributions from:
- [@EthanJStark](https://github.com/EthanJStark) — core feature work, conflict resolution, testing
- [@n0n0x](https://github.com/n0n0x) — bug fixes and polish

## License

[MIT](LICENSE) © Kevin Esensoy
