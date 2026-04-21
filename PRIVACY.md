# Privacy Policy

**Click Custodian** is an open-source browser extension that auto-closes confirmation tabs and auto-clicks repetitive buttons based on URL patterns you define.

## Data Collection

Click Custodian stores the following data **locally on your device** in your browser's synced storage (`chrome.storage.sync`), which the browser may replicate across devices signed into the same browser profile:

- **Automation rules** (`tabCloseRules`, `buttonClickRules`): The URL patterns, CSS selectors, button-text filters, delays, names, and enabled/disabled state for every rule you create.
- **Theme preference** (`theme`): `light`, `dark`, or `auto`.
- **Palette preference** (`palette`): `navy`, `moss`, `graphite`, or `ember`.
- **"Star us?" state** (`hasStarred`): A boolean indicating whether you have starred the `github.com/kesensoy/click-custodian` repository. This is detected by reading the GitHub page's DOM in your existing browser session — no data is sent anywhere.

A short-lived in-memory `Set` (in the background service worker) tracks recently-processed `tabId/URL` combinations for up to 5 seconds to prevent duplicate event handling on hash-routed single-page apps. This is not persisted to disk and is cleared automatically.

## Data Sharing

Click Custodian does **not**:

- Send your rules, preferences, or any user-generated data to any server
- Use analytics, telemetry, advertising, or tracking of any kind
- Read, store, or transmit the content of pages you visit (except for the limited DOM read on `github.com/kesensoy/click-custodian` to detect star state, which never leaves your device)

The extension's URL pattern matching runs entirely inside your browser. The countdown overlay and button-click logic operate on the live page DOM and produce no external signals.

### Third-party requests

The popup and settings pages load typography (Fraunces, Inter, JetBrains Mono) from **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`). These requests are initiated by the browser when the popup or settings page is opened and may transmit your IP address and User-Agent to Google as part of standard HTTP. Google's privacy policy applies to these requests. Click Custodian itself does not log, store, or process any of this information.

If you prefer no third-party requests at all, this is a known follow-up: the fonts can be self-bundled in a future release. Track or contribute at the [GitHub repository](https://github.com/kesensoy/click-custodian).

## Permissions

Click Custodian requests the following Chrome / Firefox extension permissions:

- **`tabs`**: To detect when a tab finishes loading so URL-pattern matching can run against the new URL. The extension reads tab URLs only to compare them against your rules.
- **`storage`**: To persist your rules and preferences as described above.
- **`activeTab`**: Used by the "Test on Current Tab" button in the popup to check the active tab against your rules without triggering automation.
- **`scripting`**: To inject the countdown overlay into matching tabs before they auto-close, so you can press Esc to cancel.
- **`<all_urls>` (host permission)**: Because rules can target arbitrary domains (OAuth callbacks, SSO pages, internal tools), the extension cannot know in advance which URLs will need to be matched.

## Open Source

Click Custodian is fully open source. You can review the complete source code at [github.com/kesensoy/click-custodian](https://github.com/kesensoy/click-custodian).

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/kesensoy/click-custodian/issues).
