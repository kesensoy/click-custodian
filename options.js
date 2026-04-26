// Options page for Click Custodian — Direction D layout
// (sidebar + grid-aligned rule rows + sticky action bar + dark mode)

// ---------- State ----------
let rules = { tabCloseRules: [], buttonClickRules: [] };
// savedSnapshot is a deep clone of `rules` at the last known on-disk state.
// `recomputeDirtyState()` compares `rules` against this baseline so that an
// edit-then-revert sequence correctly returns the page to "saved" rather than
// remaining stuck in "unsaved changes" until the user explicitly hits Save.
let savedSnapshot = { tabCloseRules: [], buttonClickRules: [] };
let hasUnsavedChanges = false;
let currentPage = 'page-close';
// currentTheme holds the raw user PREFERENCE — 'light' | 'dark' | 'auto'.
// The document's data-theme attribute is always the RESOLVED value.
let currentTheme = (() => {
  try {
    const stored = localStorage.getItem('cc-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  } catch (e) {}
  return document.documentElement.getAttribute('data-theme') || 'light';
})();
let currentPalette = document.documentElement.getAttribute('data-palette') || 'navy';
let pendingImport = null;
let pendingPlan = null;

const VALID_PALETTES = ['navy', 'moss', 'graphite', 'ember'];
const VALID_THEMES = ['light', 'dark', 'auto'];
const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

// ---------- Entry ----------
const JSON_EDITOR_PAGES = {
  'page-close': { kind: 'tabCloseRules', editorId: 'close-json-editor', listId: 'close-user-list' },
  'page-click': { kind: 'buttonClickRules', editorId: 'click-json-editor', listId: 'click-user-list' }
};
const jsonView = {
  'page-close': { mode: 'rows', dirtyInView: false, originalSerialized: '' },
  'page-click': { mode: 'rows', dirtyInView: false, originalSerialized: '' }
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  renderAll();
  attachGlobalListeners();
  attachJsonEditorListeners();
  restoreActivePage();
  markClean();
});

window.addEventListener('beforeunload', (e) => {
  const hasJsonDirty = Object.values(jsonView).some(s => s.dirtyInView);
  if (hasUnsavedChanges || hasJsonDirty) { e.preventDefault(); e.returnValue = ''; return ''; }
});

// ---------- Storage ----------
async function loadConfig() {
  const storage = await chrome.storage.sync.get(['tabCloseRules', 'buttonClickRules', 'theme', 'palette']);
  rules = {
    tabCloseRules: storage.tabCloseRules || [],
    buttonClickRules: storage.buttonClickRules || []
  };
  savedSnapshot = cloneRules(rules);
  if (VALID_THEMES.includes(storage.theme) && storage.theme !== currentTheme) {
    currentTheme = storage.theme;
    try { localStorage.setItem('cc-theme', currentTheme); } catch (e) {}
  }
  applyResolvedTheme();
  updateThemeControlUI();
  const storedPalette = VALID_PALETTES.includes(storage.palette) ? storage.palette : 'navy';
  if (storedPalette !== currentPalette) {
    currentPalette = storedPalette;
    applyPaletteAttribute(currentPalette);
    try { localStorage.setItem('cc-palette', currentPalette); } catch (e) {}
  }
  updatePalettePopoverActive();
}

function applyPaletteAttribute(palette) {
  if (palette && palette !== 'navy') {
    document.documentElement.setAttribute('data-palette', palette);
  } else {
    document.documentElement.removeAttribute('data-palette');
  }
}

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return themeMediaQuery.matches ? 'dark' : 'light';
}

function applyResolvedTheme() {
  const resolved = resolveTheme(currentTheme);
  document.documentElement.setAttribute('data-theme', resolved);
}

function setThemePreference(pref) {
  currentTheme = pref;
  try { localStorage.setItem('cc-theme', pref); } catch (e) {}
  saveTheme(pref);
  applyResolvedTheme();
  updateThemeControlUI();
}

function updateThemeControlUI() {
  const ctrl = document.querySelector('.theme-toggle');
  if (!ctrl) return;
  ctrl.querySelectorAll('.tt-btn').forEach(b => {
    const lit = b.dataset.themeSet === currentTheme;
    b.classList.toggle('is-active', lit);
    b.setAttribute('aria-checked', lit ? 'true' : 'false');
  });
}

function updatePalettePopoverActive() {
  document.querySelectorAll('.palette-popover .pop-row').forEach(row => {
    const on = row.dataset.pal === currentPalette;
    row.classList.toggle('active', on);
    row.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

async function saveConfig() {
  if (!hasUnsavedChanges) return;
  try {
    await chrome.storage.sync.set({
      tabCloseRules: rules.tabCloseRules,
      buttonClickRules: rules.buttonClickRules
    });
    savedSnapshot = cloneRules(rules);
    markClean();
    showStatus('Configuration saved', 'success');
  } catch (error) {
    showStatus('Failed to save: ' + error.message, 'error');
  }
}

async function saveTheme(theme) {
  try { await chrome.storage.sync.set({ theme }); } catch (e) {}
}

async function savePalette(palette) {
  try { await chrome.storage.sync.set({ palette }); } catch (e) {}
}

// ---------- Helpers ----------
function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clampDelay(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function generateId() {
  return 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function generateDefaultRuleName(urlPattern) {
  try {
    let cleaned = urlPattern.replace(/^\*:\/\//, '').replace(/\/\*$/g, '');
    const host = cleaned.match(/^([^\/]+)/);
    if (host) {
      let name = host[1];
      const path = cleaned.match(/^[^\/]+\/(.+)/);
      if (path && path[1]) {
        const p = path[1].replace(/\*/g, '').trim();
        if (p && p !== '/' && p !== '') name += '/' + p;
      }
      return name;
    }
    return cleaned || 'example.com';
  } catch (e) { return 'example.com'; }
}

function cloneRules(src) {
  return {
    tabCloseRules: src.tabCloseRules.map(r => ({ ...r })),
    buttonClickRules: src.buttonClickRules.map(r => ({ ...r }))
  };
}

// Structural equality for the rules payload. Array order is meaningful
// (it is the user-facing display order), so we compare positionally rather
// than sorting. Field order within a rule object is normalized via sorted
// JSON stringification so that {a:1,b:2} and {b:2,a:1} compare equal.
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

function recomputeDirtyState() {
  const dirty = !rulesEqual(rules, savedSnapshot);
  if (dirty) {
    hasUnsavedChanges = true;
    const info = document.getElementById('actionbar-info');
    const text = document.getElementById('actionbar-info-text');
    info.classList.remove('is-clean');
    text.textContent = 'unsaved changes';
    applySaveButtonState(true);
  } else {
    markClean();
  }
}

function markClean() {
  hasUnsavedChanges = false;
  const info = document.getElementById('actionbar-info');
  const text = document.getElementById('actionbar-info-text');
  info.classList.add('is-clean');
  text.textContent = 'saved';
  applySaveButtonState(false);
}

function applySaveButtonState(dirty) {
  const btn = document.getElementById('save-config');
  if (!btn) return;
  btn.classList.toggle('primary', dirty);
  btn.classList.toggle('ghost', !dirty);
  if (dirty) {
    btn.removeAttribute('aria-disabled');
  } else {
    btn.setAttribute('aria-disabled', 'true');
  }
}

function showStatus(message, type) {
  const el = document.getElementById('status-message');
  el.textContent = message;
  el.className = `status-message ${type}`;
  setTimeout(() => { el.className = 'status-message'; }, 2600);
}

// ---------- Rendering ----------
function renderAll() {
  renderCloseRules();
  renderClickRules();
  updateNavCounts();
}

function updateNavCounts() {
  document.getElementById('nav-close-count').textContent = rules.tabCloseRules.length;
  document.getElementById('nav-click-count').textContent = rules.buttonClickRules.length;
}

function pluralRules(n) { return `${n} rule${n === 1 ? '' : 's'}`; }

function renderCloseRules() {
  const list = document.getElementById('close-user-list');
  const count = document.getElementById('close-user-count');
  list.innerHTML = '';
  const arr = rules.tabCloseRules;
  if (count) count.textContent = pluralRules(arr.length);
  if (arr.length > 0) {
    list.appendChild(closeHeaderRow());
    arr.forEach((rule, index) => list.appendChild(renderUserCloseRow(rule, index)));
  }
  list.appendChild(addRow('close', 'Add a tab-close rule'));
}

function renderClickRules() {
  const list = document.getElementById('click-user-list');
  const count = document.getElementById('click-user-count');
  list.innerHTML = '';
  const arr = rules.buttonClickRules;
  if (count) count.textContent = pluralRules(arr.length);
  if (arr.length > 0) {
    list.appendChild(clickHeaderRow());
    arr.forEach((rule, index) => list.appendChild(renderUserClickRow(rule, index)));
  }
  list.appendChild(addRow('click', 'Add a button-click rule'));
}

function closeHeaderRow() {
  const row = document.createElement('div');
  row.className = 'rule-row header grid-close';
  row.innerHTML = `<span>Name</span><span>URL pattern</span><span>Match</span><span>Delay</span><span style="text-align:center">On</span><span></span>`;
  return row;
}

function clickHeaderRow() {
  const row = document.createElement('div');
  row.className = 'rule-row header grid-click';
  row.innerHTML = `<span>Name</span><span>URL pattern</span><span>Selector</span><span>Button text</span><span>Delay</span><span style="text-align:center">On</span><span></span>`;
  return row;
}

function renderUserCloseRow(rule, index) {
  const enabled = rule.enabled !== false;
  const row = document.createElement('div');
  row.className = `rule-row grid-close${enabled ? '' : ' is-disabled'}`;
  row.dataset.userIndex = String(index);
  row.dataset.kind = 'user-close';
  row.innerHTML = `
    <div class="cell-name"><input class="inline name-input" value="${escapeHTML(rule.name)}" data-field="name" /></div>
    <input class="inline" value="${escapeHTML(rule.urlPattern)}" spellcheck="false" data-field="urlPattern" />
    <select class="inline" data-field="matchType" aria-label="Match type">
      <option value="glob"${rule.matchType === 'glob' ? ' selected' : ''}>glob</option>
      <option value="regex"${rule.matchType === 'regex' ? ' selected' : ''}>regex</option>
      <option value="exact"${rule.matchType === 'exact' ? ' selected' : ''}>exact</option>
      <option value="contains"${rule.matchType === 'contains' ? ' selected' : ''}>contains</option>
    </select>
    <div class="cell-delay"><input class="inline" type="number" min="0" step="100" value="${escapeHTML(rule.delay)}" data-field="delay" /><span class="unit">ms</span></div>
    <span class="toggle${enabled ? ' on' : ''}" role="switch" aria-checked="${enabled}" tabindex="0" data-user-toggle="1"></span>
    <div class="row-actions"><button class="icon-btn danger" title="Delete rule" data-delete-user="1"><svg width="13" height="13"><use href="#i-trash"/></svg></button></div>
  `;
  return row;
}

function renderUserClickRow(rule, index) {
  const enabled = rule.enabled !== false;
  const row = document.createElement('div');
  row.className = `rule-row grid-click${enabled ? '' : ' is-disabled'}`;
  row.dataset.userIndex = String(index);
  row.dataset.kind = 'user-click';
  row.innerHTML = `
    <div class="cell-name"><input class="inline name-input" value="${escapeHTML(rule.name)}" data-field="name" /></div>
    <input class="inline" value="${escapeHTML(rule.urlPattern)}" spellcheck="false" data-field="urlPattern" />
    <input class="inline" value="${escapeHTML(rule.selector || '')}" spellcheck="false" data-field="selector" />
    <input class="inline${rule.buttonText ? '' : ' placeholder-empty'}" value="${escapeHTML(rule.buttonText || '')}" placeholder="(any)" spellcheck="false" data-field="buttonText" />
    <div class="cell-delay"><input class="inline" type="number" min="0" step="100" value="${escapeHTML(rule.delay)}" data-field="delay" /><span class="unit">ms</span></div>
    <span class="toggle${enabled ? ' on' : ''}" role="switch" aria-checked="${enabled}" tabindex="0" data-user-toggle="1"></span>
    <div class="row-actions"><button class="icon-btn danger" title="Delete rule" data-delete-user="1"><svg width="13" height="13"><use href="#i-trash"/></svg></button></div>
  `;
  return row;
}

function addRow(kind, label) {
  const el = document.createElement('div');
  el.className = 'add-row';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.dataset.addKind = kind;
  el.innerHTML = `<span class="plus"><svg width="10" height="10"><use href="#i-plus"/></svg></span>${escapeHTML(label)}<span class="kbd-hint"><kbd>N</kbd></span>`;
  return el;
}

// ---------- Event wiring ----------
function attachGlobalListeners() {
  // Nav / page switching
  document.querySelectorAll('.nav-item[data-target]').forEach(n => {
    n.addEventListener('click', () => activatePage(n.dataset.target));
  });

  // Theme toggle (three-segment: light / auto / dark)
  document.querySelectorAll('.theme-toggle [data-theme-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pref = btn.dataset.themeSet;
      if (!VALID_THEMES.includes(pref)) return;
      setThemePreference(pref);
    });
  });

  // Live-update if the OS scheme flips while we're in auto mode.
  themeMediaQuery.addEventListener('change', () => {
    if (currentTheme === 'auto') {
      applyResolvedTheme();
      updateThemeControlUI();
    }
  });

  // Palette picker popover
  const paletteTrigger = document.getElementById('palette-trigger');
  if (paletteTrigger) {
    paletteTrigger.addEventListener('click', (e) => {
      const row = e.target.closest('.pop-row[data-pal]');
      if (!row) return;
      e.preventDefault();
      const palette = row.dataset.pal;
      if (!VALID_PALETTES.includes(palette)) return;
      currentPalette = palette;
      applyPaletteAttribute(palette);
      try { localStorage.setItem('cc-palette', palette); } catch (err) {}
      savePalette(palette);
      updatePalettePopoverActive();
    });
  }

  // Action bar
  document.getElementById('save-config').addEventListener('click', saveConfig);
  document.getElementById('reset-config').addEventListener('click', resetConfig);
  document.getElementById('export-config').addEventListener('click', exportConfig);
  document.getElementById('import-config').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', importConfig);

  // Add-rule buttons (top-right of each tab)
  document.getElementById('add-close-rule').addEventListener('click', () => addCloseRule());
  document.getElementById('add-click-rule').addEventListener('click', () => addClickRule());

  // Shortcut overlay
  document.getElementById('help-btn').addEventListener('click', () => openOverlay());
  document.getElementById('overlay-close').addEventListener('click', () => closeOverlay());
  document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') closeOverlay();
  });

  // Import overlay
  document.getElementById('import-overlay-close').addEventListener('click', closeImportDialog);
  document.getElementById('import-cancel').addEventListener('click', closeImportDialog);
  document.getElementById('import-merge').addEventListener('click', () => commitImport('merge'));
  document.getElementById('import-replace').addEventListener('click', () => commitImport('replace'));
  document.getElementById('import-conflict-cancel').addEventListener('click', closeImportDialog);
  document.getElementById('import-conflict-apply').addEventListener('click', applyConflictPlan);
  document.getElementById('import-bulk-skip').addEventListener('click', () => setAllResolutions('skip'));
  document.getElementById('import-bulk-overwrite').addEventListener('click', () => setAllResolutions('overwrite'));
  const conflictList = document.getElementById('import-conflict-list');
  conflictList.addEventListener('click', handleConflictListClick);
  conflictList.addEventListener('change', handleConflictListChange);
  document.getElementById('import-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'import-overlay') closeImportDialog();
  });

  // Rule table event delegation (shared across both tabs)
  const content = document.getElementById('content');
  content.addEventListener('click', handleTableClick);
  content.addEventListener('change', handleTableChange);
  content.addEventListener('input', handleTableInput);
  content.addEventListener('keydown', handleTableKeydown);

  // Search filters
  document.querySelectorAll('input[data-search-for]').forEach(inp => {
    inp.addEventListener('input', (e) => filterRules(e.target.dataset.searchFor, e.target.value));
  });

  // Global chord / shortcut keys
  document.addEventListener('keydown', handleGlobalKeydown);

  // Deep-link support
  window.addEventListener('hashchange', () => activatePage(pageFromHash()));
}

function activatePage(pageId) {
  if (pageId !== 'page-close' && pageId !== 'page-click') pageId = 'page-close';
  currentPage = pageId;
  document.querySelectorAll('.nav-item[data-target]').forEach(n => {
    const on = n.dataset.target === pageId;
    n.classList.toggle('active', on);
    n.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.page').forEach(p => { p.hidden = p.id !== pageId; });
  const hashSlug = pageId === 'page-close' ? 'close-rules' : 'click-rules';
  if (window.location.hash !== `#${hashSlug}`) {
    history.replaceState(null, '', `#${hashSlug}`);
  }
}

function pageFromHash() {
  const h = window.location.hash.slice(1);
  if (h === 'click-rules') return 'page-click';
  return 'page-close';
}

function restoreActivePage() {
  activatePage(pageFromHash());
}

// ---------- Rule table handlers ----------
function handleTableClick(e) {
  // Toggle on a rule row
  const userToggle = e.target.closest('[data-user-toggle]');
  if (userToggle) { toggleUserRule(userToggle); return; }

  // Delete
  const del = e.target.closest('[data-delete-user]');
  if (del) { deleteUserRule(del.closest('.rule-row')); return; }

  // Add-row clicks
  const add = e.target.closest('.add-row[data-add-kind]');
  if (add) { addKindRule(add.dataset.addKind); return; }
}

function handleTableChange(e) {
  const row = e.target.closest('.rule-row');
  if (!row) return;
  const kind = row.dataset.kind;
  if (kind === 'user-close' || kind === 'user-click') {
    const field = e.target.dataset.field;
    if (!field) return;
    const index = Number(row.dataset.userIndex);
    const arr = kind === 'user-close' ? rules.tabCloseRules : rules.buttonClickRules;
    let value = e.target.value;
    if (field === 'delay') {
      value = clampDelay(value, 0, 60000, kind === 'user-close' ? 3000 : 1000);
    }
    arr[index][field] = value;
    recomputeDirtyState();
  }
}

function handleTableInput(e) {
  // Live input updates for text fields (keeps state fresh without waiting for change event)
  handleTableChange(e);
}

function handleTableKeydown(e) {
  // Space / Enter on toggle
  if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('toggle')) {
    e.preventDefault();
    e.target.click();
  }
}

function toggleUserRule(toggleEl) {
  const row = toggleEl.closest('.rule-row');
  if (!row) return;
  const kind = row.dataset.kind;
  const index = Number(row.dataset.userIndex);
  const arr = kind === 'user-close' ? rules.tabCloseRules : rules.buttonClickRules;
  const nowEnabled = !toggleEl.classList.contains('on');
  toggleEl.classList.toggle('on', nowEnabled);
  toggleEl.setAttribute('aria-checked', nowEnabled ? 'true' : 'false');
  row.classList.toggle('is-disabled', !nowEnabled);
  arr[index].enabled = nowEnabled;
  recomputeDirtyState();
}

function deleteUserRule(row) {
  if (!row) return;
  if (!confirm('Delete this rule?')) return;
  const kind = row.dataset.kind;
  const index = Number(row.dataset.userIndex);
  if (kind === 'user-close') rules.tabCloseRules.splice(index, 1);
  else if (kind === 'user-click') rules.buttonClickRules.splice(index, 1);
  recomputeDirtyState();
  renderAll();
}

function addKindRule(kind) {
  if (kind === 'close') addCloseRule();
  else if (kind === 'click') addClickRule();
}

function addCloseRule() {
  if (!ensureRowsMode('page-close')) return;
  const pattern = '*://example.com/*';
  rules.tabCloseRules.push({
    id: generateId(),
    name: generateDefaultRuleName(pattern),
    urlPattern: pattern,
    matchType: 'glob',
    enabled: true,
    delay: 3000
  });
  recomputeDirtyState();
  renderCloseRules();
  updateNavCounts();
  activatePage('page-close');
  focusLastUserRuleName('close-user-list');
}

function addClickRule() {
  if (!ensureRowsMode('page-click')) return;
  const pattern = '*://example.com/*';
  rules.buttonClickRules.push({
    id: generateId(),
    name: generateDefaultRuleName(pattern),
    urlPattern: pattern,
    matchType: 'glob',
    selector: 'button',
    buttonText: '',
    enabled: true,
    delay: 500
  });
  recomputeDirtyState();
  renderClickRules();
  updateNavCounts();
  activatePage('page-click');
  focusLastUserRuleName('click-user-list');
}

function focusLastUserRuleName(listId) {
  const list = document.getElementById(listId);
  const rows = list.querySelectorAll('.rule-row:not(.header)');
  const last = rows[rows.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const nameInput = last.querySelector('.name-input');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
  }
}

// ---------- Filter ----------
function filterRules(pageId, query) {
  const page = document.getElementById(pageId);
  if (!page) return;
  const q = query.trim().toLowerCase();
  page.querySelectorAll('.rule-row:not(.header)').forEach(row => {
    if (!q) { row.style.display = ''; return; }
    const text = row.textContent.toLowerCase();
    const inputs = Array.from(row.querySelectorAll('input, select')).map(i => (i.value || '').toLowerCase()).join(' ');
    row.style.display = (text + ' ' + inputs).includes(q) ? '' : 'none';
  });
}

// ---------- Reset / Import / Export ----------
async function resetConfig() {
  if (!confirm('Reset to defaults? This deletes your current rules and loads the bundled defaults.')) return;
  try {
    const response = await fetch(chrome.runtime.getURL('seed-examples.json'));
    const seed = await response.json();
    rules = {
      tabCloseRules: seed.tabCloseRules || [],
      buttonClickRules: seed.buttonClickRules || []
    };
    await chrome.storage.sync.set({
      tabCloseRules: rules.tabCloseRules,
      buttonClickRules: rules.buttonClickRules
    });
    savedSnapshot = cloneRules(rules);
    markClean();
    renderAll();
    refreshActiveJsonViews();
    showStatus('Reset to defaults', 'success');
  } catch (error) {
    showStatus('Failed to load examples: ' + error.message, 'error');
  }
}

function exportConfig() {
  if (hasUnsavedChanges) {
    if (!confirm('You have unsaved changes. The export will NOT include them. Continue?')) return;
  }
  const data = {
    tabCloseRules: rules.tabCloseRules,
    buttonClickRules: rules.buttonClickRules
  };
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `click-custodian-rules-${date}.json`; a.click();
  URL.revokeObjectURL(url);
  showStatus('Rules exported', 'success');
}

async function importConfig(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported.tabCloseRules) || !Array.isArray(imported.buttonClickRules)) {
      throw new Error('File must contain tabCloseRules and buttonClickRules arrays');
    }
    pendingImport = imported;
    openImportDialog(imported);
  } catch (error) {
    showStatus('Failed to parse file: ' + error.message, 'error');
  }
  e.target.value = '';
}

function openImportDialog(imported) {
  document.getElementById('import-summary').textContent =
    `Found ${imported.tabCloseRules.length} tab-close rule${imported.tabCloseRules.length === 1 ? '' : 's'} and ${imported.buttonClickRules.length} button-click rule${imported.buttonClickRules.length === 1 ? '' : 's'} in the file.`;
  document.getElementById('import-current').textContent =
    `You currently have:\n  · ${rules.tabCloseRules.length} tab-close rule${rules.tabCloseRules.length === 1 ? '' : 's'}\n  · ${rules.buttonClickRules.length} button-click rule${rules.buttonClickRules.length === 1 ? '' : 's'}`;
  const total = imported.tabCloseRules.length + imported.buttonClickRules.length;
  document.getElementById('import-merge').textContent = `Merge ${total} rule${total === 1 ? '' : 's'}`;
  document.getElementById('import-overlay').classList.add('open');
}

function closeImportDialog() {
  const overlay = document.getElementById('import-overlay');
  overlay.classList.remove('open');
  document.getElementById('import-card').classList.remove('is-conflict');
  document.getElementById('import-choice-view').hidden = false;
  document.getElementById('import-conflict-view').hidden = true;
  document.getElementById('import-title').textContent = 'Import rules';
  pendingImport = null;
  pendingPlan = null;
}

// URL-first dedup signature:
// - tab-close: urlPattern
// - button-click: urlPattern + selector + buttonText (selector+text scope WHICH button)
// matchType is NOT part of the signature — same URL with different match type collides.
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

function commitImport(mode) {
  if (!pendingImport) return;
  if (mode === 'replace') {
    const existingTotal = rules.tabCloseRules.length + rules.buttonClickRules.length;
    if (existingTotal > 0) {
      if (!confirm(`This deletes your ${existingTotal} existing rule${existingTotal === 1 ? '' : 's'}. Continue?`)) return;
    }
    rules.tabCloseRules = pendingImport.tabCloseRules;
    rules.buttonClickRules = pendingImport.buttonClickRules;
    finishImport('replaced');
    return;
  }
  // mode === 'merge'
  const plan = buildConflictPlan(pendingImport, rules);
  if (plan.conflicts.length === 0) {
    appendAdditions(plan.additions);
    const added = plan.additions.tabCloseRules.length + plan.additions.buttonClickRules.length;
    const counts = { added };
    if (plan.identicals.length > 0) counts.identical = plan.identicals.length;
    finishImport('merged', counts);
    return;
  }
  pendingPlan = plan;
  showConflictView(plan);
}

function appendAdditions(additions) {
  rules.tabCloseRules.push(...additions.tabCloseRules.map(r => ({ ...r, id: generateId() })));
  rules.buttonClickRules.push(...additions.buttonClickRules.map(r => ({ ...r, id: generateId() })));
}

function finishImport(verb, counts) {
  recomputeDirtyState();
  renderAll();
  refreshActiveJsonViews();
  closeImportDialog();
  let msg = `Rules ${verb} — remember to save`;
  if (counts) {
    const parts = [];
    if (counts.added != null) parts.push(`${counts.added} added`);
    if (counts.overwritten != null) parts.push(`${counts.overwritten} overwritten`);
    if (counts.skipped != null) parts.push(`${counts.skipped} skipped`);
    if (counts.identical != null) parts.push(`${counts.identical} identical skipped`);
    if (parts.length) msg = `Rules ${verb} (${parts.join(', ')}) — remember to save`;
  }
  showStatus(msg, 'success');
}

function showConflictView(plan) {
  document.getElementById('import-card').classList.add('is-conflict');
  document.getElementById('import-choice-view').hidden = true;
  document.getElementById('import-conflict-view').hidden = false;
  document.getElementById('import-title').textContent = 'Resolve conflicts';
  const n = plan.conflicts.length;
  const addCount = plan.additions.tabCloseRules.length + plan.additions.buttonClickRules.length;
  const summaryParts = [`${n} imported rule${n === 1 ? '' : 's'} differ${n === 1 ? 's' : ''} from an existing rule with the same URL.`];
  if (addCount > 0) summaryParts.push(`${addCount} new rule${addCount === 1 ? '' : 's'} will be added regardless.`);
  document.getElementById('import-conflict-summary').textContent = summaryParts.join(' ');
  renderIdenticalBanner(plan.identicals);
  const list = document.getElementById('import-conflict-list');
  list.innerHTML = plan.conflicts.map((c, i) => renderConflictRow(c, i)).join('');
  document.getElementById('import-bulk-skip').classList.remove('is-active');
  document.getElementById('import-bulk-overwrite').classList.remove('is-active');
}

function renderIdenticalBanner(identicals) {
  const banner = document.getElementById('import-identical-banner');
  if (!banner) return;
  if (!identicals || identicals.length === 0) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  banner.hidden = false;
  const n = identicals.length;
  const items = identicals.map(({ existing, kind }) => {
    const k = kind === 'tabClose' ? 'Tab close' : 'Button click';
    const name = existing.name || '(unnamed)';
    return `<li><span class="cc-kind">${escapeHTML(k)}</span> <span class="cc-name">${escapeHTML(name)}</span> <span class="cc-trigger">${escapeHTML(existing.urlPattern || '')}</span></li>`;
  }).join('');
  banner.innerHTML = `
    <details>
      <summary>${n} imported rule${n === 1 ? ' is' : 's are'} byte-identical to existing rule${n === 1 ? '' : 's'} — will be skipped.</summary>
      <div class="cc-identical-actions">
        <button class="btn ghost sm" id="import-identical-force" type="button">Import anyway as duplicate${n === 1 ? '' : 's'}</button>
      </div>
      <ul class="cc-identical-list">${items}</ul>
    </details>`;
  const forceBtn = document.getElementById('import-identical-force');
  if (forceBtn) forceBtn.addEventListener('click', forceImportIdenticals);
}

function forceImportIdenticals() {
  if (!pendingPlan || pendingPlan.identicals.length === 0) return;
  for (const { kind, incoming } of pendingPlan.identicals) {
    const bucket = kind === 'tabClose'
      ? pendingPlan.additions.tabCloseRules
      : pendingPlan.additions.buttonClickRules;
    bucket.push(incoming);
  }
  pendingPlan.identicals = [];
  renderIdenticalBanner(pendingPlan.identicals);
}

function renderConflictRow(conflict, idx) {
  const kindLabel = conflict.kind === 'tabClose' ? 'Tab close' : 'Button click';
  const trigger = describeTrigger(conflict.incoming, conflict.kind);
  const diffSet = new Set(conflict.diff || []);
  return `
    <div class="import-conflict-row" data-idx="${idx}" data-resolution="${escapeHTML(conflict.resolution)}">
      <div class="cc-meta">
        <span class="cc-kind">${escapeHTML(kindLabel)}</span>
        <span class="cc-trigger">${escapeHTML(trigger)}</span>
      </div>
      <div class="cc-versions">
        ${renderConflictSide('existing', 'skip', 'Existing', conflict.existing, conflict.kind, diffSet, conflict.resolution, idx)}
        ${renderConflictSide('incoming', 'overwrite', 'Incoming', conflict.incoming, conflict.kind, diffSet, conflict.resolution, idx)}
      </div>
      <div class="cc-toggle" role="radiogroup" aria-label="${escapeHTML(kindLabel)} conflict resolution">
        <label><input type="radio" name="cc-res-${idx}" value="skip" ${conflict.resolution === 'skip' ? 'checked' : ''}> Skip</label>
        <label><input type="radio" name="cc-res-${idx}" value="overwrite" ${conflict.resolution === 'overwrite' ? 'checked' : ''}> Overwrite</label>
      </div>
    </div>`;
}

function renderConflictSide(slot, value, label, rule, kind, diffSet, resolution, idx) {
  const cls = (field) => diffSet.has(field) ? 'cc-field is-diff' : 'cc-field';
  const isSelected = resolution === value;
  const name = rule.name || '(unnamed)';
  const matchType = fieldValue(rule, 'matchType');
  const delay = fieldValue(rule, 'delay');
  const enabled = fieldValue(rule, 'enabled');
  const delayLabel = kind === 'tabClose' ? `${delay}ms countdown` : `${delay}ms delay`;
  const enabledLabel = enabled ? 'enabled' : 'disabled';
  return `
    <button type="button"
            class="cc-side cc-${slot} ${isSelected ? 'is-selected' : ''}"
            data-cc-res-target="${idx}"
            data-cc-res-value="${value}"
            aria-pressed="${isSelected}">
      <span class="cc-label">${escapeHTML(label)}</span>
      <span class="cc-name ${diffSet.has('name') ? 'is-diff' : ''}">${escapeHTML(name)}</span>
      <div class="cc-fields">
        <span class="${cls('matchType')}">${escapeHTML(matchType)}</span>
        <span class="cc-sep">·</span>
        <span class="${cls('delay')}">${escapeHTML(delayLabel)}</span>
        <span class="cc-sep">·</span>
        <span class="${cls('enabled')}">${escapeHTML(enabledLabel)}</span>
      </div>
    </button>`;
}

function describeTrigger(rule, kind) {
  const url = rule.urlPattern || '(no pattern)';
  if (kind === 'buttonClick') {
    const sel = rule.selector ? ` · ${rule.selector}` : '';
    const txt = rule.buttonText ? ` · "${rule.buttonText}"` : '';
    return url + sel + txt;
  }
  return url;
}

function setRowResolution(idx, value) {
  const list = document.getElementById('import-conflict-list');
  const row = list.querySelector(`.import-conflict-row[data-idx="${idx}"]`);
  if (!row) return;
  row.dataset.resolution = value;
  list.querySelectorAll(`input[name="cc-res-${idx}"]`).forEach(input => {
    input.checked = input.value === value;
  });
  row.querySelectorAll('.cc-side').forEach(side => {
    const isSel = side.dataset.ccResValue === value;
    side.classList.toggle('is-selected', isSel);
    side.setAttribute('aria-pressed', String(isSel));
  });
  updateBulkActiveState();
}

function updateBulkActiveState() {
  const list = document.getElementById('import-conflict-list');
  const skipBtn = document.getElementById('import-bulk-skip');
  const overwriteBtn = document.getElementById('import-bulk-overwrite');
  if (!list || !skipBtn || !overwriteBtn) return;
  const rows = list.querySelectorAll('.import-conflict-row');
  let allSkip = rows.length > 0;
  let allOverwrite = rows.length > 0;
  rows.forEach(row => {
    const res = row.dataset.resolution;
    if (res !== 'skip') allSkip = false;
    if (res !== 'overwrite') allOverwrite = false;
  });
  skipBtn.classList.toggle('is-active', allSkip);
  overwriteBtn.classList.toggle('is-active', allOverwrite);
}

function handleConflictListClick(e) {
  const sideBtn = e.target.closest('.cc-side[data-cc-res-target]');
  if (!sideBtn) return;
  e.preventDefault();
  setRowResolution(sideBtn.dataset.ccResTarget, sideBtn.dataset.ccResValue);
}

function handleConflictListChange(e) {
  const radio = e.target.closest('input[type="radio"][name^="cc-res-"]');
  if (!radio || !radio.checked) return;
  const idx = radio.name.replace('cc-res-', '');
  setRowResolution(idx, radio.value);
}

function setAllResolutions(value) {
  if (!pendingPlan) return;
  pendingPlan.conflicts.forEach((_, i) => setRowResolution(i, value));
}

function applyConflictPlan() {
  if (!pendingPlan) return;
  const list = document.getElementById('import-conflict-list');
  pendingPlan.conflicts.forEach((c, i) => {
    const checked = list.querySelector(`input[name="cc-res-${i}"]:checked`);
    c.resolution = checked ? checked.value : 'skip';
  });
  let overwritten = 0;
  let skipped = 0;
  for (const c of pendingPlan.conflicts) {
    if (c.resolution === 'overwrite') {
      const arr = c.kind === 'tabClose' ? rules.tabCloseRules : rules.buttonClickRules;
      const idx = arr.findIndex(r => r.id === c.existing.id);
      if (idx >= 0) {
        arr[idx] = { ...c.incoming, id: c.existing.id };
        overwritten++;
      }
    } else {
      skipped++;
    }
  }
  appendAdditions(pendingPlan.additions);
  const added = pendingPlan.additions.tabCloseRules.length + pendingPlan.additions.buttonClickRules.length;
  finishImport('merged', { added, overwritten, skipped });
}

// ---------- Overlay ----------
function openOverlay() { document.getElementById('overlay').classList.add('open'); }
function closeOverlay() { document.getElementById('overlay').classList.remove('open'); }

// ---------- Global keys (chord + shortcuts) ----------
let gPending = false;
let gTimer = null;

function handleGlobalKeydown(e) {
  const tag = (e.target && e.target.tagName) || '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Cmd/Ctrl+S saves regardless of focus
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (hasUnsavedChanges) saveConfig();
    return;
  }

  if (e.key === 'Escape') {
    if (document.getElementById('overlay').classList.contains('open')) closeOverlay();
    else if (document.getElementById('import-overlay').classList.contains('open')) closeImportDialog();
    else if (typing && e.target.blur) e.target.blur();
    return;
  }

  if (typing) return;

  if (e.key === '?') { e.preventDefault(); openOverlay(); return; }
  if (e.key === '/') {
    e.preventDefault();
    const currentSearch = document.querySelector(`input[data-search-for="${currentPage}"]`);
    if (currentSearch) currentSearch.focus();
    return;
  }
  if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (currentPage === 'page-close') addCloseRule();
    else addClickRule();
    return;
  }
  if (e.key.toLowerCase() === 'g' && !gPending) {
    gPending = true;
    clearTimeout(gTimer);
    gTimer = setTimeout(() => { gPending = false; }, 900);
    return;
  }
  if (gPending) {
    const k = e.key.toLowerCase();
    if (k === 'c') activatePage('page-close');
    else if (k === 'b') activatePage('page-click');
    gPending = false;
    clearTimeout(gTimer);
  }
}

// ---------- JSON editor ----------
function attachJsonEditorListeners() {
  document.querySelectorAll('.view-toggle[data-view-for]').forEach(wrap => {
    const pageId = wrap.dataset.viewFor;
    wrap.querySelectorAll('[data-view-set]').forEach(btn => {
      btn.addEventListener('click', () => setViewMode(pageId, btn.dataset.viewSet));
    });
  });

  Object.entries(JSON_EDITOR_PAGES).forEach(([pageId, cfg]) => {
    const editor = document.getElementById(cfg.editorId);
    if (!editor) return;
    const textarea = editor.querySelector('[data-role="textarea"]');
    const applyBtn = editor.querySelector('[data-role="apply"]');
    const discardBtn = editor.querySelector('[data-role="discard"]');

    textarea.addEventListener('input', () => {
      const state = jsonView[pageId];
      state.dirtyInView = textarea.value !== state.originalSerialized;
      updateJsonStatus(editor, state.dirtyInView);
      livePreviewJson(editor, textarea.value);
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = textarea.selectionStart, end = textarea.selectionEnd;
        textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = s + 2;
        textarea.dispatchEvent(new Event('input'));
      }
    });

    applyBtn.addEventListener('click', () => applyJson(pageId));
    discardBtn.addEventListener('click', () => {
      const state = jsonView[pageId];
      if (state.dirtyInView && !confirm('Discard unapplied JSON edits?')) return;
      resetTextareaFromRules(pageId);
    });
  });
}

function setViewMode(pageId, mode) {
  const cfg = JSON_EDITOR_PAGES[pageId];
  if (!cfg) return;
  const state = jsonView[pageId];
  if (state.mode === mode) return;

  if (state.mode === 'json' && state.dirtyInView) {
    if (!confirm('Discard unapplied JSON edits?')) return;
    state.dirtyInView = false;
  }

  state.mode = mode;

  const page = document.getElementById(pageId);
  const list = document.getElementById(cfg.listId);
  const editor = document.getElementById(cfg.editorId);

  page.querySelectorAll('.view-toggle[data-view-for="' + pageId + '"] .vt-btn').forEach(btn => {
    const on = btn.dataset.viewSet === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  });

  if (mode === 'json') {
    list.hidden = true;
    editor.hidden = false;
    resetTextareaFromRules(pageId);
  } else {
    editor.hidden = true;
    list.hidden = false;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function ensureRowsMode(pageId) {
  const state = jsonView[pageId];
  if (!state || state.mode === 'rows') return true;
  if (state.dirtyInView && !confirm('Discard unapplied JSON edits?')) return false;
  setViewMode(pageId, 'rows');
  return true;
}

function resetTextareaFromRules(pageId) {
  const cfg = JSON_EDITOR_PAGES[pageId];
  const editor = document.getElementById(cfg.editorId);
  const textarea = editor.querySelector('[data-role="textarea"]');
  const serialized = JSON.stringify(rules[cfg.kind], null, 2);
  textarea.value = serialized;
  jsonView[pageId].originalSerialized = serialized;
  jsonView[pageId].dirtyInView = false;
  clearJsonError(editor);
  updateJsonStatus(editor, false);
}

function refreshActiveJsonViews() {
  Object.keys(JSON_EDITOR_PAGES).forEach(pageId => {
    if (jsonView[pageId].mode === 'json') resetTextareaFromRules(pageId);
  });
}

function updateJsonStatus(editor, dirty) {
  const el = editor.querySelector('[data-role="status"]');
  if (!el) return;
  if (dirty) { el.textContent = 'unapplied'; el.classList.add('is-dirty'); }
  else { el.textContent = ''; el.classList.remove('is-dirty'); }
}

function livePreviewJson(editor, text) {
  try {
    JSON.parse(text);
    clearJsonError(editor);
  } catch (err) {
    showJsonError(editor, formatParseError(err, text));
  }
}

function clearJsonError(editor) {
  const err = editor.querySelector('[data-role="error"]');
  err.hidden = true;
  err.textContent = '';
  editor.classList.remove('is-invalid');
  const apply = editor.querySelector('[data-role="apply"]');
  apply.removeAttribute('aria-disabled');
}

function showJsonError(editor, message) {
  const err = editor.querySelector('[data-role="error"]');
  err.textContent = message;
  err.hidden = false;
  editor.classList.add('is-invalid');
  const apply = editor.querySelector('[data-role="apply"]');
  apply.setAttribute('aria-disabled', 'true');
}

function formatParseError(err, text) {
  const msg = err.message || String(err);
  const posMatch = msg.match(/position\s+(\d+)/i);
  if (posMatch) {
    const pos = Number(posMatch[1]);
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - (before.lastIndexOf('\n') + 1) + 1;
    return `${msg}\n→ line ${line}, column ${col}`;
  }
  return msg;
}

function applyJson(pageId) {
  const cfg = JSON_EDITOR_PAGES[pageId];
  const editor = document.getElementById(cfg.editorId);
  if (editor.querySelector('[data-role="apply"]').getAttribute('aria-disabled') === 'true') return;
  const textarea = editor.querySelector('[data-role="textarea"]');

  let parsed;
  try {
    parsed = JSON.parse(textarea.value);
  } catch (err) {
    showJsonError(editor, formatParseError(err, textarea.value));
    return;
  }

  const result = validateRuleArray(parsed, cfg.kind);
  if (!result.ok) {
    showJsonError(editor, result.error);
    return;
  }

  const normalized = result.value;
  const otherKind = cfg.kind === 'tabCloseRules' ? 'buttonClickRules' : 'tabCloseRules';
  ensureUniqueIds(normalized, rules[otherKind]);
  rules[cfg.kind] = normalized;

  if (cfg.kind === 'tabCloseRules') renderCloseRules();
  else renderClickRules();
  updateNavCounts();

  resetTextareaFromRules(pageId);
  recomputeDirtyState();
  showStatus('JSON applied — remember to save', 'success');
}

function validateRuleArray(parsed, kind) {
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Expected an array of rule objects at the top level.' };
  }
  const isClick = kind === 'buttonClickRules';
  const required = isClick
    ? ['id', 'name', 'urlPattern', 'matchType', 'selector', 'delay']
    : ['id', 'name', 'urlPattern', 'matchType', 'delay'];
  const validMatch = ['glob', 'regex', 'exact', 'contains'];
  const normalized = [];
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, error: `Rule at index ${i}: expected object, got ${Array.isArray(r) ? 'array' : typeof r}.` };
    }
    for (const f of required) {
      if (!(f in r)) {
        return { ok: false, error: `Rule at index ${i} ("${r.name || '?'}"): missing required field "${f}".` };
      }
    }
    if (typeof r.id !== 'string' || !r.id) {
      return { ok: false, error: `Rule at index ${i}: "id" must be a non-empty string.` };
    }
    if (typeof r.name !== 'string') {
      return { ok: false, error: `Rule at index ${i}: "name" must be a string.` };
    }
    if (typeof r.urlPattern !== 'string') {
      return { ok: false, error: `Rule at index ${i}: "urlPattern" must be a string.` };
    }
    if (!validMatch.includes(r.matchType)) {
      return { ok: false, error: `Rule at index ${i}: "matchType" must be one of ${validMatch.join(', ')} (got "${r.matchType}").` };
    }
    if (isClick && typeof r.selector !== 'string') {
      return { ok: false, error: `Rule at index ${i}: "selector" must be a string.` };
    }
    const delay = Number(r.delay);
    if (!Number.isFinite(delay)) {
      return { ok: false, error: `Rule at index ${i}: "delay" must be a number.` };
    }
    const item = {
      ...r,
      delay: clampDelay(delay, 0, 60000, isClick ? 1000 : 3000),
      enabled: r.enabled !== false
    };
    if (isClick && !('buttonText' in item)) item.buttonText = '';
    normalized.push(item);
  }
  const seen = new Set();
  for (const r of normalized) {
    if (seen.has(r.id)) r.id = generateId();
    seen.add(r.id);
  }
  return { ok: true, value: normalized };
}

function ensureUniqueIds(newArr, otherArr) {
  const otherIds = new Set(otherArr.map(r => r.id));
  for (const r of newArr) {
    if (otherIds.has(r.id)) r.id = generateId();
  }
}
