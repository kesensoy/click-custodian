// Background service worker for monitoring tabs
importScripts('debug.js');

// Track processed tabs to prevent duplicate actions
const processedTabs = new Set();
const TAB_TRACKING_TIMEOUT = 5000; // Clear entries after 5 seconds
const MAX_TRACKED_TABS = 100; // Emergency cleanup threshold

// Toolbar icon swap: navy is the always-default brand icon. Moss / graphite /
// ember tinted icons unlock only when the user has both starred the repo on
// GitHub AND chosen a non-navy palette in settings. Star detection lives in
// content.js; the palette key is set by options.js.
const ICON_SETS = {
  navy: {
    16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png',
  },
  moss: {
    16: 'icons/icon16-moss.png', 48: 'icons/icon48-moss.png', 128: 'icons/icon128-moss.png',
  },
  graphite: {
    16: 'icons/icon16-graphite.png', 48: 'icons/icon48-graphite.png', 128: 'icons/icon128-graphite.png',
  },
  ember: {
    16: 'icons/icon16-ember.png', 48: 'icons/icon48-ember.png', 128: 'icons/icon128-ember.png',
  },
};

async function applyIconForCurrentState() {
  try {
    const { palette = 'navy', hasStarred = false } = await chrome.storage.sync.get(['palette', 'hasStarred']);
    // Tinted icon only when the user has starred AND chose a non-navy palette.
    // Everything else (incl. starred-on-navy) shows the default brand icon.
    const useTinted = hasStarred && palette !== 'navy' && ICON_SETS[palette];
    const path = useTinted ? ICON_SETS[palette] : ICON_SETS.navy;
    await chrome.action.setIcon({ path });
  } catch (e) {
    debugLog('DEBUG', 'Failed to apply icon for current state:', e.message);
  }
}

// Re-apply on either storage signal flipping. MV3 service workers are
// ephemeral, so the top-level call below also re-fires on every boot.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.palette || changes.hasStarred) {
    applyIconForCurrentState();
  }
});

applyIconForCurrentState();

// Emergency cleanup if Set grows too large (should never happen with timeouts)
function checkTrackingSetSize() {
  if (processedTabs.size > MAX_TRACKED_TABS) {
    debugLog('WARN', 'Tracking Set exceeded max size, clearing all entries:', processedTabs.size);
    processedTabs.clear();
  }
}

/**
 * Sends a message to a content script with automatic retry logic.
 * @param {number} tabId - The tab ID to send message to
 * @param {object} message - The message object to send
 * @param {number} maxRetries - Maximum retry attempts (default 3)
 * @param {number} retryDelay - Delay between retries in ms (default 500)
 * @returns {Promise<boolean>} True if message sent successfully, false otherwise
 */
async function sendMessageWithRetry(tabId, message, maxRetries = 3, retryDelay = 500) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      debugLog('DEBUG', `Message sent successfully (attempt ${attempt}):`, message.action);
      return true;
    } catch (error) {
      debugLog('DEBUG', `Failed to send message (attempt ${attempt}/${maxRetries}):`, error.message);
      if (attempt < maxRetries) {
        debugLog('DEBUG', `Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  debugLog('DEBUG', 'All retry attempts failed for message:', message.action);
  return false;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await seedFromExamples();
  } else if (details.reason === 'update') {
    await migrateLegacyShape();
  }
});

async function seedFromExamples() {
  try {
    const response = await fetch(chrome.runtime.getURL('seed-examples.json'));
    const seed = await response.json();
    const tabCloseRules = seed.tabCloseRules || [];
    const buttonClickRules = seed.buttonClickRules || [];
    await chrome.storage.sync.set({
      tabCloseRules,
      buttonClickRules
    });
    debugLog('DEBUG', 'Seeded from seed-examples.json');
  } catch (error) {
    debugError('DEBUG', 'Failed to seed:', error);
    await chrome.storage.sync.set({ tabCloseRules: [], buttonClickRules: [] });
  }
}

async function migrateLegacyShape() {
  const storage = await chrome.storage.sync.get(null);
  if (Array.isArray(storage.tabCloseRules) && Array.isArray(storage.buttonClickRules)
      && !storage.defaultRules && !storage.userRules) {
    return;
  }

  const enabled = storage.defaultRulesEnabled || {};
  const defaults = storage.defaultRules || { tabCloseRules: [], buttonClickRules: [] };
  const users = storage.userRules || { tabCloseRules: [], buttonClickRules: [] };

  const activeDefaults = {
    tabCloseRules: (defaults.tabCloseRules || []).filter(r => enabled[r.id] !== false),
    buttonClickRules: (defaults.buttonClickRules || []).filter(r => enabled[r.id] !== false)
  };

  const flat = {
    tabCloseRules: [...activeDefaults.tabCloseRules, ...(users.tabCloseRules || [])],
    buttonClickRules: [...activeDefaults.buttonClickRules, ...(users.buttonClickRules || [])]
  };

  await chrome.storage.sync.set(flat);
  await chrome.storage.sync.remove(['defaultRules', 'userRules', 'defaultRulesEnabled', 'defaultsVersion']);
  debugLog('DEBUG', 'Migrated legacy storage shape to flat');
}

// Monitor tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when page is fully loaded
  if (changeInfo.status !== 'complete') return;

  // Create unique key for this tab/URL combination
  const tabKey = `${tabId}-${tab.url}`;

  // Skip if we've already processed this tab/URL
  if (processedTabs.has(tabKey)) {
    debugLog('DEBUG', 'Already processed tab/URL, skipping duplicate event:', { tabId, url: tab.url });
    return;
  }

  // Mark this tab/URL as processed
  processedTabs.add(tabKey);
  checkTrackingSetSize(); // Safety check
  debugLog('DEBUG', 'Processing new tab/URL:', { tabId, url: tab.url, trackingSetSize: processedTabs.size });

  // Schedule cleanup of this entry
  setTimeout(() => {
    processedTabs.delete(tabKey);
    debugLog('DEBUG', 'Cleaned up tracking entry:', { tabKey, remainingEntries: processedTabs.size });
  }, TAB_TRACKING_TIMEOUT);

  debugLog('DEBUG', 'Tab updated:', { tabId, url: tab.url, status: changeInfo.status });

  const { tabCloseRules = [], buttonClickRules = [] } = await chrome.storage.sync.get(['tabCloseRules', 'buttonClickRules']);

  debugLog('DEBUG', 'Loaded storage:', {
    closeRules: tabCloseRules.length,
    clickRules: buttonClickRules.length
  });

  const allCloseRules = tabCloseRules;
  const allClickRules = buttonClickRules;

  // Check if tab matches any close rules
  debugLog('DEBUG', 'Checking close rules against URL:', tab.url);
  const matchingCloseRule = allCloseRules.find(rule => {
    if (rule.enabled === false) {
      debugLog('DEBUG', 'Close rule disabled:', rule.name);
      return false;
    }
    const matches = matchesPattern(tab.url, rule.urlPattern, rule.matchType);
    debugLog('DEBUG', 'Close rule check:', {
      name: rule.name,
      pattern: rule.urlPattern,
      matchType: rule.matchType,
      matches
    });
    return matches;
  });

  // Check for button click rules
  debugLog('DEBUG', 'Checking button click rules against URL:', tab.url);
  const matchingButtonRule = allClickRules.find(rule => {
    if (rule.enabled === false) {
      debugLog('DEBUG', 'Button rule disabled:', rule.name);
      return false;
    }
    const matches = matchesPattern(tab.url, rule.urlPattern, rule.matchType);
    debugLog('DEBUG', 'Button rule check:', {
      name: rule.name,
      pattern: rule.urlPattern,
      matchType: rule.matchType,
      selector: rule.selector,
      matches
    });
    return matches;
  });

  // CONFLICT DETECTION: Both rules match
  if (matchingCloseRule && matchingButtonRule) {
    debugLog('DEBUG', 'Conflict detected:', {
      closeRule: matchingCloseRule.name,
      buttonRule: matchingButtonRule.name,
      url: tab.url
    });

    // Don't start countdown yet - let content script start it after button check fails
    // Request button check from content script with closeRuleDelay
    debugLog('DEBUG', 'Sending checkButtonExists message:', {
      rule: matchingButtonRule.name,
      selector: matchingButtonRule.selector,
      closeRuleDelay: matchingCloseRule.delay
    });

    const checkSuccess = await sendMessageWithRetry(tabId, {
      action: 'checkButtonExists',
      rule: matchingButtonRule,
      closeRuleDelay: matchingCloseRule.delay
    });

    if (!checkSuccess) {
      // All retries failed - fallback to countdown
      debugLog('DEBUG', 'Failed to check button existence after retries - falling back to countdown');
      await sendMessageWithRetry(tabId, {
        action: 'startCountdown',
        delay: matchingCloseRule.delay
      }, 2); // Use 2 retries for fallback
    }

    // Don't execute button click yet - wait for button check result
    return;
  }

  // NO CONFLICT: Execute whichever rule matched
  if (matchingCloseRule) {
    debugLog('DEBUG', 'No conflict - close rule matched:', matchingCloseRule.name);

    // Start countdown via content script
    debugLog('DEBUG', 'Sending startCountdown message (no conflict) with delay:', matchingCloseRule.delay);
    await sendMessageWithRetry(tabId, {
      action: 'startCountdown',
      delay: matchingCloseRule.delay
    });
  }

  if (matchingButtonRule) {
    debugLog('DEBUG', 'No conflict - button rule matched:', matchingButtonRule.name);

    // Send message to content script to click button
    debugLog('DEBUG', 'Sending clickButton message (no conflict)');
    await sendMessageWithRetry(tabId, {
      action: 'clickButton',
      rule: matchingButtonRule
    });
  }

  if (!matchingCloseRule && !matchingButtonRule) {
    debugLog('DEBUG', 'No rules matched for URL:', tab.url);
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog('DEBUG', 'Background received message:', request.action, 'from tab:', sender.tab?.id);

  if (request.action === 'closeTab') {
    chrome.tabs.remove(sender.tab.id);
    debugLog('DEBUG', `Closed tab ${sender.tab.id}`);
  } else if (request.action === 'abortClose') {
    debugLog('DEBUG', `Aborted close for tab ${sender.tab.id}`);
  } else if (request.action === 'buttonCheckResult') {
    debugLog('DEBUG', 'Received buttonCheckResult:', {
      found: request.found,
      rule: request.rule?.name,
      tabId: sender.tab?.id
    });

    if (request.found) {
      // Button exists - cancel countdown, proceed with click
      debugLog('DEBUG', `Button found for rule "${request.rule.name}" - cancelling countdown and clicking`);
      (async () => {
        await sendMessageWithRetry(sender.tab.id, { action: 'abortClose' });
        await sendMessageWithRetry(sender.tab.id, {
          action: 'clickButton',
          rule: request.rule
        });

        // After clicking button in conflict mode, allow re-processing of this URL
        // This handles SPAs where the button click updates the page content but not the URL
        // The next 'complete' event will re-evaluate and start countdown if button is gone
        const tab = sender.tab;
        if (tab && tab.url) {
          const tabKey = `${tab.id}-${tab.url}`;
          // Wait 100ms for button click to trigger page update, then clear tracking
          setTimeout(() => {
            processedTabs.delete(tabKey);
            debugLog('DEBUG', `Cleared processed tab tracking for ${tabKey} after button click (allows re-evaluation)`);
          }, 100);
        }
      })();
    } else {
      // Button not found - countdown continues naturally
      debugLog('DEBUG', `Button not found for rule "${request.rule.name}" - countdown continues`);
    }
  }
});

// Helper function to match URL patterns
function matchesPattern(url, pattern, matchType) {
  if (!url) return false;

  switch (matchType) {
    case 'glob':
      return globMatch(url, pattern);
    case 'regex':
      try {
        const regex = new RegExp(pattern);
        return regex.test(url);
      } catch (e) {
        debugError('ERROR', 'Invalid regex pattern:', pattern, e);
        return false;
      }
    case 'exact':
      return url === pattern;
    case 'contains':
      return url.includes(pattern);
    default:
      return false;
  }
}

// Simple glob pattern matcher
function globMatch(str, pattern) {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp('^' + regexPattern + '$');
  return regex.test(str);
}
