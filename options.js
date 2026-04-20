// Options page for Click Custodian — Direction D layout
// (sidebar + grid-aligned rule rows + sticky action bar + dark mode)

// ---------- State ----------
let rules = { tabCloseRules: [], buttonClickRules: [] };
let hasUnsavedChanges = false;
let currentPage = 'page-close';
let currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
let currentPalette = document.documentElement.getAttribute('data-palette') || 'navy';
let pendingImport = null;

const VALID_PALETTES = ['navy', 'moss', 'graphite', 'ocean'];

// ---------- Entry ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  renderAll();
  attachGlobalListeners();
  restoreActivePage();
});

window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; return ''; }
});

// ---------- Storage ----------
async function loadConfig() {
  const storage = await chrome.storage.sync.get(['tabCloseRules', 'buttonClickRules', 'theme', 'palette']);
  rules = {
    tabCloseRules: storage.tabCloseRules || [],
    buttonClickRules: storage.buttonClickRules || []
  };
  if (storage.theme && storage.theme !== currentTheme) {
    currentTheme = storage.theme;
    document.documentElement.setAttribute('data-theme', currentTheme);
    try { localStorage.setItem('cc-theme', currentTheme); } catch (e) {}
  }
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

function updatePalettePopoverActive() {
  document.querySelectorAll('.palette-popover .pop-row').forEach(row => {
    const on = row.dataset.pal === currentPalette;
    row.classList.toggle('active', on);
    row.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

async function saveConfig() {
  try {
    await chrome.storage.sync.set({
      tabCloseRules: rules.tabCloseRules,
      buttonClickRules: rules.buttonClickRules
    });
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

function markDirty() {
  hasUnsavedChanges = true;
  const info = document.getElementById('actionbar-info');
  const text = document.getElementById('actionbar-info-text');
  info.classList.remove('is-clean');
  text.textContent = 'unsaved changes';
}

function markClean() {
  hasUnsavedChanges = false;
  const info = document.getElementById('actionbar-info');
  const text = document.getElementById('actionbar-info-text');
  info.classList.add('is-clean');
  text.textContent = 'saved';
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

  // Theme toggle
  document.querySelectorAll('.tt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.themeSet;
      document.documentElement.setAttribute('data-theme', theme);
      currentTheme = theme;
      try { localStorage.setItem('cc-theme', theme); } catch (e) {}
      saveTheme(theme);
    });
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
    markDirty();
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
  markDirty();
}

function deleteUserRule(row) {
  if (!row) return;
  if (!confirm('Delete this rule?')) return;
  const kind = row.dataset.kind;
  const index = Number(row.dataset.userIndex);
  if (kind === 'user-close') rules.tabCloseRules.splice(index, 1);
  else if (kind === 'user-click') rules.buttonClickRules.splice(index, 1);
  markDirty();
  renderAll();
}

function addKindRule(kind) {
  if (kind === 'close') addCloseRule();
  else if (kind === 'click') addClickRule();
}

function addCloseRule() {
  const pattern = '*://example.com/*';
  rules.tabCloseRules.push({
    id: generateId(),
    name: generateDefaultRuleName(pattern),
    urlPattern: pattern,
    matchType: 'glob',
    enabled: true,
    delay: 3000
  });
  markDirty();
  renderCloseRules();
  updateNavCounts();
  activatePage('page-close');
  focusLastUserRuleName('close-user-list');
}

function addClickRule() {
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
  markDirty();
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
    markClean();
    renderAll();
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
  document.getElementById('import-merge').textContent = `Merge — add ${total} rule${total === 1 ? '' : 's'}`;
  document.getElementById('import-overlay').classList.add('open');
}

function closeImportDialog() {
  document.getElementById('import-overlay').classList.remove('open');
  pendingImport = null;
}

function commitImport(mode) {
  if (!pendingImport) return;
  if (mode === 'merge') {
    const reIded = {
      tabCloseRules: pendingImport.tabCloseRules.map(r => ({ ...r, id: generateId() })),
      buttonClickRules: pendingImport.buttonClickRules.map(r => ({ ...r, id: generateId() }))
    };
    rules.tabCloseRules.push(...reIded.tabCloseRules);
    rules.buttonClickRules.push(...reIded.buttonClickRules);
  } else if (mode === 'replace') {
    const existingTotal = rules.tabCloseRules.length + rules.buttonClickRules.length;
    if (existingTotal > 0) {
      if (!confirm(`This deletes your ${existingTotal} existing rule${existingTotal === 1 ? '' : 's'}. Continue?`)) return;
    }
    rules.tabCloseRules = pendingImport.tabCloseRules;
    rules.buttonClickRules = pendingImport.buttonClickRules;
  }
  markDirty();
  renderAll();
  closeImportDialog();
  showStatus(`Rules ${mode === 'merge' ? 'merged' : 'replaced'} — remember to save`, 'success');
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
