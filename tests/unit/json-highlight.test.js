/**
 * Unit tests for the hand-rolled JSON tokenizer in json-highlight.js.
 *
 * Mirrors the project's pattern (see pattern-matching.test.js): the
 * production source doesn't export a CommonJS module, so we copy the
 * function under test into the spec. Keep in sync with json-highlight.js.
 */

const RX = /("(?:\\.|[^"\\\n])*")(\s*:)|("(?:\\.|[^"\\\n])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}\[\],:])/g;

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightJSON(text) {
  let out = '';
  let i = 0;
  let m;
  RX.lastIndex = 0;
  while ((m = RX.exec(text)) !== null) {
    if (m.index > i) out += escapeHTML(text.slice(i, m.index));
    const [whole, key, kColon, str, num, bool, nul, punct] = m;
    if (key !== undefined) {
      out += '<span class="t-key">' + escapeHTML(key) + '</span>';
      out += '<span class="t-punct">' + escapeHTML(kColon) + '</span>';
    } else if (str !== undefined) {
      out += '<span class="t-string">' + escapeHTML(str) + '</span>';
    } else if (num !== undefined) {
      out += '<span class="t-number">' + escapeHTML(num) + '</span>';
    } else if (bool !== undefined) {
      out += '<span class="t-bool">' + escapeHTML(bool) + '</span>';
    } else if (nul !== undefined) {
      out += '<span class="t-null">' + escapeHTML(nul) + '</span>';
    } else if (punct !== undefined) {
      out += '<span class="t-punct">' + escapeHTML(punct) + '</span>';
    }
    i = m.index + whole.length;
  }
  if (i < text.length) out += escapeHTML(text.slice(i));
  return out + '\n';
}

describe('highlightJSON', () => {
  test('object keys are .t-key, their colons are .t-punct', () => {
    const out = highlightJSON('{"name":"hi"}');
    expect(out).toContain('<span class="t-key">"name"</span>');
    expect(out).toContain('<span class="t-punct">:</span>');
  });

  test('regular string values are .t-string', () => {
    const out = highlightJSON('"just a string"');
    expect(out).toContain('<span class="t-string">"just a string"</span>');
  });

  test('numbers are .t-number including negative, decimal, and scientific', () => {
    expect(highlightJSON('42')).toContain('<span class="t-number">42</span>');
    expect(highlightJSON('-3.14')).toContain('<span class="t-number">-3.14</span>');
    expect(highlightJSON('1.5e-10')).toContain('<span class="t-number">1.5e-10</span>');
  });

  test('booleans are .t-bool', () => {
    expect(highlightJSON('true')).toContain('<span class="t-bool">true</span>');
    expect(highlightJSON('false')).toContain('<span class="t-bool">false</span>');
  });

  test('null is .t-null (not .t-bool)', () => {
    const out = highlightJSON('null');
    expect(out).toContain('<span class="t-null">null</span>');
    expect(out).not.toContain('t-bool');
  });

  test('punctuation: braces, brackets, commas, standalone colons', () => {
    const out = highlightJSON('{}[],:');
    expect(out).toContain('<span class="t-punct">{</span>');
    expect(out).toContain('<span class="t-punct">}</span>');
    expect(out).toContain('<span class="t-punct">[</span>');
    expect(out).toContain('<span class="t-punct">]</span>');
    expect(out).toContain('<span class="t-punct">,</span>');
  });

  test('colons inside string values are NOT punctuation', () => {
    const out = highlightJSON('"http://example.com"');
    // The whole URL stays inside one .t-string span; no t-punct for the colons.
    expect(out).toContain('<span class="t-string">"http://example.com"</span>');
    expect(out).not.toContain('<span class="t-punct">:</span>');
  });

  test('escape sequences inside strings stay inside the string token', () => {
    const out = highlightJSON('"a\\"b"');
    expect(out).toContain('<span class="t-string">"a\\"b"</span>');
  });

  test('HTML metacharacters in raw text are escaped', () => {
    const out = highlightJSON('<script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  test('whitespace and newlines are preserved verbatim', () => {
    const out = highlightJSON('{\n  "x": 1\n}');
    expect(out).toContain('\n  ');
    expect(out).toContain('<span class="t-key">"x"</span>');
    expect(out).toContain('<span class="t-number">1</span>');
  });

  test('nested objects and arrays tokenize correctly', () => {
    const out = highlightJSON('[{"a":1},{"b":[true,null]}]');
    expect(out).toContain('<span class="t-key">"a"</span>');
    expect(out).toContain('<span class="t-key">"b"</span>');
    expect(out).toContain('<span class="t-bool">true</span>');
    expect(out).toContain('<span class="t-null">null</span>');
  });

  test('invalid JSON does not throw — unrecognized fragments are escaped through', () => {
    expect(() => highlightJSON('{ this isn\'t json }')).not.toThrow();
    const out = highlightJSON('{ this isn\'t json }');
    expect(out).toContain('<span class="t-punct">{</span>');
    expect(out).toContain('<span class="t-punct">}</span>');
  });

  test('empty input returns just a trailing newline', () => {
    expect(highlightJSON('')).toBe('\n');
  });

  test('trailing newline is always appended for height alignment', () => {
    expect(highlightJSON('1').endsWith('\n')).toBe(true);
    expect(highlightJSON('{}').endsWith('\n')).toBe(true);
  });

  test('keys with whitespace before colon stay classified correctly', () => {
    const out = highlightJSON('{"x"  :  1}');
    expect(out).toContain('<span class="t-key">"x"</span>');
    expect(out).toContain('<span class="t-punct">  :</span>');
  });
});
