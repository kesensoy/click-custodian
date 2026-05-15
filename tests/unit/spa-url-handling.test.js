/**
 * Unit tests for tabs.onUpdated listener handling of SPA-style in-page URL changes.
 * Tests background.js listener logic.
 *
 * Per project convention (see pattern-matching.test.js), the function under test
 * is copied here rather than imported, since background.js does not export.
 */

// COPIED FROM background.js (matchesPattern + globMatch)
function globMatch(str, pattern) {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp('^' + regexPattern + '$');
  return regex.test(str);
}

function matchesPattern(url, pattern, matchType) {
  if (!url) return false;
  switch (matchType) {
    case 'glob': return globMatch(url, pattern);
    case 'regex':
      try { return new RegExp(pattern).test(url); } catch (e) { return false; }
    case 'exact': return url === pattern;
    case 'contains': return url.includes(pattern);
    default: return false;
  }
}

/**
 * COPIED FROM background.js — the onUpdated listener body, factored as a pure
 * function over its inputs. Fires `actions` array with each message that
 * would be dispatched. Tracks state via the passed-in `state` object so tests
 * can simulate sequences of events.
 *
 * After source changes land, this copy must be updated to match.
 */
function processUpdate(state, tabId, changeInfo, tab, rules) {
  const TAB_TRACKING_TIMEOUT = 5000;
  const POST_LOAD_QUIET_MS = 1500;
  const actions = [];

  const isLoadComplete = changeInfo.status === 'complete';
  const isInPageUrlChange = !!changeInfo.url && changeInfo.status !== 'loading' && !isLoadComplete;
  if (!isLoadComplete && !isInPageUrlChange) return actions;

  const url = changeInfo.url || tab.url;
  if (!url) return actions;

  if (isInPageUrlChange) {
    const lastLoadAt = state.lastLoadAt[tabId];
    if (lastLoadAt && (state.now - lastLoadAt) < POST_LOAD_QUIET_MS) {
      return actions;
    }
  }

  const tabKey = `${tabId}-${url}`;
  if (state.processedTabs.has(tabKey)) return actions;
  state.processedTabs.add(tabKey);

  if (isLoadComplete) {
    state.lastLoadAt[tabId] = state.now;
  }

  const closeRule = (rules.tabCloseRules || []).find(r =>
    r.enabled !== false && matchesPattern(url, r.urlPattern, r.matchType));
  const clickRule = (rules.buttonClickRules || []).find(r =>
    r.enabled !== false && matchesPattern(url, r.urlPattern, r.matchType));

  if (closeRule && clickRule) {
    actions.push({ type: 'checkButtonExists', rule: clickRule, closeRuleDelay: closeRule.delay, trigger: isLoadComplete ? 'load' : 'spa' });
    return actions;
  }
  if (closeRule) actions.push({ type: 'startCountdown', delay: closeRule.delay, trigger: isLoadComplete ? 'load' : 'spa' });
  if (clickRule) actions.push({ type: 'clickButton', rule: clickRule, trigger: isLoadComplete ? 'load' : 'spa' });
  return actions;
}

function freshState(now = 1000) {
  return { processedTabs: new Set(), lastLoadAt: {}, now };
}

describe('SPA URL handling — listener logic', () => {
  test('placeholder — scaffold compiles', () => {
    const state = freshState();
    const actions = processUpdate(state, 1, { status: 'complete' }, { url: 'https://example.com/' }, {});
    expect(Array.isArray(actions)).toBe(true);
  });
});
