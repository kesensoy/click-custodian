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

  const closeRule = (rules.tabCloseRules || []).find(r =>
    r.enabled !== false && matchesPattern(url, r.urlPattern, r.matchType));
  const clickRule = (rules.buttonClickRules || []).find(r =>
    r.enabled !== false && matchesPattern(url, r.urlPattern, r.matchType));

  // Cooldown is only entered when a rule actually fires on load-complete.
  // Without a fired rule, there is no double-fire risk to suppress, and the
  // in-page URL change branch must remain free to evaluate later events.
  if (isLoadComplete && (closeRule || clickRule)) {
    state.lastLoadAt[tabId] = state.now;
  }

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

  test('exact-match rule fires when in-page URL change reveals a match', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'clean-only', enabled: true,
        urlPattern: 'https://example.com/path', matchType: 'exact', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState(1000);

    // Initial load with extra query string — does not match
    const dirty = 'https://example.com/path?a=1&b=2';
    const a1 = processUpdate(state, 1, { status: 'complete' }, { url: dirty }, rules);
    expect(a1).toEqual([]);

    // Time advances past the post-load quiet period
    state.now = 1000 + 2000;

    // In-page URL change to clean URL — matches
    const clean = 'https://example.com/path';
    const a2 = processUpdate(state, 1, { url: clean }, { url: clean }, rules);
    expect(a2).toHaveLength(1);
    expect(a2[0]).toMatchObject({ type: 'startCountdown', delay: 3000, trigger: 'spa' });
  });

  test('changeInfo.url with status=loading is ignored', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'any', enabled: true,
        urlPattern: 'https://example.com/*', matchType: 'glob', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState();

    const url = 'https://example.com/page';
    const a = processUpdate(state, 1, { status: 'loading', url }, { url }, rules);
    expect(a).toEqual([]);
    // The same URL on `complete` SHOULD fire
    const b = processUpdate(state, 1, { status: 'complete' }, { url }, rules);
    expect(b).toHaveLength(1);
    expect(b[0].trigger).toBe('load');
  });

  test('cooldown suppresses in-page URL change shortly after load-complete', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'contains-rule', enabled: true,
        urlPattern: '/path', matchType: 'contains', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState(1000);

    const dirty = 'https://example.com/path?a=1';
    const clean = 'https://example.com/path';

    // Load-complete fires once (dirty matches contains)
    const a1 = processUpdate(state, 1, { status: 'complete' }, { url: dirty }, rules);
    expect(a1).toHaveLength(1);
    expect(a1[0].trigger).toBe('load');

    // 200ms later, replaceState rewrites to clean URL — also matches contains
    state.now = 1200;
    const a2 = processUpdate(state, 1, { url: clean }, { url: clean }, rules);
    expect(a2).toEqual([]);
  });

  test('cooldown does NOT suppress in-page change after the quiet period', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'contains-rule', enabled: true,
        urlPattern: '/page', matchType: 'contains', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState(1000);
    const url1 = 'https://example.com/page';
    const url2 = 'https://example.com/page/sub';

    processUpdate(state, 1, { status: 'complete' }, { url: url1 }, rules);
    // Past the quiet window
    state.now = 1000 + 5000;
    const a = processUpdate(state, 1, { url: url2 }, { url: url2 }, rules);
    expect(a).toHaveLength(1);
    expect(a[0].trigger).toBe('spa');
  });

  test('same URL across complete + in-page event is deduped', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'exact', enabled: true,
        urlPattern: 'https://example.com/page', matchType: 'exact', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState(1000);
    const url = 'https://example.com/page';

    const a1 = processUpdate(state, 1, { status: 'complete' }, { url }, rules);
    expect(a1).toHaveLength(1);

    // Same URL, in-page event — even past cooldown, dedup Set should suppress
    state.now = 1000 + 5000;
    const a2 = processUpdate(state, 1, { url }, { url }, rules);
    expect(a2).toEqual([]);
  });

  test('cooldown is NOT set when no rule matches on load-complete', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'clean-only', enabled: true,
        urlPattern: 'https://example.com/path', matchType: 'exact', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState(1000);

    // Dirty URL doesn't match — no rule fires, cooldown should NOT engage
    const dirty = 'https://example.com/path?a=1&b=2';
    const a1 = processUpdate(state, 1, { status: 'complete' }, { url: dirty }, rules);
    expect(a1).toEqual([]);

    // In-page URL change WELL WITHIN the 1500ms window. Without the bug fix,
    // this would be suppressed; with the fix, it must fire because no rule
    // fired on load-complete to deduplicate against.
    state.now = 1100; // only 100ms after load
    const clean = 'https://example.com/path';
    const a2 = processUpdate(state, 1, { url: clean }, { url: clean }, rules);
    expect(a2).toHaveLength(1);
    expect(a2[0]).toMatchObject({ type: 'startCountdown', delay: 3000, trigger: 'spa' });
  });
});
