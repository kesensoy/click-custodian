// Background service worker for monitoring tabs
importScripts('debug.js');

// Track processed tabs to prevent duplicate actions
const processedTabs = new Set();
const TAB_TRACKING_TIMEOUT = 5000; // Clear entries after 5 seconds
const MAX_TRACKED_TABS = 100; // Emergency cleanup threshold

// Per-tab timestamp of the last load-complete event we processed.
// Used to suppress in-page URL changes that fire too soon after a load —
// otherwise a permissive rule that matches both the dirty and rewritten
// URL forms would fire twice for one user-visible navigation.
const lastLoadCompleteAt = new Map(); // tabId -> ms epoch
const POST_LOAD_QUIET_MS = 1500;
// Conflict-mode button click can trigger a near-immediate history.replaceState
// from the page itself. Give Chrome a beat to fire that onUpdated event before
// we clear the dedup/cooldown entries, so the re-evaluation actually sees the
// rewritten URL rather than a stale state.
const POST_CLICK_REEVAL_MS = 100;

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

// Same parity guard for lastLoadCompleteAt: a tab leaks one entry per matching
// load if onRemoved never fires (e.g., browser crash, MV3 worker restart). The
// usual safety net is the worker termination cycle, but cap it explicitly so a
// very long-lived worker can't accumulate without bound.
function checkLastLoadCompleteAtSize() {
  if (lastLoadCompleteAt.size > MAX_TRACKED_TABS) {
    debugLog('WARN', 'lastLoadCompleteAt exceeded max size, clearing all entries:', lastLoadCompleteAt.size);
    lastLoadCompleteAt.clear();
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

// Monitor tab updates.
//
// We process three kinds of events:
//   1. Full page loads (tabs.onUpdated, status === 'complete') — the original case.
//   2. In-page URL changes (tabs.onUpdated, changeInfo.url set, no 'complete')
//      — fired when a page calls history.pushState / history.replaceState.
//      Required for SPAs that rewrite the URL after load (e.g., stripping
//      query parameters once an OAuth-style approval flow completes).
//   3. Navigation commits (webNavigation.onCommitted, main frame only) —
//      fires earlier than 'complete', and crucially still fires when a page
//      synchronously hands off to an external/custom-protocol URL during parse
//      (e.g. an app deep-link). Such a handoff cancels the load lifecycle, so
//      'complete' never arrives — but commit already did. Per-tab+URL dedup
//      (processedTabs) prevents double-fire when both commit and complete
//      deliver the same URL.
//
// For tabs.onUpdated we deliberately ignore status === 'loading' events even
// when changeInfo.url is set — a fresh navigation produces 'complete' shortly
// and processing both would double-fire.
function isInPageUrlChangeEvent(changeInfo) {
  if (!changeInfo.url) return false;
  if (changeInfo.status === 'loading') return false;
  if (changeInfo.status === 'complete') return false;
  return true;
}

async function handleNavigationEvent(tabId, url, trigger) {
  if (!url) return;

  // Snapshot the post-load quiet window BEFORE this event can open it below.
  // The window opens when a rule fires on a load-equivalent event ('load' or
  // 'commit'); later events belonging to the SAME user-visible navigation must
  // not re-fire inside it.
  const lastLoadAt = lastLoadCompleteAt.get(tabId);
  const withinQuietWindow = !!lastLoadAt && (Date.now() - lastLoadAt) < POST_LOAD_QUIET_MS;

  // Cooldown: suppress in-page URL changes that follow a load too closely.
  // Without this, a permissive pattern (e.g., a 'contains' rule that matches
  // both URL variants) would fire once on the dirty load and again on the
  // post-load rewrite — most often unwanted, and for button-click rules
  // potentially a double-click on a server action.
  if (trigger === 'spa' && withinQuietWindow) {
    debugLog('DEBUG', 'Suppressing in-page URL change inside post-load quiet window:', { tabId, url });
    return;
  }

  const isLoadComplete = trigger === 'load' || trigger === 'commit';
  const tabKey = `${tabId}-${url}`;

  // Skip if we've already processed this tab/URL
  if (processedTabs.has(tabKey)) {
    debugLog('DEBUG', 'Already processed tab/URL, skipping duplicate event:', { tabId, url, trigger });
    return;
  }

  // Mark this tab/URL as processed
  processedTabs.add(tabKey);
  checkTrackingSetSize(); // Safety check
  debugLog('DEBUG', 'Processing new tab/URL:', { tabId, url, trigger, trackingSetSize: processedTabs.size });

  // Schedule cleanup of this entry
  setTimeout(() => {
    processedTabs.delete(tabKey);
    debugLog('DEBUG', 'Cleaned up tracking entry:', { tabKey, remainingEntries: processedTabs.size });
  }, TAB_TRACKING_TIMEOUT);

  debugLog('DEBUG', 'Tab updated:', { tabId, url, trigger });

  const { tabCloseRules = [], buttonClickRules = [] } = await chrome.storage.sync.get(['tabCloseRules', 'buttonClickRules']);

  debugLog('DEBUG', 'Loaded storage:', {
    closeRules: tabCloseRules.length,
    clickRules: buttonClickRules.length
  });

  const allCloseRules = tabCloseRules;
  const allClickRules = buttonClickRules;

  // Check if tab matches any close rules
  debugLog('DEBUG', 'Checking close rules against URL:', url);
  const matchingCloseRule = allCloseRules.find(rule => {
    if (rule.enabled === false) {
      debugLog('DEBUG', 'Close rule disabled:', rule.name);
      return false;
    }
    const matches = matchesPattern(url, rule.urlPattern, rule.matchType);
    debugLog('DEBUG', 'Close rule check:', {
      name: rule.name,
      pattern: rule.urlPattern,
      matchType: rule.matchType,
      matches
    });
    return matches;
  });

  // Check for button click rules
  debugLog('DEBUG', 'Checking button click rules against URL:', url);
  const matchingButtonRule = allClickRules.find(rule => {
    if (rule.enabled === false) {
      debugLog('DEBUG', 'Button rule disabled:', rule.name);
      return false;
    }
    const matches = matchesPattern(url, rule.urlPattern, rule.matchType);
    debugLog('DEBUG', 'Button rule check:', {
      name: rule.name,
      pattern: rule.urlPattern,
      matchType: rule.matchType,
      selector: rule.selector,
      matches
    });
    return matches;
  });

  // Cooldown gate: only engage when a rule actually fired on this load.
  // Without a fired rule there is no double-fire risk to suppress, and an
  // in-page URL change later in this navigation must remain free to evaluate
  // (e.g., an exact-match rule matching only a cleaned post-replaceState URL).
  // Placed before the conflict-detection branch so the conflict path also
  // benefits from cooldown protection.
  if (isLoadComplete) {
    if (matchingCloseRule || matchingButtonRule) {
      // A 'load' (tabs.onUpdated 'complete') that matches inside the window a
      // leading 'commit' just opened is the trailing half of one navigation:
      // webNavigation.onCommitted fired first at the committed URL, then the
      // page rewrote the URL during parse, so 'complete' arrives at a
      // *different* URL that dodges the per-URL dedup Set. The commit already
      // fired this rule — suppress the duplicate. The leading 'commit' itself,
      // and a standalone 'load' with no open window, fire normally. A no-match
      // load still falls through to the clear-stale-cooldown branch below.
      if (trigger === 'load' && withinQuietWindow) {
        debugLog('DEBUG', 'Suppressing trailing load-complete duplicate inside post-commit window:', { tabId, url });
        return;
      }
      lastLoadCompleteAt.set(tabId, Date.now());
      checkLastLoadCompleteAtSize();
    } else {
      // No rule fires on this navigation. Clear any stale entry from the
      // previous page on this tab so a SPA event on this fresh page isn't
      // suppressed by an inherited cooldown window.
      lastLoadCompleteAt.delete(tabId);
    }
  }

  // CONFLICT DETECTION: Both rules match
  if (matchingCloseRule && matchingButtonRule) {
    debugLog('DEBUG', 'Conflict detected:', {
      closeRule: matchingCloseRule.name,
      buttonRule: matchingButtonRule.name,
      url
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
    debugLog('DEBUG', 'No rules matched for URL:', url);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const isLoadComplete = changeInfo.status === 'complete';
  const isInPageUrlChange = isInPageUrlChangeEvent(changeInfo);
  if (!isLoadComplete && !isInPageUrlChange) return;

  // `changeInfo.url` wins when set — it's the freshest URL Chrome reports and
  // is the one in-page rewrites populate. `tab.url` is the stable fallback for
  // load-complete events that omit changeInfo.url. `tab` is documented as
  // always present but defensive callers in the wild have hit cases where it
  // is undefined — handleNavigationEvent guards against missing url.
  const url = changeInfo.url || tab?.url;
  const trigger = isLoadComplete ? 'load' : 'spa';
  handleNavigationEvent(tabId, url, trigger);
});

// webNavigation.onCommitted catches the case where a page synchronously
// invokes a custom-protocol URL during parse — Chrome cancels the page load
// and tabs.onUpdated never fires 'complete', but commit already happened.
// Main frame only — subframe commits are not relevant to URL-pattern rules.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  // Only http(s) — commit fires for about:blank, chrome-error://, etc. too,
  // which no URL-pattern rule targets. Skipping them avoids a storage read per
  // such commit and keeps non-http pages on the existing 'complete' path.
  if (!/^https?:\/\//.test(details.url)) return;
  handleNavigationEvent(details.tabId, details.url, 'commit');
});

// Clear all per-tab state — used by both onRemoved (tab gone for good) and
// the conflict-mode post-click handler (let the tab re-evaluate).
//
// The dedup Set holds keys keyed by URL, and any single tab can have entries
// under multiple URLs across a navigation (load-complete URL + post-rewrite
// URL during the same session), so we iterate and delete by tabId prefix
// rather than try to track every URL form.
//
// Spec-safe: ECMA-262 guarantees Set iteration order and that deletes during
// iteration do not skip subsequent entries.
function clearProcessedTabsFor(tabId) {
  const prefix = `${tabId}-`;
  for (const key of processedTabs) {
    if (key.startsWith(prefix)) processedTabs.delete(key);
  }
}

// Clean up per-tab state when tabs close. Without this, lastLoadCompleteAt
// would accumulate stale entries for the lifetime of the service worker, and
// stranded processedTabs keys could swallow a fire on a recycled tabId.
chrome.tabs.onRemoved.addListener((tabId) => {
  lastLoadCompleteAt.delete(tabId);
  clearProcessedTabsFor(tabId);
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
      const tab = sender.tab;

      // SYNCHRONOUSLY clear the cooldown BEFORE the click goes out. If
      // `rule.delay` is small (e.g. 20ms), the page's post-click
      // history.replaceState can fire before any setTimeout-based cleanup
      // would — and if the cooldown is still active when that SPA onUpdated
      // event arrives, the re-evaluation is suppressed permanently (Chrome
      // dispatches one event per replaceState call). Clearing here makes
      // the unblock independent of `rule.delay`.
      if (tab && typeof tab.id === 'number') {
        lastLoadCompleteAt.delete(tab.id);
      }

      (async () => {
        await sendMessageWithRetry(sender.tab.id, { action: 'abortClose' });
        await sendMessageWithRetry(sender.tab.id, {
          action: 'clickButton',
          rule: request.rule
        });

        // After clicking, also clear the per-URL dedup so case (1) — click
        // updates page content but not the URL — re-fires a 'complete' event
        // that re-evaluates. The dedup entry could have been added under
        // EITHER the pre-rewrite URL (load-complete trigger) OR the
        // post-rewrite URL (SPA trigger), so clear all keys for this tab.
        // Best-effort: if the MV3 worker terminates within the next
        // POST_CLICK_REEVAL_MS, this timer never fires and the dedup entries
        // age out naturally via the per-key 5s TAB_TRACKING_TIMEOUT timer.
        if (tab && typeof tab.id === 'number') {
          setTimeout(() => {
            clearProcessedTabsFor(tab.id);
            debugLog('DEBUG', `Cleared processed tab tracking for tab ${tab.id} after button click (allows re-evaluation)`);
          }, POST_CLICK_REEVAL_MS);
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
