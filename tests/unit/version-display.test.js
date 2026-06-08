/**
 * Unit tests for the manifest-driven version display added in v1.5.2.
 *
 * Both the popup (status footer) and the settings page (sidebar brand subtitle)
 * render a clickable version read live from `chrome.runtime.getManifest()`, so
 * the shown string can never drift from manifest.json. These tests pin the
 * formatting + reveal/hide contract for both surfaces.
 *
 * COPIED FROM popup.js / options.js for testing (per project convention — see
 * tests/unit/pattern-matching.test.js for the canonical pattern).
 */

// ---- copied verbatim from popup.js ----
function renderVersionPopup() {
  const el = document.getElementById('version-link');
  if (!el) return;
  const version = chrome.runtime?.getManifest?.()?.version ?? '';
  el.textContent = version ? `v${version}` : '';
  el.hidden = !version;
  const label = version ? `Click Custodian v${version} on GitHub` : 'Click Custodian on GitHub';
  el.setAttribute('aria-label', label);
  el.setAttribute('title', label);
}

// ---- copied verbatim from options.js ----
function renderVersionSettings() {
  const el = document.getElementById('settings-version-link');
  if (!el) return;
  const wrap = el.closest('.brand-sub-version');
  const version = chrome.runtime?.getManifest?.()?.version ?? '';
  if (!version) { if (wrap) wrap.hidden = true; return; }
  el.textContent = `v${version}`;
  const label = `Click Custodian v${version} on GitHub`;
  el.setAttribute('aria-label', label);
  el.setAttribute('title', label);
  if (wrap) wrap.hidden = false;
}

function mockManifestVersion(version) {
  global.chrome = { runtime: { getManifest: () => ({ version }) } };
}

afterEach(() => {
  delete global.chrome;
  document.body.innerHTML = '';
});

describe('popup version link (#version-link)', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<a class="ver-link" id="version-link" href="https://github.com/kesensoy/click-custodian" hidden></a>';
  });

  test('with a manifest version: renders "v<version>", reveals, labels for a11y', () => {
    mockManifestVersion('1.5.2');
    renderVersionPopup();
    const el = document.getElementById('version-link');
    expect(el.textContent).toBe('v1.5.2');
    expect(el.hidden).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Click Custodian v1.5.2 on GitHub');
    expect(el.getAttribute('title')).toBe('Click Custodian v1.5.2 on GitHub');
  });

  test('reflects whatever the manifest reports (no hardcoded string)', () => {
    mockManifestVersion('2.0.0');
    renderVersionPopup();
    expect(document.getElementById('version-link').textContent).toBe('v2.0.0');
  });

  test('chrome.runtime / getManifest unavailable (what the optional chaining guards): hides, empty text, generic label', () => {
    global.chrome = {}; // extension pages always have `chrome`; runtime may be absent
    renderVersionPopup();
    const el = document.getElementById('version-link');
    expect(el.textContent).toBe('');
    expect(el.hidden).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Click Custodian on GitHub');
  });

  test('missing element: no throw', () => {
    document.body.innerHTML = '';
    mockManifestVersion('1.5.2');
    expect(() => renderVersionPopup()).not.toThrow();
  });
});

describe('settings version link (#settings-version-link)', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div class="brand-sub">settings' +
      '<span class="brand-sub-version" hidden> &middot; ' +
      '<a class="cc-ver" id="settings-version-link" href="https://github.com/kesensoy/click-custodian"></a>' +
      '</span></div>';
  });

  test('with a manifest version: fills the link, reveals the " · vX.Y.Z" fragment, labels it', () => {
    mockManifestVersion('1.5.2');
    renderVersionSettings();
    const el = document.getElementById('settings-version-link');
    const wrap = document.querySelector('.brand-sub-version');
    expect(el.textContent).toBe('v1.5.2');
    expect(wrap.hidden).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Click Custodian v1.5.2 on GitHub');
    expect(el.getAttribute('title')).toBe('Click Custodian v1.5.2 on GitHub');
  });

  test('chrome.runtime / getManifest unavailable: leaves the fragment hidden and the link empty', () => {
    global.chrome = {}; // extension pages always have `chrome`; runtime may be absent
    renderVersionSettings();
    const el = document.getElementById('settings-version-link');
    const wrap = document.querySelector('.brand-sub-version');
    expect(el.textContent).toBe('');
    expect(wrap.hidden).toBe(true);
  });

  test('missing element: no throw', () => {
    document.body.innerHTML = '';
    mockManifestVersion('1.5.2');
    expect(() => renderVersionSettings()).not.toThrow();
  });
});
