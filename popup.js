// Popup script

document.addEventListener('DOMContentLoaded', async () => {
  await syncTheme();
  await loadStats();

  // Open settings
  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Test on current tab
  document.getElementById('test-current-tab').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { tabCloseRules = [], buttonClickRules = [] } = await chrome.storage.sync.get(['tabCloseRules', 'buttonClickRules']);

    // Check if tab matches any rules (enabled or disabled)
    const closeRuleMatch = tabCloseRules.find(rule =>
      matchesPattern(tab.url, rule.urlPattern, rule.matchType)
    );

    const clickRuleMatch = buttonClickRules.find(rule =>
      matchesPattern(tab.url, rule.urlPattern, rule.matchType)
    );

    if (closeRuleMatch) {
      const enabled = closeRuleMatch.enabled !== false;
      if (enabled) {
        setStatus(`Matches close rule: ${closeRuleMatch.name}`, 'success');
      } else {
        setStatus(`Matches close rule: ${closeRuleMatch.name} (DISABLED)`, 'warning');
      }
    } else if (clickRuleMatch) {
      const enabled = clickRuleMatch.enabled !== false;
      if (enabled) {
        setStatus(`Matches click rule: ${clickRuleMatch.name}`, 'success');
      } else {
        setStatus(`Matches click rule: ${clickRuleMatch.name} (DISABLED)`, 'warning');
      }
    } else {
      setStatus('No matching rules for this tab', 'info');
    }
  });
});

async function loadStats() {
  const { tabCloseRules = [], buttonClickRules = [] } = await chrome.storage.sync.get(['tabCloseRules', 'buttonClickRules']);

  const closeTotal = tabCloseRules.length;
  const closeEnabled = tabCloseRules.filter(r => r.enabled !== false).length;
  const clickTotal = buttonClickRules.length;
  const clickEnabled = buttonClickRules.filter(r => r.enabled !== false).length;

  renderRuleFraction('close-rules-count', closeEnabled, closeTotal);
  renderRuleFraction('click-rules-count', clickEnabled, clickTotal);
}

// Renders an "enabled / total" fraction into a .stat-value and flags the
// element with .has-disabled when any rule of that type is disabled, so
// popup.css can tint it with --warn as a subtle at-a-glance signal.
function renderRuleFraction(elementId, enabled, total) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = `${enabled} / ${total}`;
  el.classList.toggle('has-disabled', enabled < total);
}

function matchesPattern(url, pattern, matchType) {
  if (!url) return false;

  switch (matchType) {
    case 'glob':
      return globMatch(url, pattern);
    case 'regex':
      try {
        const regex = new RegExp(pattern);
        return regex.test(url);
      } catch (e) {
        return false;
      }
    case 'exact':
      return url === pattern;
    case 'contains':
      return url.includes(pattern);
    default:
      return false;
  }
}

function globMatch(str, pattern) {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp('^' + regexPattern + '$');
  return regex.test(str);
}

// Resting status shown by default and restored after a transient status fades.
// Mirrors the initial markup in popup.html (the .status-msg text).
// The resting state is CLASSLESS (no success/error/warning/info) — that's
// what the pulsing cornflower dot keys off of in popup.css. Passing a null/
// falsy type to setStatus reproduces that classless default.
const RESTING_STATUS_MESSAGE = 'Extension is running';
const STATUS_REVERT_MS = 5000;
let statusRevertTimer = null;

function setStatus(message, type) {
  const statusEl = document.getElementById('status-text');
  const msgEl = statusEl.querySelector('.status-msg');
  if (msgEl) {
    msgEl.textContent = message;
  } else {
    // Fallback in case markup changes: don't clobber a dot child if present.
    statusEl.textContent = message;
  }

  // Use theme-aware classes; see popup.css (.status.success/.error/.warning/.info).
  // A null/undefined type returns to the classless resting state (pulsing cornflower dot).
  statusEl.classList.remove('success', 'error', 'warning', 'info');
  if (type) statusEl.classList.add(type);

  // Any prior revert timer is now stale — reset so two-in-flight statuses
  // don't race to revert the newer one.
  if (statusRevertTimer !== null) {
    clearTimeout(statusRevertTimer);
    statusRevertTimer = null;
  }

  // Don't auto-revert the resting state itself (would schedule a no-op loop).
  const isResting = !type && message === RESTING_STATUS_MESSAGE;
  if (!isResting) {
    statusRevertTimer = setTimeout(() => {
      statusRevertTimer = null;
      setStatus(RESTING_STATUS_MESSAGE, null);
    }, STATUS_REVERT_MS);
  }
}

async function syncTheme() {
  try {
    const { theme } = await chrome.storage.sync.get('theme');
    if (!theme) return;
    const current = document.documentElement.getAttribute('data-theme');
    if (theme !== current) {
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem('cc-theme', theme); } catch (e) {}
    }
  } catch (e) { /* storage unavailable — keep flash-prevention value */ }
}
