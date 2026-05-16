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
 * When the source listener changes, update this copy to match.
 *
 * Deliberately omitted from the copy (kept simple for unit testability):
 * - `checkTrackingSetSize()` emergency clear (defensive code path, not
 *   load-bearing for any tested behavior)
 * - `setTimeout` cleanup of `processedTabs` after `TAB_TRACKING_TIMEOUT`
 *   (tests control state directly via `state.processedTabs`)
 * - The `chrome.runtime.onMessage` round trip for conflict-mode button-click
 *   results (covered indirectly by tests that hand-clear `state.lastLoadAt`
 *   to simulate the post-click cleanup)
 *
 * The `trigger` field on emitted actions ('load' | 'spa') is a test-only
 * affordance — the real listener logs the trigger via `debugLog` but does
 * not include it in dispatched messages.
 */
function processUpdate(state, tabId, changeInfo, tab, rules) {
  const POST_LOAD_QUIET_MS = 1500;
  const actions = [];

  const isLoadComplete = changeInfo.status === 'complete';
  const isInPageUrlChange = !!changeInfo.url && changeInfo.status !== 'loading' && !isLoadComplete;
  if (!isLoadComplete && !isInPageUrlChange) return actions;

  const url = changeInfo.url || tab?.url;
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
  // A no-match load also clears any stale cooldown from a previous page on
  // the same tab — see the dedicated test for that scenario below.
  if (isLoadComplete) {
    if (closeRule || clickRule) {
      state.lastLoadAt[tabId] = state.now;
    } else {
      delete state.lastLoadAt[tabId];
    }
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

  test('conflict-mode load-complete sets cooldown like single-rule load', () => {
    // Note: this exercises the cooldown-setting path only. The post-click
    // tracking cleanup lives in the chrome.runtime.onMessage handler, which
    // this test copy intentionally does not model — see the test below for
    // the simulated-cleanup case.
    const rules = {
      tabCloseRules: [{
        id: 'close', name: 'close', enabled: true,
        urlPattern: '/path', matchType: 'contains', delay: 3000
      }],
      buttonClickRules: [{
        id: 'click', name: 'click', enabled: true,
        urlPattern: '/path', matchType: 'contains', selector: '#btn', delay: 200
      }]
    };
    const state = freshState(1000);

    const dirty = 'https://example.com/path?a=1';
    // Both rules match dirty URL — conflict path fires checkButtonExists
    const a1 = processUpdate(state, 1, { status: 'complete' }, { url: dirty }, rules);
    expect(a1).toHaveLength(1);
    expect(a1[0].type).toBe('checkButtonExists');

    // 200ms later, replaceState rewrites to clean URL — both rules still match.
    // Cooldown must suppress this in-page event to prevent double-dispatch.
    state.now = 1200;
    const clean = 'https://example.com/path';
    const a2 = processUpdate(state, 1, { url: clean }, { url: clean }, rules);
    expect(a2).toEqual([]);
  });

  test('in-page URL change fires when no prior load-complete was seen (MV3 worker restart)', () => {
    // MV3 service workers terminate when idle. If the worker restarts and the
    // first event it sees for an existing tab is an in-page URL change, there
    // is no `lastLoadAt` entry to gate against — the event must evaluate.
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'exact', enabled: true,
        urlPattern: 'https://example.com/clean', matchType: 'exact', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState(1000);
    const clean = 'https://example.com/clean';

    // No prior processUpdate call — state.lastLoadAt is empty.
    expect(state.lastLoadAt[1]).toBeUndefined();

    const a = processUpdate(state, 1, { url: clean }, { url: clean }, rules);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'startCountdown', delay: 3000, trigger: 'spa' });
  });

  test('clearing the cooldown timestamp lets in-page change fire within the original window', () => {
    // Mirrors the conflict-mode button-click handler clearing lastLoadCompleteAt
    // alongside the processedTabs entry, so a subsequent history.replaceState
    // triggered by the click still re-evaluates against rules.
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'contains', enabled: true,
        urlPattern: '/path', matchType: 'contains', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState(1000);
    const dirty = 'https://example.com/path?a=1';
    const clean = 'https://example.com/path';

    // Load-complete fires once, sets cooldown
    const a1 = processUpdate(state, 1, { status: 'complete' }, { url: dirty }, rules);
    expect(a1).toHaveLength(1);
    expect(state.lastLoadAt[1]).toBe(1000);

    // Simulate the message-handler clearing both tracking entries
    state.processedTabs.delete(`1-${dirty}`);
    delete state.lastLoadAt[1];

    // 200ms later (well inside original 1500ms cooldown), in-page URL change fires
    state.now = 1200;
    const a2 = processUpdate(state, 1, { url: clean }, { url: clean }, rules);
    expect(a2).toHaveLength(1);
    expect(a2[0].trigger).toBe('spa');
  });

  test('multi-URL-form cleanup removes every processedTabs entry for the tab', () => {
    // The conflict-mode message handler clears processedTabs by tabId prefix
    // because a single tab can have entries under multiple URLs across one
    // navigation (load-complete URL + post-rewrite URL). This test models the
    // prefix-delete behavior directly on the test-side state.
    const state = freshState(1000);
    state.processedTabs.add('1-https://example.com/path?a=1');
    state.processedTabs.add('1-https://example.com/path');
    state.processedTabs.add('2-https://other.com/page');
    state.lastLoadAt[1] = 1000;

    // Simulate the message-handler post-click prefix sweep
    const prefix = `1-`;
    for (const key of state.processedTabs) {
      if (key.startsWith(prefix)) state.processedTabs.delete(key);
    }
    delete state.lastLoadAt[1];

    expect([...state.processedTabs]).toEqual(['2-https://other.com/page']);
    expect(state.lastLoadAt[1]).toBeUndefined();
  });

  test('stale cooldown from a prior page is cleared by a no-match load-complete on the same tab', () => {
    // Regression: previously the cooldown engaged for page A could persist
    // for 1.5s after the user navigated to page B if page B's load didn't
    // match any rule. A SPA rewrite on page B within that window would have
    // been suppressed by page A's stale cooldown. A no-match load now clears.
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'page-a-rule', enabled: true,
        urlPattern: 'https://example.com/a', matchType: 'contains', delay: 3000
      }],
      buttonClickRules: []
    };
    const state = freshState(1000);

    // Page A loads, rule matches, cooldown engaged.
    const pageA = 'https://example.com/a';
    const a1 = processUpdate(state, 1, { status: 'complete' }, { url: pageA }, rules);
    expect(a1).toHaveLength(1);
    expect(state.lastLoadAt[1]).toBe(1000);

    // 500ms later (well inside the 1500ms window), user navigates to page B.
    // No rule matches on page B's load. Old behavior: cooldown sticks.
    // New behavior: cooldown cleared so any SPA event on page B can fire.
    state.now = 1500;
    const pageB = 'https://example.com/b';
    const a2 = processUpdate(state, 1, { status: 'complete' }, { url: pageB }, rules);
    expect(a2).toEqual([]);
    expect(state.lastLoadAt[1]).toBeUndefined();
  });

  test('post-click SPA event fires even when rule.delay < POST_CLICK_REEVAL_MS', () => {
    // Regression: conflict-mode used to clear lastLoadAt 100ms after the
    // click, so a button rule with rule.delay < 100ms could see its
    // post-click history.replaceState event arrive while the cooldown was
    // still active. The fix is to clear lastLoadAt SYNCHRONOUSLY at the
    // moment buttonCheckResult arrives (i.e. before the click message even
    // goes out), so the SPA event is never gated by a stale cooldown.
    const rules = {
      tabCloseRules: [{
        id: 'close', name: 'close', enabled: true,
        urlPattern: '/path', matchType: 'contains', delay: 3000
      }],
      buttonClickRules: [{
        id: 'click', name: 'click', enabled: true,
        urlPattern: '/path', matchType: 'contains', selector: '#btn', delay: 20
      }]
    };
    const state = freshState(1000);

    const dirty = 'https://example.com/path?a=1';
    const a1 = processUpdate(state, 1, { status: 'complete' }, { url: dirty }, rules);
    expect(a1[0].type).toBe('checkButtonExists');
    expect(state.lastLoadAt[1]).toBe(1000); // cooldown engaged

    // SYNCHRONOUS clear at buttonCheckResult time (the real listener does
    // this before awaiting the clickButton message).
    delete state.lastLoadAt[1];

    // 30ms later (during the click delay) the page calls replaceState. With
    // a stale cooldown this would be suppressed; with the sync clear it fires.
    state.now = 1030;
    const clean = 'https://example.com/path';
    const a2 = processUpdate(state, 1, { url: clean }, { url: clean }, rules);
    expect(a2).toHaveLength(1);
    expect(a2[0].trigger).toBe('spa');
  });
});
