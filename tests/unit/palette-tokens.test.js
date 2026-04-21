/**
 * Regression tests for the palette catalog.
 *
 * These guard against accidental drift between the four surfaces that all
 * have to agree on the palette list: popup.css, options.css, content.css,
 * popup.js (theme-sync validator), options.js (VALID_PALETTES) and
 * theme-init.js (flash-prevention allowlist).
 *
 * If you add or rename a palette, update the EXPECTED list below and the
 * corresponding token file fixtures the tests check.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const EXPECTED_PALETTES = ['navy', 'moss', 'graphite', 'ember'];
const REMOVED_PALETTES = ['ocean']; // historical names that must NOT appear

describe('palette catalog — surfaces agree on the list', () => {
  test('popup.css declares every non-default palette block', () => {
    const css = read('popup.css');
    for (const pal of EXPECTED_PALETTES.filter((p) => p !== 'navy')) {
      expect(css).toMatch(new RegExp(`\\[data-palette="${pal}"\\]`));
    }
  });

  test('options.css declares every non-default palette block', () => {
    const css = read('options.css');
    for (const pal of EXPECTED_PALETTES.filter((p) => p !== 'navy')) {
      expect(css).toMatch(new RegExp(`\\[data-palette="${pal}"\\]`));
    }
  });

  test('content.css declares every non-default palette overlay block', () => {
    const css = read('content.css');
    for (const pal of EXPECTED_PALETTES.filter((p) => p !== 'navy')) {
      expect(css).toMatch(new RegExp(`\\[data-cc-palette="${pal}"\\]`));
    }
  });

  test('options.js VALID_PALETTES allowlist matches catalog', () => {
    const js = read('options.js');
    const m = js.match(/const VALID_PALETTES = \[([^\]]+)\];/);
    expect(m).not.toBeNull();
    const listed = m[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
    expect(listed.sort()).toEqual([...EXPECTED_PALETTES].sort());
  });

  test('popup.js theme-sync validator matches catalog', () => {
    const js = read('popup.js');
    // Matches the inline `const valid = [...]` inside syncTheme().
    const m = js.match(/const valid = \[([^\]]+)\];/);
    expect(m).not.toBeNull();
    const listed = m[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
    expect(listed.sort()).toEqual([...EXPECTED_PALETTES].sort());
  });

  test('theme-init.js flash-prevention allowlist matches catalog', () => {
    const js = read('theme-init.js');
    // theme-init uses an inline OR-chain for the non-default palettes.
    for (const pal of EXPECTED_PALETTES.filter((p) => p !== 'navy')) {
      expect(js).toMatch(new RegExp(`p === '${pal}'`));
    }
  });

  test('removed palettes are gone from every surface', () => {
    const surfaces = [
      'popup.css', 'options.css', 'content.css',
      'popup.js', 'options.js', 'theme-init.js',
      'options.html',
    ];
    for (const file of surfaces) {
      const text = read(file);
      for (const removed of REMOVED_PALETTES) {
        expect(text.toLowerCase()).not.toContain(removed);
      }
    }
  });
});

describe('Ember palette — token shape', () => {
  // The palette system relies on a small fixed set of CSS custom
  // properties. Missing one leaves the popup with mixed-palette tokens
  // (some inherited from :root, some overridden) — visible as broken
  // contrast on cards and buttons. These tests catch that regression.
  const REQUIRED_TOKENS = [
    '--navy', '--navy-700', '--navy-900', '--navy-rgb',
    '--cornflower', '--cornflower-600', '--cornflower-050', '--cornflower-rgb',
    '--cream', '--cream-200', '--cream-300',
  ];

  test('popup.css ember light block defines every required token', () => {
    const css = read('popup.css');
    const block = css.match(/\[data-palette="ember"\]\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    for (const token of REQUIRED_TOKENS) {
      expect(block[1]).toContain(token + ':');
    }
  });

  test('popup.css ember dark block overrides surface tokens', () => {
    const css = read('popup.css');
    const block = css.match(/\[data-palette="ember"\]\[data-theme="dark"\]\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    // Dark variants must override --white + the border family — the base
    // :root values are too pale for the dark backdrop.
    expect(block[1]).toContain('--white:');
    expect(block[1]).toContain('--border:');
  });

  test('options.html palette picker offers ember', () => {
    const html = read('options.html');
    expect(html).toMatch(/data-pal="ember"/);
    expect(html).toMatch(/>Ember</);
  });

  test('options.css defines a swatch color for the ember picker row', () => {
    const css = read('options.css');
    expect(css).toMatch(/\.pop-row\[data-pal="ember"\]\s+\.sw\s*\{[^}]*background:#[0-9A-Fa-f]{6}/);
  });
});
