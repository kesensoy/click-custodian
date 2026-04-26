/**
 * Regression test for the `ensureRowsMode` H1 fix.
 *
 * Bug: clicking "+ Add rule" while the JSON view had unapplied edits triggered
 * the "Discard unapplied JSON edits?" confirm dialog TWICE — once from
 * `ensureRowsMode`, then again from `setViewMode`'s own dirty check, because
 * `ensureRowsMode` never cleared `dirtyInView` before delegating.
 *
 * Fix: pre-clear `state.dirtyInView` after the user confirms but before
 * calling `setViewMode`. This test pins that contract.
 *
 * COPIED FROM options.js for testing (per project convention — see
 * tests/unit/pattern-matching.test.js for the canonical pattern).
 */

let jsonView;
let setViewModeCalls;
let dirtyAtSetViewModeTime;

function setViewMode(pageId, mode) {
  // Mirror the production setViewMode dirty-check in test form: if dirtyInView
  // is still true when we get here, we'd pop a SECOND confirm — that's the bug.
  const state = jsonView[pageId];
  dirtyAtSetViewModeTime = state.dirtyInView;
  if (state.mode === 'json' && state.dirtyInView) {
    if (!confirm('Discard unapplied JSON edits?')) return;
    state.dirtyInView = false;
  }
  state.mode = mode;
  setViewModeCalls.push({ pageId, mode });
}

function ensureRowsMode(pageId) {
  const state = jsonView[pageId];
  if (!state || state.mode === 'rows') return true;
  if (state.dirtyInView && !confirm('Discard unapplied JSON edits?')) return false;
  // Pre-clear so setViewMode's own dirty-check doesn't re-prompt.
  state.dirtyInView = false;
  setViewMode(pageId, 'rows');
  return true;
}

describe('ensureRowsMode — single-confirm contract', () => {
  let confirmSpy;

  beforeEach(() => {
    jsonView = {
      'page-close': { mode: 'json', dirtyInView: false, originalSerialized: '' },
      'page-click': { mode: 'json', dirtyInView: false, originalSerialized: '' }
    };
    setViewModeCalls = [];
    dirtyAtSetViewModeTime = null;
    confirmSpy = jest.spyOn(global, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  test('clean state in JSON mode: switches to rows without confirm', () => {
    jsonView['page-close'].dirtyInView = false;
    expect(ensureRowsMode('page-close')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(setViewModeCalls).toEqual([{ pageId: 'page-close', mode: 'rows' }]);
    expect(jsonView['page-close'].mode).toBe('rows');
  });

  test('already in rows mode: returns true without confirm or setViewMode call', () => {
    jsonView['page-close'].mode = 'rows';
    jsonView['page-close'].dirtyInView = true; // can't actually happen, but be defensive
    expect(ensureRowsMode('page-close')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(setViewModeCalls).toEqual([]);
  });

  test('dirty JSON edits + user confirms: confirm fires EXACTLY ONCE (regression: was twice)', () => {
    jsonView['page-close'].dirtyInView = true;
    expect(ensureRowsMode('page-close')).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(setViewModeCalls).toEqual([{ pageId: 'page-close', mode: 'rows' }]);
    expect(jsonView['page-close'].mode).toBe('rows');
    // The load-bearing assertion: dirtyInView was already false by the time
    // setViewMode was called, so its own dirty-check didn't re-prompt.
    expect(dirtyAtSetViewModeTime).toBe(false);
  });

  test('dirty JSON edits + user cancels: returns false, dirty preserved, no setViewMode', () => {
    confirmSpy.mockImplementation(() => false);
    jsonView['page-close'].dirtyInView = true;
    expect(ensureRowsMode('page-close')).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(setViewModeCalls).toEqual([]);
    expect(jsonView['page-close'].dirtyInView).toBe(true);
    expect(jsonView['page-close'].mode).toBe('json');
  });

  test('unknown pageId: returns true without side effects', () => {
    expect(ensureRowsMode('page-bogus')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(setViewModeCalls).toEqual([]);
  });
});
