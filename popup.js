// Popup script

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();

  // Open settings
  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Test on current tab
  document.getElementById('test-current-tab').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const storage = await chrome.storage.sync.get(['defaultRules', 'userRules', 'defaultRulesEnabled']);

    if (!storage.defaultRules || !storage.userRules) {
      setStatus('No configuration found', 'error');
      return;
    }

    // Combine default rules (with enabled state) and user rules
    const allCloseRules = [
      ...storage.defaultRules.tabCloseRules.map(rule => ({
        ...rule,
        enabled: storage.defaultRulesEnabled[rule.id] !== false,
        isDefault: true
      })),
      ...storage.userRules.tabCloseRules
    ];

    const allClickRules = [
      ...storage.defaultRules.buttonClickRules.map(rule => ({
        ...rule,
        enabled: storage.defaultRulesEnabled[rule.id] !== false,
        isDefault: true
      })),
      ...storage.userRules.buttonClickRules
    ];

    // Check if tab matches any rules (enabled or disabled)
    const closeRuleMatch = allCloseRules.find(rule =>
      matchesPattern(tab.url, rule.urlPattern, rule.matchType)
    );

    const clickRuleMatch = allClickRules.find(rule =>
      matchesPattern(tab.url, rule.urlPattern, rule.matchType)
    );

    if (closeRuleMatch) {
      if (closeRuleMatch.enabled) {
        setStatus(`Matches close rule: ${closeRuleMatch.name}`, 'success');
      } else {
        setStatus(`Matches close rule: ${closeRuleMatch.name} (DISABLED)`, 'warning');
      }
    } else if (clickRuleMatch) {
      if (clickRuleMatch.enabled) {
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
  const storage = await chrome.storage.sync.get(['defaultRules', 'userRules', 'defaultRulesEnabled']);

  if (!storage.defaultRules || !storage.userRules) {
    setStatus('No configuration found', 'error');
    return;
  }

  // Combine default rules (with enabled state) and user rules
  const allCloseRules = [
    ...storage.defaultRules.tabCloseRules.map(rule => ({
      ...rule,
      enabled: storage.defaultRulesEnabled[rule.id] !== false,
      isDefault: true
    })),
    ...storage.userRules.tabCloseRules
  ];

  const allClickRules = [
    ...storage.defaultRules.buttonClickRules.map(rule => ({
      ...rule,
      enabled: storage.defaultRulesEnabled[rule.id] !== false,
      isDefault: true
    })),
    ...storage.userRules.buttonClickRules
  ];

  const closeRulesCount = allCloseRules.length;
  const clickRulesCount = allClickRules.length;
  const activeRulesCount = allCloseRules.filter(r => r.enabled).length +
                          allClickRules.filter(r => r.enabled).length;

  document.getElementById('close-rules-count').textContent = closeRulesCount;
  document.getElementById('click-rules-count').textContent = clickRulesCount;
  document.getElementById('active-rules-count').textContent = activeRulesCount;
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

function setStatus(message, type) {
  const statusEl = document.getElementById('status-text');
  statusEl.textContent = message;

  // Color mapping: error (red), success (green), warning (orange), info (gray)
  const colors = {
    error: '#e74c3c',
    success: '#2ecc71',
    warning: '#f39c12',
    info: '#7f8c8d'
  };

  statusEl.style.color = colors[type] || colors.info;
}
