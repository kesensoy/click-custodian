// Options page for Click Custodian — Direction D layout
// (sidebar + grid-aligned rule rows + sticky action bar + dark mode)

// ---------- State ----------
let defaultRules = { tabCloseRules: [], buttonClickRules: [] };
let userRules = { tabCloseRules: [], buttonClickRules: [] };
let defaultRulesEnabled = {};
let hasUnsavedChanges = false;
let currentPage = 'page-close';
let currentTheme = document.documentElement.getAttribute('data-theme') || 'light';

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
  const storage = await chrome.storage.sync.get(['defaultRules', 'userRules', 'defaultRulesEnabled', 'theme']);
  defaultRules = storage.defaultRules || { tabCloseRules: [], buttonClickRules: [] };
  userRules = storage.userRules || { tabCloseRules: [], buttonClickRules: [] };
  defaultRulesEnabled = storage.defaultRulesEnabled || {};
  if (storage.theme && storage.theme !== currentTheme) {
    currentTheme = storage.theme;
    document.documentElement.setAttribute('data-theme', currentTheme);
    try { localStorage.setItem('cc-theme', currentTheme); } catch (e) {}
  }
}

async function saveConfig() {
  try {
    await chrome.storage.sync.set({ userRules, defaultRulesEnabled });
    markClean();
    showStatus('Configuration saved', 'success');
  } catch (error) {
    showStatus('Failed to save: ' + error.message, 'error');
  }
}

async function saveTheme(theme) {
  try { await chrome.storage.sync.set({ theme }); } catch (e) {}
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
  const closeCount = defaultRules.tabCloseRules.length + userRules.tabCloseRules.length;
  const clickCount = defaultRules.buttonClickRules.length + userRules.buttonClickRules.length;
  document.getElementById('nav-close-count').textContent = closeCount;
  document.getElementById('nav-click-count').textContent = clickCount;
}

function pluralRules(n) { return `${n} rule${n === 1 ? '' : 's'}`; }

function renderCloseRules() {
  const defList = document.getElementById('close-default-list');
  const usrList = document.getElementById('close-user-list');
  const defHead = document.getElementById('close-default-head');
  const defCount = document.getElementById('close-default-count');
  const usrCount = document.getElementById('close-user-count');

  // Default rules
  defList.innerHTML = '';
  const defaults = defaultRules.tabCloseRules;
  defCount.textContent = pluralRules(defaults.length);
  if (defaults.length === 0) {
    defHead.style.display = 'none';
    defList.style.display = 'none';
  } else {
    defHead.style.display = '';
    defList.style.display = '';
    defList.appendChild(closeHeaderRow());
    defaults.forEach(rule => defList.appendChild(renderDefaultCloseRow(rule)));
  }

  // User rules
  usrList.innerHTML = '';
  const users = userRules.tabCloseRules;
  usrCount.textContent = pluralRules(users.length);
  if (users.length > 0) {
    usrList.appendChild(closeHeaderRow());
    users.forEach((rule, index) => usrList.appendChild(renderUserCloseRow(rule, index)));
  }
  usrList.appendChild(addRow('close', 'Add a tab-close rule'));
}

function renderClickRules() {
  const defList = document.getElementById('click-default-list');
  const usrList = document.getElementById('click-user-list');
  const defHead = document.getElementById('click-default-head');
  const defCount = document.getElementById('click-default-count');
  const usrCount = document.getElementById('click-user-count');

  // Default rules — may be 0, in which case show the "none ship by default" note
  defList.innerHTML = '';
  const defaults = defaultRules.buttonClickRules;
  defCount.textContent = pluralRules(defaults.length);
  defHead.style.display = '';
  defList.style.display = '';
  if (defaults.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-default';
    empty.textContent = '// no built-in button-click rules ship with the extension';
    defList.appendChild(empty);
  } else {
    defList.appendChild(clickHeaderRow());
    defaults.forEach(rule => defList.appendChild(renderDefaultClickRow(rule)));
  }

  // User rules
  usrList.innerHTML = '';
  const users = userRules.buttonClickRules;
  usrCount.textContent = pluralRules(users.length);
  if (users.length > 0) {
    usrList.appendChild(clickHeaderRow());
    users.forEach((rule, index) => usrList.appendChild(renderUserClickRow(rule, index)));
  }
  usrList.appendChild(addRow('click', 'Add a button-click rule'));
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

function renderDefaultCloseRow(rule) {
  const enabled = defaultRulesEnabled[rule.id] !== false;
  const row = document.createElement('div');
  row.className = `rule-row grid-close is-default${enabled ? '' : ' is-disabled'}`;
  row.dataset.defaultId = rule.id;
  row.dataset.kind = 'default-close';
  row.innerHTML = `
    <div class="cell-name"><span class="pill pill-builtin"><svg><use href="#i-star"/></svg>Built-in</span><span class="nm">${escapeHTML(rule.name)}</span></div>
    <input class="inline" readonly value="${escapeHTML(rule.urlPattern)}" />
    <span><span class="pill pill-match">${escapeHTML(rule.matchType)}</span></span>
    <div class="cell-delay"><input class="inline" readonly value="${escapeHTML(rule.delay)}" /><span class="unit">ms</span></div>
    <span class="toggle${enabled ? ' on' : ''}" role="switch" aria-checked="${enabled}" tabindex="0" data-default-toggle="${escapeHTML(rule.id)}"></span>
    <div class="row-actions"><button class="icon-btn" title="Locked — built-in rule"><svg width="13" height="13"><use href="#i-lock"/></svg></button></div>
  `;
  return row;
}

function renderDefaultClickRow(rule) {
  const enabled = defaultRulesEnabled[rule.id] !== false;
  const row = document.createElement('div');
  row.className = `rule-row grid-click is-default${enabled ? '' : ' is-disabled'}`;
  row.dataset.defaultId = rule.id;
  row.dataset.kind = 'default-click';
  row.innerHTML = `
    <div class="cell-name"><span class="pill pill-builtin"><svg><use href="#i-star"/></svg>Built-in</span><span class="nm">${escapeHTML(rule.name)}</span></div>
    <input class="inline" readonly value="${escapeHTML(rule.urlPattern)}" />
    <input class="inline" readonly value="${escapeHTML(rule.selector || '')}" />
    <input class="inline${rule.buttonText ? '' : ' placeholder-empty'}" readonly value="${escapeHTML(rule.buttonText || '')}" placeholder="(any)" />
    <div class="cell-delay"><input class="inline" readonly value="${escapeHTML(rule.delay)}" /><span class="unit">ms</span></div>
    <span class="toggle${enabled ? ' on' : ''}" role="switch" aria-checked="${enabled}" tabindex="0" data-default-toggle="${escapeHTML(rule.id)}"></span>
    <div class="row-actions"><button class="icon-btn" title="Locked — built-in rule"><svg width="13" height="13"><use href="#i-lock"/></svg></button></div>
  `;
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
  const defToggle = e.target.closest('[data-default-toggle]');
  if (defToggle) { toggleDefaultRule(defToggle); return; }
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
    const arr = kind === 'user-close' ? userRules.tabCloseRules : userRules.buttonClickRules;
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

function toggleDefaultRule(toggleEl) {
  const id = toggleEl.dataset.defaultToggle;
  const nowEnabled = !toggleEl.classList.contains('on');
  toggleEl.classList.toggle('on', nowEnabled);
  toggleEl.setAttribute('aria-checked', nowEnabled ? 'true' : 'false');
  const row = toggleEl.closest('.rule-row');
  if (row) row.classList.toggle('is-disabled', !nowEnabled);
  defaultRulesEnabled[id] = nowEnabled;
  markDirty();
}

function toggleUserRule(toggleEl) {
  const row = toggleEl.closest('.rule-row');
  if (!row) return;
  const kind = row.dataset.kind;
  const index = Number(row.dataset.userIndex);
  const arr = kind === 'user-close' ? userRules.tabCloseRules : userRules.buttonClickRules;
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
  if (kind === 'user-close') userRules.tabCloseRules.splice(index, 1);
  else if (kind === 'user-click') userRules.buttonClickRules.splice(index, 1);
  markDirty();
  renderAll();
}

function addKindRule(kind) {
  if (kind === 'close') addCloseRule();
  else if (kind === 'click') addClickRule();
}

function addCloseRule() {
  const pattern = '*://example.com/*';
  userRules.tabCloseRules.push({
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
  userRules.buttonClickRules.push({
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
  if (!confirm('Reset Click Custodian? This deletes all custom rules and re-enables every built-in.')) return;
  userRules = { tabCloseRules: [], buttonClickRules: [] };
  defaultRulesEnabled = {};
  [...defaultRules.tabCloseRules, ...defaultRules.buttonClickRules].forEach(r => { defaultRulesEnabled[r.id] = true; });
  await chrome.storage.sync.set({ userRules, defaultRulesEnabled });
  markClean();
  renderAll();
  showStatus('Reset — all defaults re-enabled, custom rules cleared', 'success');
}

function exportConfig() {
  if (hasUnsavedChanges) {
    if (!confirm('You have unsaved changes. The export will NOT include them. Continue?')) return;
  }
  const data = { userRules, defaultRulesEnabled };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'click-custodian-config.json'; a.click();
  URL.revokeObjectURL(url);
  showStatus('Configuration exported', 'success');
}

async function importConfig(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!imported.userRules || !imported.userRules.tabCloseRules || !imported.userRules.buttonClickRules) {
      throw new Error('Invalid configuration format');
    }
    userRules = imported.userRules;
    defaultRulesEnabled = imported.defaultRulesEnabled || {};
    await chrome.storage.sync.set({ userRules, defaultRulesEnabled });
    markClean();
    renderAll();
    showStatus('Configuration imported', 'success');
  } catch (error) {
    showStatus('Failed to import: ' + error.message, 'error');
  }
  e.target.value = '';
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
