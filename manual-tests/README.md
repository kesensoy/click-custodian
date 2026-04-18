# Manual Testing Guide

## Setup

1. **Load Extension:**
   - Open Chrome
   - Go to `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `click-custodian` directory
   - Note the extension ID

2. **Open Service Worker Console:**
   - Find "Click Custodian" in the extensions list
   - Click "service worker" link (appears when extension is active)
   - This opens the background console for debug logs

## Test Scenarios

### 1. Button Only Rule
**File:** `test-button-only.html`

**Setup:** Need to add a temporary user rule:
1. Right-click extension icon → Options
2. Add Button Click Rule:
   - Name: "Test Button Only"
   - URL Pattern: `file://*/manual-tests/test-button-only.html`
   - Match Type: glob
   - Selector: `button`
   - Button Text: "Sign In"
   - Delay: 200

**Test:**
- Open `test-button-only.html` in Chrome
- **Expected:** Green highlight appears on button, button clicks automatically
- **Verify:** "Button was clicked!" text appears in green

### 2. Close Only Rule
**File:** `test-close-only.html`

**Setup:** Need to serve on 127.0.0.1 to match default rule:
```bash
cd manual-tests
python3 -m http.server 8080 --bind 127.0.0.1
```

**Test:**
- Navigate to `http://127.0.0.1:8080/test-close-only.html?oauth/callback=test`
- **Expected:** Countdown overlay appears immediately
- **Verify:** Tab closes after countdown completes
- **Service Worker Logs:** Should see debug messages about close rule match

### 3. No Rules Match
**File:** `test-no-rules.html`

**Test:**
- Open `test-no-rules.html` in Chrome
- **Expected:** Nothing happens
- **Verify:** No countdown, no button clicks, no console activity

### 4. Conflict - Button Present
**File:** `test-conflict-button-present.html`

**Setup:** Need both rules to match. Two options:

**Option A:** Add user rules for both:
1. Button rule matching `file://*/test-conflict-button-present.html`
2. Close rule matching same pattern

**Option B:** Serve on a custom hostname matching your rule's URL pattern:
- Modify `/etc/hosts`: `127.0.0.1 sso.example.com`
- Serve with HTTPS (complex)

**Recommended:** Use Option A (temporary user rules)

**Test:**
- Open `test-conflict-button-present.html`
- **Expected:** Button clicks (green highlight), NO countdown
- **Service Worker Logs:**
  - "Conflict detected"
  - "Sending checkButtonExists message"
  - "Button search complete, found: true"

### 5. Conflict - Button Absent
**File:** `test-conflict-button-absent.html`

**Setup:** Same as #4 (need both rules matching)

**Test:**
- Open `test-conflict-button-absent.html`
- **Expected:**
  1. Wait ~3 seconds (polling period)
  2. Countdown overlay appears
  3. Tab closes after countdown
- **Service Worker Logs:**
  - "Conflict detected"
  - "Sending checkButtonExists message"
  - "Button search complete, found: false"
  - "Starting countdown for close rule"

### 6. Countdown Cancellation - Escape Key
**Use:** Any close-only test (e.g., test-close-only.html)

**Test:**
- Navigate to page that triggers countdown
- When countdown appears, press **Escape**
- **Expected:** Countdown overlay disappears, tab stays open

### 7. Countdown Cancellation - Cancel Button
**Use:** Any close-only test (e.g., test-close-only.html)

**Test:**
- Navigate to page that triggers countdown
- Click "Cancel" button in countdown overlay
- **Expected:** Countdown overlay disappears, tab stays open

## Verification Checklist

For each test, verify:

- [ ] Countdown has `data-click-custodian-countdown="true"` attribute (inspect element)
- [ ] Button highlights have `.click-custodian-highlight` class (inspect element)
- [ ] Clicked buttons have `data-clicked="true"` attribute
- [ ] Service worker console shows expected debug messages
- [ ] Timing is correct (3s polling for conflict, configured delay for countdown)

## Expected Console Messages

**Button Click:**
```
[Content Script] Looking for button with selector: button
[Content Script] Button found! Highlighting and clicking after 200ms
[Content Script] Clicked button
```

**Tab Close:**
```
[Background] Detected tab close rule: <rule-name>
[Background] Starting countdown: <delay>ms
```

**Conflict Resolution:**
```
[Background] Conflict detected - both button and close rules match
[Background] Sending checkButtonExists message to content script
[Content Script] Checking if button exists...
[Content Script] Button search complete, found: true/false
[Background] Received buttonCheckResult: found=<true/false>
```

## Cleanup

After testing, remove temporary user rules:
1. Right-click extension icon → Options
2. Delete test rules you added
3. Keep only real default rules

## Success Criteria

**If ALL manual tests pass:**
- ✅ Implementation is working correctly
- ✅ Test infrastructure is the problem (teardown timeouts)
- ✅ Next step: Fix test cleanup logic

**If ANY manual tests fail:**
- ❌ Implementation needs more debugging
- ❌ Check service worker console for errors
- ❌ Review code changes in recent commits
