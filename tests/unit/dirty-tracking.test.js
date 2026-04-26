/**
 * Unit tests for the saved-snapshot dirty-state tracker.
 *
 * Covers `rulesEqual()` — the structural compare used by
 * `options.js:recomputeDirtyState()` to decide whether the in-memory
 * `rules` payload matches the last known on-disk snapshot. The DOM-touching
 * `recomputeDirtyState()` itself is wired up in options.js; here we exercise
 * the pure comparator that drives it.
 *
 * COPIED FROM options.js for testing (per project convention — see
 * tests/unit/pattern-matching.test.js for the canonical pattern).
 */

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function rulesEqual(a, b) {
  if (!a || !b) return a === b;
  if (a.tabCloseRules.length !== b.tabCloseRules.length) return false;
  if (a.buttonClickRules.length !== b.buttonClickRules.length) return false;
  for (let i = 0; i < a.tabCloseRules.length; i++) {
    if (stableStringify(a.tabCloseRules[i]) !== stableStringify(b.tabCloseRules[i])) return false;
  }
  for (let i = 0; i < a.buttonClickRules.length; i++) {
    if (stableStringify(a.buttonClickRules[i]) !== stableStringify(b.buttonClickRules[i])) return false;
  }
  return true;
}

function cloneRules(src) {
  return {
    tabCloseRules: src.tabCloseRules.map(r => ({ ...r })),
    buttonClickRules: src.buttonClickRules.map(r => ({ ...r }))
  };
}

const sampleClose = (overrides = {}) => ({
  id: 'rule_close_1',
  name: 'Localhost OAuth',
  urlPattern: '*://localhost:*/*callback*',
  matchType: 'glob',
  enabled: true,
  delay: 3000,
  ...overrides
});

const sampleClick = (overrides = {}) => ({
  id: 'rule_click_1',
  name: 'Approve button',
  urlPattern: '*://example.com/*',
  matchType: 'glob',
  selector: 'button.approve',
  buttonText: '',
  enabled: true,
  delay: 500,
  ...overrides
});

describe('Dirty tracking — rulesEqual', () => {
  test('identical state is equal', () => {
    const a = { tabCloseRules: [sampleClose()], buttonClickRules: [sampleClick()] };
    const b = cloneRules(a);
    expect(rulesEqual(a, b)).toBe(true);
  });

  test('empty states are equal', () => {
    const a = { tabCloseRules: [], buttonClickRules: [] };
    const b = { tabCloseRules: [], buttonClickRules: [] };
    expect(rulesEqual(a, b)).toBe(true);
  });

  test('one field changed is dirty', () => {
    const saved = { tabCloseRules: [sampleClose()], buttonClickRules: [] };
    const live = cloneRules(saved);
    live.tabCloseRules[0].delay = 5000;
    expect(rulesEqual(live, saved)).toBe(false);
  });

  test('name change is dirty', () => {
    const saved = { tabCloseRules: [sampleClose()], buttonClickRules: [] };
    const live = cloneRules(saved);
    live.tabCloseRules[0].name = 'Renamed';
    expect(rulesEqual(live, saved)).toBe(false);
  });

  test('enabled flipped twice returns to clean', () => {
    const saved = { tabCloseRules: [sampleClose({ enabled: true })], buttonClickRules: [] };
    const live = cloneRules(saved);
    // First toggle: off -> dirty.
    live.tabCloseRules[0].enabled = false;
    expect(rulesEqual(live, saved)).toBe(false);
    // Toggle back to on -> clean.
    live.tabCloseRules[0].enabled = true;
    expect(rulesEqual(live, saved)).toBe(true);
  });

  test('rule added is dirty', () => {
    const saved = { tabCloseRules: [sampleClose()], buttonClickRules: [] };
    const live = cloneRules(saved);
    live.tabCloseRules.push(sampleClose({ id: 'rule_close_2', name: 'Second' }));
    expect(rulesEqual(live, saved)).toBe(false);
  });

  test('rule added then removed returns to clean', () => {
    const saved = { tabCloseRules: [sampleClose()], buttonClickRules: [] };
    const live = cloneRules(saved);
    // Simulate addCloseRule(): push a new rule with a fresh id.
    live.tabCloseRules.push(sampleClose({ id: 'rule_close_brand_new', name: 'Temp' }));
    expect(rulesEqual(live, saved)).toBe(false);
    // Simulate deleteUserRule(): splice it out.
    live.tabCloseRules.splice(1, 1);
    expect(rulesEqual(live, saved)).toBe(true);
  });

  test('rule order swapped is dirty (array order is meaningful)', () => {
    const r1 = sampleClose({ id: 'rule_close_a', name: 'A' });
    const r2 = sampleClose({ id: 'rule_close_b', name: 'B' });
    const saved = { tabCloseRules: [r1, r2], buttonClickRules: [] };
    const live = { tabCloseRules: [{ ...r2 }, { ...r1 }], buttonClickRules: [] };
    expect(rulesEqual(live, saved)).toBe(false);
  });

  test('field-order within a rule object does not matter', () => {
    const saved = { tabCloseRules: [sampleClose()], buttonClickRules: [] };
    // Rebuild the rule with reversed key insertion order.
    const original = saved.tabCloseRules[0];
    const reordered = {};
    Object.keys(original).reverse().forEach(k => { reordered[k] = original[k]; });
    const live = { tabCloseRules: [reordered], buttonClickRules: [] };
    expect(rulesEqual(live, saved)).toBe(true);
  });

  test('change in click rule (buttonClickRules) is detected', () => {
    const saved = { tabCloseRules: [], buttonClickRules: [sampleClick()] };
    const live = cloneRules(saved);
    live.buttonClickRules[0].selector = 'button.different';
    expect(rulesEqual(live, saved)).toBe(false);
  });

  test('cross-array length mismatch is dirty', () => {
    const saved = { tabCloseRules: [sampleClose()], buttonClickRules: [sampleClick()] };
    const live = { tabCloseRules: [sampleClose()], buttonClickRules: [] };
    expect(rulesEqual(live, saved)).toBe(false);
  });
});
