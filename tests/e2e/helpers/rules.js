/**
 * Helper functions for creating test rules programmatically
 */

function createButtonClickRule(overrides = {}) {
  return {
    id: overrides.id || 'test-click-rule',
    name: overrides.name || 'Test Click Rule',
    urlPattern: overrides.urlPattern || 'http://localhost:*/test-conflict-*',
    matchType: overrides.matchType || 'glob',
    selector: overrides.selector || '#test-button',
    buttonText: overrides.buttonText || '',
    delay: overrides.delay !== undefined ? overrides.delay : 500,
    enabled: true,
    ...overrides
  };
}

function createTabCloseRule(overrides = {}) {
  return {
    id: overrides.id || 'test-close-rule',
    name: overrides.name || 'Test Close Rule',
    urlPattern: overrides.urlPattern || 'http://localhost:*/test-conflict-*',
    matchType: overrides.matchType || 'glob',
    delay: overrides.delay !== undefined ? overrides.delay : 2000,
    enabled: true,
    ...overrides
  };
}

function createTestRules({ clickRule = {}, closeRule = {}, includeClick = true, includeClose = true } = {}) {
  const rules = {
    tabCloseRules: [],
    buttonClickRules: []
  };

  if (includeClick) {
    rules.buttonClickRules.push(createButtonClickRule(clickRule));
  }

  if (includeClose) {
    rules.tabCloseRules.push(createTabCloseRule(closeRule));
  }

  return rules;
}

/**
 * Seed the legacy two-tier storage shape (for migration tests).
 * Produces an object that can be passed to `chrome.storage.sync.set`
 * to simulate the pre-Task-14 storage layout.
 */
function createLegacyRules({ defaultRules = [], userRules = [], defaultRulesEnabled = {} } = {}) {
  return {
    defaultRules: { version: '1.0', tabCloseRules: defaultRules, buttonClickRules: [] },
    userRules: { tabCloseRules: userRules, buttonClickRules: [] },
    defaultRulesEnabled,
    defaultsVersion: '1.0'
  };
}

module.exports = {
  createButtonClickRule,
  createTabCloseRule,
  createTestRules,
  createLegacyRules
};
