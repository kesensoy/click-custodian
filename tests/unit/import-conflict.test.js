/**
 * Unit tests for import smart-merge conflict detection (options.js).
 *
 * Mirrors the project's existing pattern (see pattern-matching.test.js):
 * production source files don't export functions, so the helpers are
 * copied here. Keep in sync with options.js:conflictKey(),
 * fieldValue(), diffFields(), and buildConflictPlan().
 *
 * URL-first dedup signature:
 *   tab-close   = urlPattern
 *   button-click = urlPattern + selector + buttonText
 * matchType is NOT part of the signature — same URL with different
 * matchType collides (and shows up as a diff field).
 */

function conflictKey(rule, kind) {
  const base = rule.urlPattern || '';
  if (kind === 'buttonClick') {
    return `${base} ${rule.selector || ''} ${rule.buttonText || ''}`;
  }
  return base;
}

const DIFF_FIELDS = ['name', 'matchType', 'delay', 'enabled'];

function fieldValue(rule, field) {
  if (field === 'enabled') return rule.enabled !== false;
  if (field === 'matchType') return rule.matchType || 'glob';
  if (field === 'delay') return Number(rule.delay) || 0;
  return rule[field] ?? '';
}

function diffFields(existing, incoming) {
  return DIFF_FIELDS.filter(f => fieldValue(existing, f) !== fieldValue(incoming, f));
}

function buildConflictPlan(imported, existing) {
  const conflicts = [];
  const identicals = [];
  const additions = { tabCloseRules: [], buttonClickRules: [] };
  const existingKeys = {
    tabClose: new Map(existing.tabCloseRules.map(r => [conflictKey(r, 'tabClose'), r])),
    buttonClick: new Map(existing.buttonClickRules.map(r => [conflictKey(r, 'buttonClick'), r]))
  };
  const classify = (incoming, kind, addBucket) => {
    const map = kind === 'tabClose' ? existingKeys.tabClose : existingKeys.buttonClick;
    const existingMatch = map.get(conflictKey(incoming, kind));
    if (!existingMatch) {
      addBucket.push(incoming);
      return;
    }
    const diff = diffFields(existingMatch, incoming);
    if (diff.length === 0) {
      identicals.push({ kind, existing: existingMatch, incoming });
    } else {
      conflicts.push({ kind, existing: existingMatch, incoming, diff, resolution: 'skip' });
    }
  };
  for (const r of imported.tabCloseRules) classify(r, 'tabClose', additions.tabCloseRules);
  for (const r of imported.buttonClickRules) classify(r, 'buttonClick', additions.buttonClickRules);
  return { conflicts, identicals, additions };
}

const close = (overrides = {}) => ({
  id: 'a',
  name: 'rule',
  urlPattern: '*://example.com/*',
  matchType: 'glob',
  enabled: true,
  delay: 3000,
  ...overrides
});

const click = (overrides = {}) => ({
  id: 'b',
  name: 'btn',
  urlPattern: '*://example.com/*',
  matchType: 'glob',
  selector: 'button.go',
  buttonText: 'Go',
  enabled: true,
  delay: 200,
  ...overrides
});

const empty = () => ({ tabCloseRules: [], buttonClickRules: [] });

describe('conflictKey (URL-first signature)', () => {
  test('tab-close rules with same urlPattern collide regardless of matchType', () => {
    expect(conflictKey(close({ matchType: 'glob' }), 'tabClose'))
      .toBe(conflictKey(close({ matchType: 'exact' }), 'tabClose'));
  });

  test('tab-close rules differ when urlPattern differs', () => {
    expect(conflictKey(close({ urlPattern: 'a' }), 'tabClose'))
      .not.toBe(conflictKey(close({ urlPattern: 'b' }), 'tabClose'));
  });

  test('button-click rules with same trigger + selector + text collide regardless of matchType', () => {
    expect(conflictKey(click({ matchType: 'glob' }), 'buttonClick'))
      .toBe(conflictKey(click({ matchType: 'regex' }), 'buttonClick'));
  });

  test('button-click rules differ when selector differs', () => {
    expect(conflictKey(click({ selector: 'button.go' }), 'buttonClick'))
      .not.toBe(conflictKey(click({ selector: 'button.stop' }), 'buttonClick'));
  });

  test('button-click rules differ when buttonText differs', () => {
    expect(conflictKey(click({ buttonText: 'Go' }), 'buttonClick'))
      .not.toBe(conflictKey(click({ buttonText: 'Stop' }), 'buttonClick'));
  });
});

describe('fieldValue (default normalization)', () => {
  test('missing matchType normalizes to glob', () => {
    expect(fieldValue({ matchType: undefined }, 'matchType')).toBe('glob');
    expect(fieldValue({}, 'matchType')).toBe('glob');
  });

  test('missing enabled normalizes to true', () => {
    expect(fieldValue({}, 'enabled')).toBe(true);
    expect(fieldValue({ enabled: false }, 'enabled')).toBe(false);
  });

  test('delay coerces to number', () => {
    expect(fieldValue({ delay: '300' }, 'delay')).toBe(300);
    expect(fieldValue({}, 'delay')).toBe(0);
  });
});

describe('diffFields', () => {
  test('returns empty when all watched fields equal', () => {
    expect(diffFields(close(), close())).toEqual([]);
  });

  test('detects matchType difference', () => {
    expect(diffFields(close({ matchType: 'glob' }), close({ matchType: 'exact' }))).toEqual(['matchType']);
  });

  test('detects multiple field differences', () => {
    const a = close({ name: 'A', delay: 200 });
    const b = close({ name: 'B', delay: 5000 });
    expect(diffFields(a, b).sort()).toEqual(['delay', 'name']);
  });

  test('treats missing matchType same as glob', () => {
    expect(diffFields(close({ matchType: 'glob' }), close({ matchType: undefined }))).toEqual([]);
  });

  test('treats missing enabled same as true', () => {
    expect(diffFields(close({ enabled: true }), close({ enabled: undefined }))).toEqual([]);
  });
});

describe('buildConflictPlan', () => {
  test('returns no conflicts when nothing matches', () => {
    const existing = { tabCloseRules: [close({ urlPattern: 'x' })], buttonClickRules: [] };
    const imported = { tabCloseRules: [close({ urlPattern: 'y' })], buttonClickRules: [] };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.identicals).toHaveLength(0);
    expect(plan.additions.tabCloseRules).toHaveLength(1);
  });

  test('identical rule (signature + all fields match) goes to identicals, not conflicts', () => {
    const existing = { tabCloseRules: [close({ id: 'old', urlPattern: 'x' })], buttonClickRules: [] };
    const imported = { tabCloseRules: [close({ id: 'new', urlPattern: 'x' })], buttonClickRules: [] };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.identicals).toHaveLength(1);
    expect(plan.identicals[0].existing.id).toBe('old');
    expect(plan.additions.tabCloseRules).toHaveLength(0);
  });

  test('same urlPattern but different matchType is a conflict (not addition, not identical)', () => {
    const existing = { tabCloseRules: [close({ urlPattern: 'x', matchType: 'glob' })], buttonClickRules: [] };
    const imported = { tabCloseRules: [close({ urlPattern: 'x', matchType: 'exact' })], buttonClickRules: [] };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].diff).toEqual(['matchType']);
    expect(plan.additions.tabCloseRules).toHaveLength(0);
    expect(plan.identicals).toHaveLength(0);
  });

  test('same urlPattern with delay difference is a conflict carrying the diff list', () => {
    const existing = { tabCloseRules: [close({ urlPattern: 'x', delay: 200 })], buttonClickRules: [] };
    const imported = { tabCloseRules: [close({ urlPattern: 'x', delay: 5000 })], buttonClickRules: [] };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].diff).toEqual(['delay']);
    expect(plan.conflicts[0].resolution).toBe('skip');
  });

  test('button-click conflict: selector differs → addition (different rule); name differs → conflict', () => {
    const existing = { tabCloseRules: [], buttonClickRules: [click({ id: 'old', selector: '.x', name: 'A' })] };
    const imported = {
      tabCloseRules: [],
      buttonClickRules: [
        click({ id: 'b1', selector: '.y' }),                 // novel — different selector
        click({ id: 'b2', selector: '.x', name: 'B' })       // conflict — same selector, name differs
      ]
    };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.additions.buttonClickRules.map(r => r.id)).toEqual(['b1']);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].diff).toEqual(['name']);
  });

  test('mixed: identical, conflict, and addition all classified correctly', () => {
    const existing = {
      tabCloseRules: [
        close({ id: 't1', urlPattern: 'a' }),
        close({ id: 't2', urlPattern: 'b', delay: 200 })
      ],
      buttonClickRules: []
    };
    const imported = {
      tabCloseRules: [
        close({ id: 'i1', urlPattern: 'a' }),                 // identical to t1
        close({ id: 'i2', urlPattern: 'b', delay: 9999 }),    // conflict with t2 (delay diff)
        close({ id: 'i3', urlPattern: 'brand-new' })          // novel
      ],
      buttonClickRules: []
    };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.identicals).toHaveLength(1);
    expect(plan.identicals[0].existing.id).toBe('t1');
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].existing.id).toBe('t2');
    expect(plan.conflicts[0].diff).toEqual(['delay']);
    expect(plan.additions.tabCloseRules.map(r => r.id)).toEqual(['i3']);
  });

  test('empty inputs produce empty plan', () => {
    const plan = buildConflictPlan(empty(), empty());
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.identicals).toHaveLength(0);
    expect(plan.additions.tabCloseRules).toHaveLength(0);
    expect(plan.additions.buttonClickRules).toHaveLength(0);
  });

  test('default conflict resolution is skip (preserves existing without explicit user action)', () => {
    const existing = { tabCloseRules: [close({ urlPattern: 'x', name: 'old' })], buttonClickRules: [] };
    const imported = { tabCloseRules: [close({ urlPattern: 'x', name: 'new' })], buttonClickRules: [] };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts[0].resolution).toBe('skip');
  });
});
