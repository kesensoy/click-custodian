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
    ...overrides
  };
}

function createTestRules({ clickRule = {}, closeRule = {}, includeClick = true, includeClose = true } = {}) {
  const rules = {
    userRules: {
      buttonClickRules: [],
      tabCloseRules: []
    },
    defaultRules: {
      version: "1.0",
      buttonClickRules: [],
      tabCloseRules: []
    },
    defaultRulesEnabled: {},
    defaultsVersion: "1.0"
  };

  if (includeClick) {
    rules.userRules.buttonClickRules.push(createButtonClickRule(clickRule));
  }

  if (includeClose) {
    rules.userRules.tabCloseRules.push(createTabCloseRule(closeRule));
  }

  return rules;
}

module.exports = {
  createButtonClickRule,
  createTabCloseRule,
  createTestRules
};
