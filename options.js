// Options page script

let defaultRules = null;
let userRules = null;
let defaultRulesEnabled = {};
let hasUnsavedChanges = false;
let currentTab = 'close-rules'; // Track active tab

// Load configuration on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  renderRules();
  attachEventListeners();
});

// Warn before leaving page with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

// Load config from storage
async function loadConfig() {
  const storage = await chrome.storage.sync.get(['defaultRules', 'userRules', 'defaultRulesEnabled']);
  defaultRules = storage.defaultRules || { tabCloseRules: [], buttonClickRules: [] };
  userRules = storage.userRules || { tabCloseRules: [], buttonClickRules: [] };
  defaultRulesEnabled = storage.defaultRulesEnabled || {};
}

// Mark configuration as having unsaved changes
function markDirty() {
  hasUnsavedChanges = true;
  const banner = document.getElementById('unsaved-banner');
  if (banner) {
    banner.style.display = 'block';
  }
}

// Mark configuration as saved
function markClean() {
  hasUnsavedChanges = false;
  const banner = document.getElementById('unsaved-banner');
  if (banner) {
    banner.style.display = 'none';
  }
}

// Generate unique ID
function generateId() {
  return 'rule_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Generate a smart default name from URL pattern
function generateDefaultRuleName(urlPattern) {
  try {
    // Remove glob wildcards for cleaner display
    let cleanPattern = urlPattern.replace(/^\*:\/\//, '').replace(/\/\*$/g, '');

    // Try to extract domain/host
    const urlMatch = cleanPattern.match(/^([^\/]+)/);
    if (urlMatch) {
      let domain = urlMatch[1];

      // Add path if it's meaningful
      const pathMatch = cleanPattern.match(/^[^\/]+\/(.+)/);
      if (pathMatch && pathMatch[1]) {
        const path = pathMatch[1].replace(/\*/g, '').trim();
        if (path && path !== '/' && path !== '') {
          domain += '/' + path;
        }
      }

      return domain;
    }

    // Fallback to cleaned pattern
    return cleanPattern || 'example.com';
  } catch (e) {
    return 'example.com';
  }
}

// Escape HTML to prevent XSS attacks
function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Clamp delay value to valid range, with fallback for invalid input
function clampDelay(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// Render all rules
function renderRules() {
  renderCloseRules();
  renderClickRules();
}

// Render tab close rules
function renderCloseRules() {
  const container = document.getElementById('close-rules-list');
  container.innerHTML = '';

  // Render default rules first
  if (defaultRules.tabCloseRules.length > 0) {
    const defaultHeader = document.createElement('h3');
    defaultHeader.className = 'rules-section-header';
    defaultHeader.innerHTML = '📌 Default Rules';
    container.appendChild(defaultHeader);

    defaultRules.tabCloseRules.forEach((rule) => {
      const ruleCard = createDefaultCloseRuleCard(rule);
      container.appendChild(ruleCard);
    });
  }

  // Render user rules
  if (userRules.tabCloseRules.length > 0) {
    const userHeader = document.createElement('h3');
    userHeader.className = 'rules-section-header';
    userHeader.textContent = 'Your Custom Rules';
    container.appendChild(userHeader);

    userRules.tabCloseRules.forEach((rule, index) => {
      const ruleCard = createUserCloseRuleCard(rule, index);
      container.appendChild(ruleCard);
    });
  } else if (defaultRules.tabCloseRules.length > 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'help-text';
    emptyMessage.textContent = 'No custom rules yet. Add one to get started!';
    container.appendChild(emptyMessage);
  } else {
    container.innerHTML = '<p class="help-text">No tab close rules configured. Add one to get started!</p>';
  }
}

// Create default tab close rule card (read-only except toggle)
function createDefaultCloseRuleCard(rule) {
  const isEnabled = defaultRulesEnabled[rule.id] !== false;
  const card = document.createElement('div');
  card.className = 'rule-card rule-card-default';
  card.innerHTML = `
    <div class="rule-header">
      <div class="rule-title">
        <span class="rule-name">${escapeHTML(rule.name)}</span>
      </div>
      <div class="rule-actions">
        <label class="toggle-switch">
          <input type="checkbox" ${isEnabled ? 'checked' : ''} data-rule-id="${escapeHTML(rule.id)}" class="default-rule-toggle">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    <div class="rule-body">
      <div class="form-group form-group-full">
        <label>URL Pattern</label>
        <div class="readonly-field">${escapeHTML(rule.urlPattern)}</div>
      </div>
      <div class="form-group">
        <label>Match Type</label>
        <div class="readonly-field">${escapeHTML(rule.matchType)}</div>
      </div>
      <div class="form-group">
        <label>Delay</label>
        <div class="readonly-field">${escapeHTML(rule.delay)}ms</div>
      </div>
    </div>
  `;
  return card;
}

// Create user tab close rule card (fully editable)
function createUserCloseRuleCard(rule, index) {
  const card = document.createElement('div');
  card.className = 'rule-card';
  card.innerHTML = `
    <div class="rule-header">
      <div class="rule-title">
        <label style="font-size: 11px; color: #7f8c8d; margin-bottom: 4px; display: block;">Rule Name</label>
        <input type="text" value="${escapeHTML(rule.name)}" data-index="${index}" data-field="name" class="user-close-rule-input" placeholder="Enter a descriptive name" style="margin-bottom: 4px;">
        <span class="help-text">Give this rule a name for easy identification</span>
      </div>
      <div class="rule-actions">
        <label class="toggle-switch">
          <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-index="${index}" data-field="enabled" class="user-close-rule-input">
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-danger btn-small delete-user-close-rule" data-index="${index}">Delete</button>
      </div>
    </div>
    <div class="rule-body">
      <div class="form-group form-group-full">
        <label>URL Pattern</label>
        <input type="text" value="${escapeHTML(rule.urlPattern)}" data-index="${index}" data-field="urlPattern" class="user-close-rule-input">
        <span class="help-text">Use * for wildcards (e.g., *://example.com/*)</span>
      </div>
      <div class="form-group">
        <label>Match Type</label>
        <select data-index="${index}" data-field="matchType" class="user-close-rule-input">
          <option value="glob" ${rule.matchType === 'glob' ? 'selected' : ''}>Glob Pattern</option>
          <option value="regex" ${rule.matchType === 'regex' ? 'selected' : ''}>Regular Expression</option>
          <option value="exact" ${rule.matchType === 'exact' ? 'selected' : ''}>Exact Match</option>
          <option value="contains" ${rule.matchType === 'contains' ? 'selected' : ''}>Contains</option>
        </select>
      </div>
      <div class="form-group">
        <label>Delay (milliseconds)</label>
        <input type="number" value="${rule.delay}" min="0" step="100" data-index="${index}" data-field="delay" class="user-close-rule-input">
        <span class="help-text">Time before tab closes (default: 3000)</span>
      </div>
    </div>
  `;
  return card;
}

// Render button click rules
function renderClickRules() {
  const container = document.getElementById('click-rules-list');
  container.innerHTML = '';

  // Render default rules first
  if (defaultRules.buttonClickRules.length > 0) {
    const defaultHeader = document.createElement('h3');
    defaultHeader.className = 'rules-section-header';
    defaultHeader.innerHTML = '📌 Default Rules';
    container.appendChild(defaultHeader);

    defaultRules.buttonClickRules.forEach((rule) => {
      const ruleCard = createDefaultClickRuleCard(rule);
      container.appendChild(ruleCard);
    });
  }

  // Render user rules
  if (userRules.buttonClickRules.length > 0) {
    const userHeader = document.createElement('h3');
    userHeader.className = 'rules-section-header';
    userHeader.textContent = 'Your Custom Rules';
    container.appendChild(userHeader);

    userRules.buttonClickRules.forEach((rule, index) => {
      const ruleCard = createUserClickRuleCard(rule, index);
      container.appendChild(ruleCard);
    });
  } else if (defaultRules.buttonClickRules.length > 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'help-text';
    emptyMessage.textContent = 'No custom rules yet. Add one to get started!';
    container.appendChild(emptyMessage);
  } else {
    container.innerHTML = '<p class="help-text">No button click rules configured. Add one to get started!</p>';
  }
}

// Create default button click rule card (read-only except toggle)
function createDefaultClickRuleCard(rule) {
  const isEnabled = defaultRulesEnabled[rule.id] !== false;
  const card = document.createElement('div');
  card.className = 'rule-card rule-card-default';
  card.innerHTML = `
    <div class="rule-header">
      <div class="rule-title">
        <span class="rule-name">${escapeHTML(rule.name)}</span>
      </div>
      <div class="rule-actions">
        <label class="toggle-switch">
          <input type="checkbox" ${isEnabled ? 'checked' : ''} data-rule-id="${escapeHTML(rule.id)}" class="default-rule-toggle">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    <div class="rule-body">
      <div class="form-group form-group-full">
        <label>URL Pattern</label>
        <div class="readonly-field">${escapeHTML(rule.urlPattern)}</div>
      </div>
      <div class="form-group">
        <label>Match Type</label>
        <div class="readonly-field">${escapeHTML(rule.matchType)}</div>
      </div>
      <div class="form-group">
        <label>CSS Selector</label>
        <div class="readonly-field">${escapeHTML(rule.selector)}</div>
      </div>
      <div class="form-group">
        <label>Button Text</label>
        <div class="readonly-field">${escapeHTML(rule.buttonText || '(any)')}</div>
      </div>
      <div class="form-group">
        <label>Delay</label>
        <div class="readonly-field">${escapeHTML(rule.delay)}ms</div>
      </div>
    </div>
  `;
  return card;
}

// Helper to parse selector into presets and custom selectors
function parseSelector(selector) {
  if (!selector) return { presets: ['button'], custom: [] };

  const presets = ['button', 'a', 'input[type="button"]', 'input[type="submit"]', '[role="button"]'];
  const parts = selector.split(',').map(s => s.trim());

  const matchedPresets = [];
  const customSelectors = [];

  parts.forEach(part => {
    if (presets.includes(part)) {
      matchedPresets.push(part);
    } else {
      customSelectors.push(part);
    }
  });

  // Default to 'button' if nothing matched
  return {
    presets: matchedPresets.length > 0 ? matchedPresets : ['button'],
    custom: customSelectors
  };
}

// Helper to generate selector checkboxes
function generateSelectorCheckboxes(selector, index) {
  const { presets } = parseSelector(selector);
  const options = [
    { value: 'button', label: 'button' },
    { value: 'a', label: 'a' },
    { value: 'input[type="button"]', label: 'input[type="button"]' },
    { value: 'input[type="submit"]', label: 'input[type="submit"]' },
    { value: '[role="button"]', label: '[role="button"]' }
  ];

  return options.map(opt => `
    <label class="selector-checkbox">
      <input type="checkbox" value="${escapeHTML(opt.value)}" data-index="${index}" class="selector-preset-checkbox" ${presets.includes(opt.value) ? 'checked' : ''}>
      <span>${escapeHTML(opt.label)}</span>
    </label>
  `).join('');
}

// Helper to render custom selector inputs
function renderCustomSelectors(selector, index) {
  const { custom } = parseSelector(selector);

  if (custom.length === 0) return '';

  return custom.map((sel, i) => `
    <div class="custom-selector-row">
      <input type="text" value="${escapeHTML(sel)}" data-index="${index}" data-custom-index="${i}" class="custom-selector-input" placeholder="e.g., button.submit">
      <button class="btn btn-danger btn-xs remove-custom-selector" data-index="${index}" data-custom-index="${i}">×</button>
    </div>
  `).join('');
}

// Helper to update rule selector from UI checkboxes and custom inputs
function updateSelectorFromUI(index) {
  const presetCheckboxes = document.querySelectorAll(`.selector-preset-checkbox[data-index="${index}"]`);
  const customInputs = document.querySelectorAll(`.custom-selector-input[data-index="${index}"]`);

  const checkedPresets = Array.from(presetCheckboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const customSelectors = Array.from(customInputs)
    .map(input => input.value.trim())
    .filter(val => val.length > 0);

  const allSelectors = [...checkedPresets, ...customSelectors];
  userRules.buttonClickRules[index].selector = allSelectors.join(', ') || 'button';
}

// Create user button click rule card (fully editable)
function createUserClickRuleCard(rule, index) {
  const card = document.createElement('div');
  card.className = 'rule-card';
  card.innerHTML = `
    <div class="rule-header">
      <div class="rule-title">
        <label style="font-size: 11px; color: #7f8c8d; margin-bottom: 4px; display: block;">Rule Name</label>
        <input type="text" value="${escapeHTML(rule.name)}" data-index="${index}" data-field="name" class="user-click-rule-input" placeholder="Enter a descriptive name" style="margin-bottom: 4px;">
        <span class="help-text">Give this rule a name for easy identification</span>
      </div>
      <div class="rule-actions">
        <label class="toggle-switch">
          <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-index="${index}" data-field="enabled" class="user-click-rule-input">
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-danger btn-small delete-user-click-rule" data-index="${index}">Delete</button>
      </div>
    </div>
    <div class="rule-body">
      <div class="form-group form-group-full">
        <label>URL Pattern</label>
        <input type="text" value="${escapeHTML(rule.urlPattern)}" data-index="${index}" data-field="urlPattern" class="user-click-rule-input">
        <span class="help-text">Use * for wildcards (e.g., *://example.com/*)</span>
      </div>
      <div class="form-group">
        <label>Match Type</label>
        <select data-index="${index}" data-field="matchType" class="user-click-rule-input">
          <option value="glob" ${rule.matchType === 'glob' ? 'selected' : ''}>Glob Pattern</option>
          <option value="regex" ${rule.matchType === 'regex' ? 'selected' : ''}>Regular Expression</option>
          <option value="exact" ${rule.matchType === 'exact' ? 'selected' : ''}>Exact Match</option>
          <option value="contains" ${rule.matchType === 'contains' ? 'selected' : ''}>Contains</option>
        </select>
      </div>
      <div class="form-group form-group-full">
        <label>CSS Selector</label>
        <div class="selector-checkboxes">
          ${generateSelectorCheckboxes(rule.selector, index)}
        </div>
        <div class="custom-selectors" data-index="${index}">
          ${renderCustomSelectors(rule.selector, index)}
        </div>
        <button class="btn btn-secondary btn-small add-custom-selector" data-index="${index}">+ Add Custom Selector</button>
        <span class="help-text">Select common button types or add custom CSS selectors</span>
      </div>
      <div class="form-group">
        <label>Button Text (optional)</label>
        <input type="text" value="${escapeHTML(rule.buttonText || '')}" data-index="${index}" data-field="buttonText" class="user-click-rule-input">
        <span class="help-text">Additional filter by button text</span>
      </div>
      <div class="form-group">
        <label>Delay (milliseconds)</label>
        <input type="number" value="${rule.delay}" min="0" step="100" data-index="${index}" data-field="delay" class="user-click-rule-input">
        <span class="help-text">Wait time before clicking (default: 1000)</span>
      </div>
    </div>
  `;
  return card;
}

// Attach event listeners
function attachEventListeners() {
  // Add close rule
  document.getElementById('add-close-rule').addEventListener('click', () => {
    const defaultPattern = '*://example.com/*';
    userRules.tabCloseRules.push({
      id: generateId(),
      name: generateDefaultRuleName(defaultPattern),
      urlPattern: defaultPattern,
      matchType: 'glob',
      enabled: false,
      delay: 3000
    });
    markDirty();
    renderCloseRules();
  });

  // Add click rule
  document.getElementById('add-click-rule').addEventListener('click', () => {
    const defaultPattern = '*://example.com/*';
    userRules.buttonClickRules.push({
      id: generateId(),
      name: generateDefaultRuleName(defaultPattern),
      urlPattern: defaultPattern,
      matchType: 'glob',
      selector: 'button',
      buttonText: '',
      enabled: false,
      delay: 1000
    });
    markDirty();
    renderClickRules();
  });

  // Save config
  document.getElementById('save-config').addEventListener('click', saveConfig);

  // Reset config
  document.getElementById('reset-config').addEventListener('click', resetConfig);

  // Export config
  document.getElementById('export-config').addEventListener('click', exportConfig);

  // Import config
  document.getElementById('import-config').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', importConfig);

  // Initialize tab navigation
  initTabNavigation();

  // Attach rule-specific listeners using event delegation
  attachRuleListeners();
}

/**
 * Tab Navigation System
 *
 * Manages the tab interface for switching between Close Rules and Click Rules.
 * Features:
 * - Click-based tab switching
 * - Keyboard navigation (Arrow keys, Home, End)
 * - State persistence via localStorage
 * - Deep linking via URL hash (#close-rules, #click-rules)
 * - Smooth fade-in animations
 */

// Initialize tab navigation
function initTabNavigation() {
  // Clean up old collapse state keys (one-time migration)
  localStorage.removeItem('section-close-rules-collapsed');
  localStorage.removeItem('section-click-rules-collapsed');

  const tabButtons = document.querySelectorAll('.tab-button');

  tabButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      const tabId = e.currentTarget.dataset.tab;
      switchTab(tabId);
    });
  });

  // Keyboard navigation
  const tabsNav = document.querySelector('.tabs-nav');
  tabsNav.addEventListener('keydown', handleTabKeyboard);

  // Restore last active tab or load from URL hash
  restoreActiveTab();

  // Handle URL hash changes (deep linking)
  window.addEventListener('hashchange', handleHashChange);
}

// Switch to a specific tab
function switchTab(tabId) {
  // Update state
  currentTab = tabId;

  // Update tab buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  // Update panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const isActive = panel.dataset.panel === tabId;
    panel.classList.toggle('active', isActive);

    if (isActive) {
      panel.removeAttribute('hidden');
    } else {
      panel.setAttribute('hidden', '');
    }
  });

  // Save to localStorage
  localStorage.setItem('activeTab', tabId);

  // Update URL hash (for deep linking)
  if (window.location.hash !== `#${tabId}`) {
    history.replaceState(null, '', `#${tabId}`);
  }
}

// Handle keyboard navigation for tabs
function handleTabKeyboard(e) {
  const tabs = Array.from(document.querySelectorAll('.tab-button'));
  const currentIndex = tabs.findIndex(tab => tab.classList.contains('active'));

  let newIndex = currentIndex;

  // Arrow key navigation
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    newIndex = (currentIndex + 1) % tabs.length;
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (e.key === 'Home') {
    e.preventDefault();
    newIndex = 0;
  } else if (e.key === 'End') {
    e.preventDefault();
    newIndex = tabs.length - 1;
  } else {
    return; // Not a navigation key
  }

  // Switch to new tab and focus
  const newTab = tabs[newIndex];
  switchTab(newTab.dataset.tab);
  newTab.focus();
}

// Restore the active tab from localStorage or URL hash
function restoreActiveTab() {
  // Priority: URL hash > localStorage > default
  let tabToActivate = 'close-rules'; // default

  // Check URL hash first
  const hash = window.location.hash.slice(1);
  if (hash && (hash === 'close-rules' || hash === 'click-rules')) {
    tabToActivate = hash;
  } else {
    // Check localStorage
    const savedTab = localStorage.getItem('activeTab');
    if (savedTab && (savedTab === 'close-rules' || savedTab === 'click-rules')) {
      tabToActivate = savedTab;
    }
  }

  switchTab(tabToActivate);
}

// Handle URL hash changes for deep linking
function handleHashChange() {
  const hash = window.location.hash.slice(1);
  if (hash && (hash === 'close-rules' || hash === 'click-rules')) {
    switchTab(hash);
  }
}

// Attach listeners for rule inputs using event delegation
function attachRuleListeners() {
  const closeRulesList = document.getElementById('close-rules-list');
  const clickRulesList = document.getElementById('click-rules-list');

  // Event delegation for close rules
  closeRulesList.addEventListener('change', (e) => {
    // Default rule toggles
    if (e.target.matches('.default-rule-toggle')) {
      const ruleId = e.target.dataset.ruleId;
      defaultRulesEnabled[ruleId] = e.target.checked;
      markDirty();
    }

    // User close rule inputs
    if (e.target.matches('.user-close-rule-input')) {
      const index = parseInt(e.target.dataset.index);
      const field = e.target.dataset.field;
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      userRules.tabCloseRules[index][field] = field === 'delay' ? clampDelay(value, 0, 60000, 3000) : value;
      markDirty();
    }
  });

  closeRulesList.addEventListener('click', (e) => {
    // Delete user close rule buttons
    if (e.target.matches('.delete-user-close-rule')) {
      const index = parseInt(e.target.dataset.index);
      if (confirm('Are you sure you want to delete this rule?')) {
        userRules.tabCloseRules.splice(index, 1);
        markDirty();
        renderCloseRules();
      }
    }
  });

  // Event delegation for click rules
  clickRulesList.addEventListener('change', (e) => {
    // Default rule toggles
    if (e.target.matches('.default-rule-toggle')) {
      const ruleId = e.target.dataset.ruleId;
      defaultRulesEnabled[ruleId] = e.target.checked;
      markDirty();
    }

    // User click rule inputs
    if (e.target.matches('.user-click-rule-input')) {
      const index = parseInt(e.target.dataset.index);
      const field = e.target.dataset.field;
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      userRules.buttonClickRules[index][field] = field === 'delay' ? clampDelay(value, 0, 60000, 1000) : value;
      markDirty();
    }

    // Selector preset checkboxes
    if (e.target.matches('.selector-preset-checkbox')) {
      const index = parseInt(e.target.dataset.index);
      updateSelectorFromUI(index);
      markDirty();
    }
  });

  clickRulesList.addEventListener('input', (e) => {
    // Custom selector inputs
    if (e.target.matches('.custom-selector-input')) {
      const index = parseInt(e.target.dataset.index);
      updateSelectorFromUI(index);
      markDirty();
    }
  });

  clickRulesList.addEventListener('click', (e) => {
    // Add custom selector buttons
    if (e.target.matches('.add-custom-selector')) {
      const index = parseInt(e.target.dataset.index);
      const container = document.querySelector(`.custom-selectors[data-index="${index}"]`);

      const newRow = document.createElement('div');
      newRow.className = 'custom-selector-row';
      newRow.innerHTML = `
        <input type="text" value="" data-index="${index}" data-custom-index="${container.children.length}" class="custom-selector-input" placeholder="e.g., button.submit">
        <button class="btn btn-danger btn-xs remove-custom-selector" data-index="${index}" data-custom-index="${container.children.length}">×</button>
      `;

      container.appendChild(newRow);
      markDirty();
    }

    // Remove custom selector buttons
    if (e.target.matches('.remove-custom-selector')) {
      const index = parseInt(e.target.dataset.index);
      e.target.closest('.custom-selector-row').remove();
      updateSelectorFromUI(index);
      markDirty();
    }

    // Delete user click rule buttons
    if (e.target.matches('.delete-user-click-rule')) {
      const index = parseInt(e.target.dataset.index);
      if (confirm('Are you sure you want to delete this rule?')) {
        userRules.buttonClickRules.splice(index, 1);
        markDirty();
        renderClickRules();
      }
    }
  });
}

// Save configuration
async function saveConfig() {
  try {
    await chrome.storage.sync.set({
      userRules,
      defaultRulesEnabled
    });
    markClean();
    showStatus('Configuration saved successfully!', 'success');
  } catch (error) {
    showStatus('Failed to save configuration: ' + error.message, 'error');
  }
}

// Reset to default configuration
async function resetConfig() {
  if (!confirm('Are you sure you want to reset? This will delete all custom rules and re-enable all default rules.')) {
    return;
  }

  // Clear user rules
  userRules = { tabCloseRules: [], buttonClickRules: [] };

  // Re-enable all defaults
  defaultRulesEnabled = {};
  [...defaultRules.tabCloseRules, ...defaultRules.buttonClickRules].forEach(rule => {
    defaultRulesEnabled[rule.id] = true;
  });

  await saveConfig();
  renderRules();
  markClean();
  showStatus('Reset complete - all defaults re-enabled, custom rules deleted', 'success');
}

// Export configuration
function exportConfig() {
  // Warn if there are unsaved changes
  if (hasUnsavedChanges) {
    if (!confirm('You have unsaved changes. The export will NOT include these changes. Continue?')) {
      return;
    }
  }

  const exportData = {
    userRules,
    defaultRulesEnabled
  };
  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'click-custodian-config.json';
  link.click();
  URL.revokeObjectURL(url);
  showStatus('Configuration exported', 'success');
}

// Import configuration
async function importConfig(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importedData = JSON.parse(text);

    // Validate config structure
    if (!importedData.userRules || !importedData.userRules.tabCloseRules || !importedData.userRules.buttonClickRules) {
      throw new Error('Invalid configuration format');
    }

    userRules = importedData.userRules;
    defaultRulesEnabled = importedData.defaultRulesEnabled || {};
    await saveConfig();
    renderRules();
    markClean();
    showStatus('Configuration imported successfully', 'success');
  } catch (error) {
    showStatus('Failed to import configuration: ' + error.message, 'error');
  }

  // Reset file input
  e.target.value = '';
}

// Show status message
function showStatus(message, type) {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;
  statusEl.className = `status-message ${type}`;

  setTimeout(() => {
    statusEl.className = 'status-message';
  }, 3000);
}
