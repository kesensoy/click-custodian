/**
 * Unit tests for save-time regex validation in options.js.
 *
 * Per project convention, the functions under test are copied here rather
 * than imported, since options.js does not export.
 */

// COPIED FROM options.js (validateRegexRules — form-view save path)
function validateRegexRules(allRules) {
  for (const kind of ['tabCloseRules', 'buttonClickRules']) {
    const arr = allRules[kind] || [];
    for (const r of arr) {
      if (r.matchType !== 'regex') continue;
      try {
        new RegExp(r.urlPattern);
      } catch (e) {
        return { ok: false, error: `Invalid regex in "${r.name || r.id}": ${e.message}` };
      }
    }
  }
  return { ok: true };
}

describe('validateRegexRules — form-view save path', () => {
  test('accepts a valid regex pattern', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'works', matchType: 'regex',
        urlPattern: '^https://example\\.com/.+', delay: 3000
      }],
      buttonClickRules: []
    };
    expect(validateRegexRules(rules)).toEqual({ ok: true });
  });

  test('rejects an invalid regex with a useful error', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'broken', matchType: 'regex',
        urlPattern: '(unclosed', delay: 3000
      }],
      buttonClickRules: []
    };
    const result = validateRegexRules(rules);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('"broken"');
    expect(result.error).toMatch(/[Ii]nvalid|[Uu]nterminated|group/);
  });

  test('non-regex match types are skipped (cannot fail)', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'glob-rule', matchType: 'glob',
        urlPattern: '*://example.com/*', delay: 3000
      }, {
        id: 'r2', name: 'contains-rule', matchType: 'contains',
        urlPattern: '/admin', delay: 3000
      }],
      buttonClickRules: []
    };
    expect(validateRegexRules(rules)).toEqual({ ok: true });
  });

  test('checks both tabCloseRules and buttonClickRules', () => {
    const rules = {
      tabCloseRules: [{
        id: 'r1', name: 'good', matchType: 'regex',
        urlPattern: '.+', delay: 3000
      }],
      buttonClickRules: [{
        id: 'r2', name: 'bad', matchType: 'regex',
        urlPattern: '[abc', selector: '#x', delay: 200
      }]
    };
    const result = validateRegexRules(rules);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('"bad"');
  });

  test('falls back to rule id when name is empty', () => {
    const rules = {
      tabCloseRules: [{
        id: 'rule-42', name: '', matchType: 'regex',
        urlPattern: '(', delay: 3000
      }],
      buttonClickRules: []
    };
    const result = validateRegexRules(rules);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('"rule-42"');
  });

  test('empty rule arrays are valid', () => {
    expect(validateRegexRules({ tabCloseRules: [], buttonClickRules: [] })).toEqual({ ok: true });
    expect(validateRegexRules({})).toEqual({ ok: true });
  });
});

// COPIED FROM options.js (validateRuleArray inline regex check, JSON-view path).
// Stripped down to just the regex-specific branch since the rest of validation
// is exercised in JSON-editor integration tests elsewhere. This locks in the
// parity between the Form save path and the JSON parse path.
function validateRuleArrayRegexBranch(parsed) {
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i];
    if (r.matchType !== 'regex') continue;
    try {
      new RegExp(r.urlPattern);
    } catch (e) {
      return { ok: false, error: `Rule at index ${i} ("${r.name || r.id || '?'}"): invalid regex pattern — ${e.message}` };
    }
  }
  return { ok: true };
}

describe('validateRuleArray — JSON-view regex branch', () => {
  test('rejects invalid regex with the index and name in the error', () => {
    const parsed = [
      { id: 'a', name: 'good', matchType: 'regex', urlPattern: '.+', delay: 3000 },
      { id: 'b', name: 'bad-one', matchType: 'regex', urlPattern: '[unclosed', delay: 3000 }
    ];
    const result = validateRuleArrayRegexBranch(parsed);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('index 1');
    expect(result.error).toContain('"bad-one"');
  });

  test('accepts an array with only valid regex rules', () => {
    const parsed = [
      { id: 'a', name: 'good', matchType: 'regex', urlPattern: '^https://.+', delay: 3000 }
    ];
    expect(validateRuleArrayRegexBranch(parsed)).toEqual({ ok: true });
  });
});
