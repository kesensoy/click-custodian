// Popup script

document.addEventListener('DOMContentLoaded', async () => {
  await syncTheme();
  await loadStats();
  await hydrateStarCta();
  wireStarCta();

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

// Star CTA: the anchor's href takes first-time visitors to the repo;
// content.js detects the actual starred state from GitHub's DOM and writes
// hasStarred=true. We never set the flag from the popup (visiting !=
// actually starring) and we suppress the navigation entirely once starred —
// the widget becomes a "thanks" affirmation, not a re-entry point.
const HAS_STARRED_KEY = 'hasStarred';

async function hydrateStarCta() {
  const cta = document.getElementById('star-cta');
  if (!cta) return;
  applyStarCtaA11y(cta, false);
  try {
    const items = await chrome.storage.sync.get([HAS_STARRED_KEY]);
    if (items[HAS_STARRED_KEY]) {
      cta.classList.add('starred');
      applyStarCtaA11y(cta, true);
    }
  } catch (e) { /* storage unavailable — leave default unstarred state */ }
}

// The visible "Star us?" / "Thanks!" span is the accessible name when sighted
// hover reveals it, but keyboard-only / focus-only users see an empty-looking
// icon — driving aria-label + title from state restores parity without
// re-introducing the round-1 staleness bug.
function applyStarCtaA11y(cta, starred) {
  const label = starred
    ? 'Thanks for starring Click Custodian on GitHub'
    : 'Star Click Custodian on GitHub';
  cta.setAttribute('aria-label', label);
  cta.setAttribute('title', label);
}

function wireStarCta() {
  const cta = document.getElementById('star-cta');
  if (!cta) return;
  cta.addEventListener('click', (e) => {
    if (!cta.classList.contains('starred')) return;
    e.preventDefault();
    // Replay the spin: removing + re-adding .spinning is a no-op without a
    // forced reflow because the browser coalesces both style changes into
    // one recalc. Reading offsetWidth on the anchor flushes pending styles
    // for the whole subtree (the SVG icon doesn't expose offsetWidth itself).
    const icon = cta.querySelector('.star-cta-icon');
    if (icon) {
      icon.classList.remove('spinning');
      void cta.offsetWidth;
      icon.classList.add('spinning');
    }
  });
}

async function syncTheme() {
  try {
    const { theme, palette } = await chrome.storage.sync.get(['theme', 'palette']);
    if (theme === 'light' || theme === 'dark' || theme === 'auto') {
      const resolved = (theme === 'light' || theme === 'dark')
        ? theme
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const current = document.documentElement.getAttribute('data-theme');
      if (resolved !== current) {
        document.documentElement.setAttribute('data-theme', resolved);
      }
      try { localStorage.setItem('cc-theme', theme); } catch (e) {}
    }
    const valid = ['navy', 'moss', 'graphite', 'ember'];
    const resolvedPalette = valid.includes(palette) ? palette : 'navy';
    const currentPalette = document.documentElement.getAttribute('data-palette') || 'navy';
    if (resolvedPalette !== currentPalette) {
      if (resolvedPalette === 'navy') {
        document.documentElement.removeAttribute('data-palette');
      } else {
        document.documentElement.setAttribute('data-palette', resolvedPalette);
      }
      try { localStorage.setItem('cc-palette', resolvedPalette); } catch (e) {}
    }
  } catch (e) { /* storage unavailable — keep flash-prevention value */ }
}
