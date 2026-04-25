/**
 * Unit tests for import smart-merge conflict detection (options.js).
 *
 * Mirrors the project's existing pattern (see pattern-matching.test.js):
 * production source files don't export functions, so the helpers are
 * copied here. Keep in sync with options.js:conflictKey() and
 * buildConflictPlan().
 *
 * A1 dedup signature:
 *   tab-close   = matchType + urlPattern
 *   button-click = matchType + urlPattern + selector + buttonText
 */

function conflictKey(rule, kind) {
  const base = `${rule.matchType || 'glob'} ${rule.urlPattern || ''}`;
  if (kind === 'buttonClick') {
    return `${base} ${rule.selector || ''} ${rule.buttonText || ''}`;
  }
  return base;
}

function buildConflictPlan(imported, existing) {
  const conflicts = [];
  const additions = { tabCloseRules: [], buttonClickRules: [] };
  const existingKeys = {
    tabClose: new Map(existing.tabCloseRules.map(r => [conflictKey(r, 'tabClose'), r])),
    buttonClick: new Map(existing.buttonClickRules.map(r => [conflictKey(r, 'buttonClick'), r]))
  };
  for (const r of imported.tabCloseRules) {
    const k = conflictKey(r, 'tabClose');
    if (existingKeys.tabClose.has(k)) {
      conflicts.push({ kind: 'tabClose', existing: existingKeys.tabClose.get(k), incoming: r, resolution: 'skip' });
    } else {
      additions.tabCloseRules.push(r);
    }
  }
  for (const r of imported.buttonClickRules) {
    const k = conflictKey(r, 'buttonClick');
    if (existingKeys.buttonClick.has(k)) {
      conflicts.push({ kind: 'buttonClick', existing: existingKeys.buttonClick.get(k), incoming: r, resolution: 'skip' });
    } else {
      additions.buttonClickRules.push(r);
    }
  }
  return { conflicts, additions };
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

describe('conflictKey (A1 signature)', () => {
  test('tab-close rules with same urlPattern + matchType collide', () => {
    expect(conflictKey(close({ name: 'A' }), 'tabClose'))
      .toBe(conflictKey(close({ name: 'B', delay: 999, enabled: false }), 'tabClose'));
  });

  test('tab-close rules differ when urlPattern differs', () => {
    expect(conflictKey(close({ urlPattern: 'a' }), 'tabClose'))
      .not.toBe(conflictKey(close({ urlPattern: 'b' }), 'tabClose'));
  });

  test('tab-close rules differ when matchType differs', () => {
    expect(conflictKey(close({ matchType: 'glob' }), 'tabClose'))
      .not.toBe(conflictKey(close({ matchType: 'exact' }), 'tabClose'));
  });

  test('button-click rules with same trigger + selector + text collide', () => {
    expect(conflictKey(click({ name: 'A', delay: 100 }), 'buttonClick'))
      .toBe(conflictKey(click({ name: 'B', delay: 999 }), 'buttonClick'));
  });

  test('button-click rules differ when selector differs', () => {
    expect(conflictKey(click({ selector: 'button.go' }), 'buttonClick'))
      .not.toBe(conflictKey(click({ selector: 'button.stop' }), 'buttonClick'));
  });

  test('button-click rules differ when buttonText differs', () => {
    expect(conflictKey(click({ buttonText: 'Go' }), 'buttonClick'))
      .not.toBe(conflictKey(click({ buttonText: 'Stop' }), 'buttonClick'));
  });

  test('button-click signature ignores name and delay', () => {
    const a = click({ name: 'A', delay: 100 });
    const b = click({ name: 'totally different', delay: 9999 });
    expect(conflictKey(a, 'buttonClick')).toBe(conflictKey(b, 'buttonClick'));
  });

  test('missing matchType defaults to glob for the signature', () => {
    const explicit = close({ matchType: 'glob' });
    const implicit = close({ matchType: undefined });
    expect(conflictKey(explicit, 'tabClose')).toBe(conflictKey(implicit, 'tabClose'));
  });
});

describe('buildConflictPlan', () => {
  test('returns no conflicts when nothing matches', () => {
    const existing = { tabCloseRules: [close({ urlPattern: 'x' })], buttonClickRules: [] };
    const imported = { tabCloseRules: [close({ urlPattern: 'y' })], buttonClickRules: [] };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.additions.tabCloseRules).toHaveLength(1);
    expect(plan.additions.buttonClickRules).toHaveLength(0);
  });

  test('detects a tab-close collision and excludes it from additions', () => {
    const existing = {
      tabCloseRules: [close({ id: 'old', urlPattern: 'x', delay: 200 })],
      buttonClickRules: []
    };
    const imported = {
      tabCloseRules: [close({ id: 'new', urlPattern: 'x', delay: 5000 })],
      buttonClickRules: []
    };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].kind).toBe('tabClose');
    expect(plan.conflicts[0].existing.id).toBe('old');
    expect(plan.conflicts[0].incoming.id).toBe('new');
    expect(plan.conflicts[0].resolution).toBe('skip');
    expect(plan.additions.tabCloseRules).toHaveLength(0);
  });

  test('detects a button-click collision and excludes it from additions', () => {
    const existing = { tabCloseRules: [], buttonClickRules: [click({ id: 'old' })] };
    const imported = { tabCloseRules: [], buttonClickRules: [click({ id: 'new', name: 'renamed' })] };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].kind).toBe('buttonClick');
    expect(plan.additions.buttonClickRules).toHaveLength(0);
  });

  test('mixed: collisions go to conflicts, novel rules go to additions', () => {
    const existing = {
      tabCloseRules: [close({ id: 't1', urlPattern: 'a' })],
      buttonClickRules: [click({ id: 'b1', selector: '.x' })]
    };
    const imported = {
      tabCloseRules: [
        close({ id: 't2', urlPattern: 'a', delay: 9 }),     // collides
        close({ id: 't3', urlPattern: 'brand-new' })        // novel
      ],
      buttonClickRules: [
        click({ id: 'b2', selector: '.y' }),                // novel (different selector)
        click({ id: 'b3', selector: '.x' })                 // collides
      ]
    };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts).toHaveLength(2);
    expect(plan.additions.tabCloseRules.map(r => r.id)).toEqual(['t3']);
    expect(plan.additions.buttonClickRules.map(r => r.id)).toEqual(['b2']);
  });

  test('empty inputs produce empty plan', () => {
    const plan = buildConflictPlan(empty(), empty());
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.additions.tabCloseRules).toHaveLength(0);
    expect(plan.additions.buttonClickRules).toHaveLength(0);
  });

  test('default resolution is skip (preserves existing without explicit user action)', () => {
    const existing = { tabCloseRules: [close({ urlPattern: 'x' })], buttonClickRules: [] };
    const imported = { tabCloseRules: [close({ urlPattern: 'x' })], buttonClickRules: [] };
    const plan = buildConflictPlan(imported, existing);
    expect(plan.conflicts[0].resolution).toBe('skip');
  });
});
