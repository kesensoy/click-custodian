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
- **All rules are yours** — One flat list, every rule fully editable. Fresh installs get a small example seed to edit, replace, or delete.
- **Pattern matching** — `glob`, `regex`, `exact`, or `contains`.
- **Import / Export** — Share rule sets or back them up as JSON.
- **Visual feedback** — Green highlight confirms a button was found before it's clicked.

## Installation

```bash
git clone git@github.com:kesensoy/click-custodian.git
```

Then in Chrome:
1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the cloned folder

On fresh install, the extension seeds two example tab-close rules so you can see the shape of things. Click the extension icon → **Open Settings** to edit, delete, or add your own.

## Seed Examples

Fresh installs come with these examples pre-loaded. Edit or delete them like any other rule — they're not special.

- **Localhost OAuth callback** — `*://localhost:*/*callback*` (glob, tab close)
- **Azure AD device code approval** — `https://login.microsoftonline.com/appverify` (exact, tab close)

The seed is defined in `seed-examples.json` and only runs on first install. Updates never touch your rules.

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

All rules live in a single flat list on the Settings page. Every rule has the same card — toggle, edit, delete. There is no separate "built-in" tier; the examples you see on a fresh install are ordinary rules seeded once.

### Export / Import

The sticky action bar on the Settings page has **Import**, **Export**, and **Reset to defaults**.

- **Export** downloads `click-custodian-rules-YYYY-MM-DD.json` containing your full rule list.
- **Import** opens a dialog with two modes:
  - **Merge** appends the imported rules to your existing list (imported rules get fresh IDs to avoid collisions).
  - **Replace all my rules** wipes your current rules and loads the imported file (destructive; confirm-gated).
- **Reset to defaults** wipes your current rules and re-seeds from `seed-examples.json` (destructive).

Use Export/Import to sync between machines or share a rule set.

### Changing the Seed (for forks)

Edit `seed-examples.json` and reload the extension. The seed only runs on fresh install, so existing users won't see the change — use **Reset to defaults** to re-seed an installed copy during development.

## Architecture

```
background.js (service worker)
├─ Seeds from seed-examples.json on fresh install
├─ Migrates legacy two-tier shape on update (one-time)
├─ Monitors chrome.tabs.onUpdated
├─ Matches URLs against the flat rule list
├─ Handles conflicts when both a close and click rule match
├─ Injects countdown for tab close
└─ Sends messages to content.js for button clicks

content.js (content script)
├─ Receives button click messages
├─ Uses waitForElement() to poll for button (max 3s)
├─ Shows green highlight when found
└─ Clicks after configured delay

options.js (settings UI)
├─ Renders the flat rule list (all editable)
├─ Import / Export / Reset to defaults
└─ Saves to Chrome sync storage
```

## Storage Schema

```javascript
chrome.storage.sync = {
  tabCloseRules: [...],     // All tab-close rules (user-owned)
  buttonClickRules: [...]   // All button-click rules (user-owned)
}
```

Each rule carries its own `enabled` flag — toggling a rule in the UI flips the flag on the rule object, not a separate map.

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
