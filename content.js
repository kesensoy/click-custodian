// Content script for handling button clicks and page interactions

debugLog('DEBUG', 'Click Custodian content script loaded on:', window.location.href);

// Detect whether the visitor has starred our GitHub repo. content.js runs
// on <all_urls>, so the hostname + pathname guard bails out cheaply before
// any DOM work on non-repo pages.
//
// Bidirectional: writes hasStarred=true when the /unstar form is visible
// (user has starred) and hasStarred=false when only the /star form is
// visible (user is logged in but hasn't starred). Logged-out visitors —
// neither form rendered — are left alone so we don't punish someone with
// stale "starred" state just for being logged out at the moment of detect.
//
// Re-runs on every visit AND on Hotwire Turbo's `turbo:load` event so
// in-page navigation between repo subpages (Code → Issues → back) and
// in-place star/unstar clicks both update storage without a hard reload.
(function detectRepoStar() {
  const REPO_PATH = '/kesensoy/click-custodian';
  if (location.hostname !== 'github.com') return;

  const onRepoPage = () =>
    location.pathname === REPO_PATH || location.pathname.startsWith(REPO_PATH + '/');

  // GitHub renders BOTH the /star AND /unstar forms in the repo header at
  // the same time, regardless of starred state — they live as siblings
  // inside .starred and .unstarred wrapper divs that toggle display via
  // CSS. So "form exists" is NOT a state signal; we have to check that the
  // form is actually rendered (no display:none ancestor). Verified live
  // 2026-04-20 — see tests/unit/star-detection.test.js for the contract.
  //
  // Selectors match exact relative AND exact absolute form actions
  // (defense-in-depth — relative is current GH behavior but undocumented),
  // including the `?...` query-string variants. We deliberately avoid
  // `[action$=]` and `[action*=]` because either could false-match nested
  // paths like /someone-else/click-custodian/unstar or a query string
  // echoing user input — both reachable from an attacker-controlled page.
  const buildSelector = (verb) => [
    `form[action="${REPO_PATH}/${verb}"]`,
    `form[action^="${REPO_PATH}/${verb}?"]`,
    `form[action="https://github.com${REPO_PATH}/${verb}"]`,
    `form[action^="https://github.com${REPO_PATH}/${verb}?"]`,
  ].join(', ');
  const UNSTAR_FORM_SELECTOR = buildSelector('unstar');
  const STAR_FORM_SELECTOR = buildSelector('star');

  const isVisiblyRendered = (el) => {
    // Walk the ancestor chain — anything that hides the element kills the
    // signal. display:none is the current GitHub mechanism; the [hidden]
    // attribute and visibility:hidden are cheap defense-in-depth in case
    // they ever change shape.
    for (let node = el; node && node !== document; node = node.parentElement) {
      if (node.hidden) return false;
      const cs = window.getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  };
  const anyVisible = (selector) =>
    Array.from(document.querySelectorAll(selector)).some(isVisiblyRendered);

  // Returns 'starred' | 'unstarred' | null (null = signal absent: header
  // not yet rendered, user logged out, etc.). null means "don't write."
  const detectState = () => {
    if (anyVisible(UNSTAR_FORM_SELECTOR)) return 'starred';
    if (anyVisible(STAR_FORM_SELECTOR)) return 'unstarred';
    return null;
  };

  // Pre-check storage before writing — repeated visits to the same starred
  // repo otherwise burn writes against the 120/min sync quota for no state
  // change. Storage is read-cheap relative to write-cheap.
  const writeIfChanged = async (state) => {
    const desired = state === 'starred';
    try {
      const stored = await chrome.storage.sync.get(['hasStarred']);
      if (stored.hasStarred === desired) return;
      await chrome.storage.sync.set({ hasStarred: desired });
    } catch (e) { /* storage unavailable — silently no-op */ }
  };

  // A rapid Turbo nav (Code → Issues → Code in <3s) would otherwise stack
  // overlapping retry timers writing the same value. Track + cancel.
  let activeRetryTimer = null;

  const runDetection = () => {
    if (!onRepoPage()) return;
    const initial = detectState();
    if (initial !== null) {
      writeIfChanged(initial);
      return;
    }
    if (activeRetryTimer !== null) clearInterval(activeRetryTimer);
    let attempts = 0;
    activeRetryTimer = setInterval(() => {
      attempts++;
      const state = detectState();
      if (state !== null) {
        writeIfChanged(state);
        clearInterval(activeRetryTimer);
        activeRetryTimer = null;
      } else if (attempts >= 6) {
        clearInterval(activeRetryTimer);
        activeRetryTimer = null;
      }
    }, 500);
  };

  runDetection();
  // Turbo navigation: GitHub swaps page content without a full reload, so
  // our IIFE wouldn't otherwise re-run. `turbo:load` fires on both the
  // initial visit and every subsequent in-page nav.
  document.addEventListener('turbo:load', runDetection);
})();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog('DEBUG', 'Content script received message:', request.action, request);

  if (request.action === 'clickButton') {
    debugLog('DEBUG', 'Handling clickButton');
    handleButtonClick(request.rule);
  } else if (request.action === 'checkButtonExists') {
    debugLog('DEBUG', 'Handling checkButtonExists');
    handleButtonCheck(request.rule, request.closeRuleDelay);
  } else if (request.action === 'startCountdown') {
    debugLog('DEBUG', 'Handling startCountdown with delay:', request.delay);
    startCountdown(request.delay);
  } else if (request.action === 'abortClose') {
    debugLog('DEBUG', 'Handling abortClose');
    abortCountdownIfActive();
  }
});

// Handle automatic button clicking
// Shared helper to find button using selector and optional text matching
async function findButton(rule) {
  debugLog('DIAGNOSTIC', 'findButton START:', {
    selector: rule.selector,
    buttonText: rule.buttonText,
    timestamp: Date.now()
  });

  let button = null;
  let allMatches = [];

  // Try to find button using selector with smart polling (max 3 seconds)
  debugLog('DIAGNOSTIC', 'Starting primary selector search (3s timeout)');
  const primarySearchStart = Date.now();
  try {
    const result = await waitForElements(rule.selector, rule.buttonText, 3000);
    button = result.selected;
    allMatches = result.allMatches || [];
    const primarySearchDuration = Date.now() - primarySearchStart;
    debugLog('DIAGNOSTIC', 'Primary search SUCCESS:', {
      found: !!button,
      matchCount: allMatches.length,
      duration: primarySearchDuration + 'ms'
    });
  } catch (error) {
    const primarySearchDuration = Date.now() - primarySearchStart;
    debugLog('DIAGNOSTIC', 'Primary search FAILED:', {
      duration: primarySearchDuration + 'ms',
      error: error.message
    });
  }

  // If no button found by selector, try finding by text only
  if (!button && rule.buttonText) {
    debugLog('DIAGNOSTIC', 'Starting fallback text search (immediate, no polling)');
    const fallbackStart = Date.now();
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.button, [role="button"]'));
    debugLog('DIAGNOSTIC', 'Fallback: Found ' + buttons.length + ' total clickable elements');
    allMatches = buttons.filter(btn => btn.textContent.trim().includes(rule.buttonText));
    button = allMatches[0];
    const fallbackDuration = Date.now() - fallbackStart;
    debugLog('DIAGNOSTIC', 'Fallback search complete:', {
      found: !!button,
      matchCount: allMatches.length,
      duration: fallbackDuration + 'ms'
    });
    if (button) {
      debugLog('DIAGNOSTIC', `Fallback found ${allMatches.length} button(s) matching text "${rule.buttonText}"`);
    }
  }

  debugLog('DIAGNOSTIC', 'findButton END:', {
    success: !!button,
    totalDuration: Date.now() - primarySearchStart + 'ms'
  });

  return { button, allMatches };
}

async function handleButtonClick(rule) {
  // Cancel any stale countdown from a previous URL match (SPA navigation race condition)
  abortCountdownIfActive();

  // Use shared button-finding logic
  const { button, allMatches } = await findButton(rule);

  if (button) {
    // Show visual feedback for all matches, highlighting the selected one
    showClickFeedback(button, allMatches, rule.delay);

    // Wait for configured delay, then click
    setTimeout(() => {
      button.click();
      debugLog('DEBUG', 'Button clicked successfully');
    }, rule.delay);
  } else {
    debugLog('DEBUG', 'Button not found with selector:', rule.selector, 'and text:', rule.buttonText);
  }
}

// Handle button existence check for conflict resolution
async function handleButtonCheck(rule, closeRuleDelay) {
  debugLog('DEBUG', 'handleButtonCheck starting, rule:', rule, 'closeRuleDelay:', closeRuleDelay);

  // Use shared button-finding logic
  const { button } = await findButton(rule);

  debugLog('DEBUG', 'Button search complete, found:', !!button);

  // Report result back to background script
  if (button) {
    debugLog('DEBUG', `Sending buttonCheckResult: found=true`);
    chrome.runtime.sendMessage({
      action: 'buttonCheckResult',
      found: true,
      rule: rule
    });
  } else {
    debugLog('DEBUG', `Button not found after polling - starting countdown`);

    // Button not found after polling - start countdown now
    if (closeRuleDelay) {
      startCountdown(closeRuleDelay);
    }

    debugLog('DEBUG', `Sending buttonCheckResult: found=false`);
    chrome.runtime.sendMessage({
      action: 'buttonCheckResult',
      found: false,
      rule: rule
    });
  }
}

// Show visual feedback when auto-clicking
function showClickFeedback(selectedElement, allMatches = [], clickDelay = 200) {
  const indicators = [];

  // Helper to find visible element with dimensions
  const findVisibleElement = (element) => {
    let rect = element.getBoundingClientRect();

    // If element has no dimensions, walk up the DOM tree to find visible parent
    if (rect.width === 0 || rect.height === 0) {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const currentRect = current.getBoundingClientRect();
        if (currentRect.width > 0 && currentRect.height > 0) {
          return { rect: currentRect };
        }
        current = current.parentElement;
      }
    }

    return { rect };
  };

  // Create indicators for all matching buttons
  allMatches.forEach((match) => {
    const { rect } = findVisibleElement(match);

    // Skip if no dimensions
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const isSelected = match === selectedElement;
    const indicator = document.createElement('div');
    indicator.className = 'click-custodian-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px solid ${isSelected ? '#4CAF50' : '#FFC107'};
      background-color: ${isSelected ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255, 193, 7, 0.2)'};
      pointer-events: none;
      z-index: 999999;
      box-sizing: border-box;
    `;

    document.body.appendChild(indicator);
    indicators.push(indicator);
  });

  // If no matches had dimensions, show fallback at center
  if (indicators.length === 0) {
    const indicator = document.createElement('div');
    indicator.className = 'click-custodian-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: ${window.innerHeight / 2 - 50}px;
      left: ${window.innerWidth / 2 - 100}px;
      width: 200px;
      height: 100px;
      border: 3px solid #4CAF50;
      background-color: rgba(76, 175, 80, 0.2);
      pointer-events: none;
      z-index: 999999;
      box-sizing: border-box;
    `;
    document.body.appendChild(indicator);
    indicators.push(indicator);
  }

  // Keep indicators visible during delay + 500ms extra so user sees them after click
  const displayDuration = clickDelay + 500;
  setTimeout(() => {
    indicators.forEach(indicator => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    });
  }, displayDuration);
}

// Helper function to wait for element to appear, with optional text matching
// Returns { selected: element, allMatches: [element1, element2, ...] }
function waitForElements(selector, buttonText, timeout = 5000) {
  return new Promise((resolve, reject) => {
    debugLog('DIAGNOSTIC', 'waitForElements START:', {
      selector,
      buttonText,
      timeout
    });

    let checkCount = 0;
    const startTime = Date.now();
    let observer = null;

    // Helper to find matching elements
    const findMatchingElements = () => {
      checkCount++;
      let elements;
      try {
        elements = document.querySelectorAll(selector);
      } catch (e) {
        debugError('ERROR', 'Invalid CSS selector:', e);
        if (observer) observer.disconnect();
        reject(e);
        return null;
      }
      debugLog('DIAGNOSTIC', `Check #${checkCount} (${Date.now() - startTime}ms): Found ${elements.length} elements with selector "${selector}"`);

      const allMatches = [];

      // If no buttonText specified, return first element
      if (!buttonText) {
        if (elements.length > 0) {
          debugLog('DIAGNOSTIC', 'No buttonText filter - returning first element');
          return { selected: elements[0], allMatches: [elements[0]] };
        }
        return null;
      }

      // Search through all elements for text matches
      for (const element of elements) {
        const text = element.textContent.trim();
        if (text.includes(buttonText)) {
          allMatches.push(element);
          debugLog('DIAGNOSTIC', `Match found: "${text.substring(0, 50)}..."`);
        }
      }

      if (allMatches.length > 0) {
        debugLog('DIAGNOSTIC', `Returning ${allMatches.length} text matches`);
        return { selected: allMatches[0], allMatches };
      }

      return null;
    };

    // Check immediately
    debugLog('DIAGNOSTIC', 'Immediate check...');
    const result = findMatchingElements();
    if (result) {
      debugLog('DIAGNOSTIC', 'Found immediately! No polling needed');
      resolve(result);
      return;
    }

    debugLog('DIAGNOSTIC', 'Not found immediately - setting up MutationObserver...');

    // Set up observer to watch for new elements
    observer = new MutationObserver((mutations, obs) => {
      debugLog('DIAGNOSTIC', `Mutation detected at ${Date.now() - startTime}ms (${mutations.length} mutations)`);
      const result = findMatchingElements();
      if (result) {
        debugLog('DIAGNOSTIC', `Found via MutationObserver after ${Date.now() - startTime}ms!`);
        obs.disconnect();
        resolve(result);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Timeout after specified duration
    setTimeout(() => {
      const duration = Date.now() - startTime;
      debugLog('DIAGNOSTIC', `Timeout after ${duration}ms (${checkCount} checks total)`);
      observer.disconnect();
      reject(new Error(`Element ${selector}${buttonText ? ` with text "${buttonText}"` : ''} not found within ${timeout}ms`));
    }, timeout);
  });
}

// Legacy helper function for backward compatibility
function waitForElement(selector, timeout = 5000) {
  return waitForElements(selector, null, timeout).then(result => result.selected);
}

// Resolve overlay theme + palette from chrome.storage.sync.
// theme can be 'light', 'dark', 'auto' (or missing). Anything non-light/dark
// falls back to the OS prefers-color-scheme so future 'auto' mode just works.
async function resolveOverlayTheme() {
  let theme = 'auto';
  let palette = 'navy';
  try {
    const stored = await chrome.storage.sync.get(['theme', 'palette']);
    if (stored.theme) theme = stored.theme;
    if (stored.palette) palette = stored.palette;
  } catch (e) {
    debugLog('DEBUG', 'Failed to read theme/palette from storage:', e.message);
  }
  const resolvedTheme = (theme === 'light' || theme === 'dark')
    ? theme
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  return { rawTheme: theme, resolvedTheme, palette };
}

function applyOverlayAttributes(overlay, { resolvedTheme, palette, rawTheme }) {
  overlay.setAttribute('data-cc-theme', resolvedTheme);
  overlay.setAttribute('data-cc-palette', palette);
  overlay.dataset.ccThemeMode = rawTheme;
}

// Countdown management for tab closing
let countdownState = null;

function startCountdown(delay) {
  debugLog('DEBUG', 'startCountdown called with delay:', delay);

  // Check if countdown already exists
  if (document.getElementById('click-custodian-overlay')) {
    debugLog('DEBUG', 'Countdown overlay already exists, skipping');
    return;
  }

  debugLog('DEBUG', 'Creating countdown overlay');

  // Create overlay
  //
  // Ring sizing: r=30, circumference = 2π·30 ≈ 188.5. We start at full
  // circumference (whole ring visible) and decrement stroke-dashoffset each
  // second so the arc shrinks as time runs out. The seconds number is the
  // source of truth for the timer; the ring is a visual echo.
  const totalSeconds = Math.ceil(delay / 1000);
  const ringCircumference = 188.5;
  const overlay = document.createElement('div');
  overlay.id = 'click-custodian-overlay';
  overlay.innerHTML = `
    <div class="click-custodian-countdown" data-click-custodian-countdown="true">
      <div class="click-custodian-ring" aria-hidden="true">
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle class="click-custodian-ring-track" cx="36" cy="36" r="30" stroke-width="4"/>
          <circle class="click-custodian-ring-progress" cx="36" cy="36" r="30" stroke-width="4"
                  stroke-dasharray="${ringCircumference}" stroke-dashoffset="0"/>
        </svg>
        <div class="click-custodian-ring-num"><span id="click-custodian-seconds">${totalSeconds}</span></div>
      </div>
      <div class="click-custodian-text">
        <h3 class="click-custodian-message">Closing this <em>tab</em></h3>
        <p class="click-custodian-subline">Click Custodian matched a rule on this URL.</p>
        <div class="click-custodian-actions">
          <button id="click-custodian-abort" class="click-custodian-button" type="button">Cancel</button>
          <kbd class="click-custodian-kbd">Esc</kbd>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  debugLog('DEBUG', 'Countdown overlay appended to body');

  // Apply theme + palette from extension settings. Fire-and-forget: storage
  // reads complete in a few ms, well before the slide-up animation settles.
  resolveOverlayTheme().then(info => applyOverlayAttributes(overlay, info));

  // Live-update if user flips theme or palette while countdown is visible.
  const storageListener = (changes, area) => {
    if (area !== 'sync') return;
    if (!changes.theme && !changes.palette) return;
    resolveOverlayTheme().then(info => applyOverlayAttributes(overlay, info));
  };
  chrome.storage.onChanged.addListener(storageListener);

  // Live-update when OS theme changes and we're in auto mode.
  const osQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const osListener = () => {
    const mode = overlay.dataset.ccThemeMode;
    if (mode === 'light' || mode === 'dark') return;
    overlay.setAttribute('data-cc-theme', osQuery.matches ? 'dark' : 'light');
  };
  osQuery.addEventListener('change', osListener);

  let secondsLeft = totalSeconds;
  const secondsSpan = document.getElementById('click-custodian-seconds');
  const abortButton = document.getElementById('click-custodian-abort');
  const ringProgress = overlay.querySelector('.click-custodian-ring-progress');

  let aborted = false;

  // Abort handler function
  const abortCountdown = () => {
    debugLog('DEBUG', 'abortCountdown called, aborted:', aborted);
    if (aborted) return;
    aborted = true;
    debugLog('DEBUG', 'Removing countdown overlay and cleaning up');
    overlay.remove();
    document.removeEventListener('keydown', handleEscape);
    chrome.storage.onChanged.removeListener(storageListener);
    osQuery.removeEventListener('change', osListener);
    chrome.runtime.sendMessage({ action: 'abortClose' });
    countdownState = null;
  };

  // Handle Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      abortCountdown();
    }
  };

  // Attach event listeners
  abortButton.addEventListener('click', abortCountdown);
  document.addEventListener('keydown', handleEscape);

  // Countdown interval
  const interval = setInterval(() => {
    if (aborted) {
      clearInterval(interval);
      return;
    }

    secondsLeft--;
    secondsSpan.textContent = secondsLeft;

    // Shrink the ring arc to match remaining time (visual only).
    if (ringProgress && totalSeconds > 0) {
      const consumed = totalSeconds - Math.max(secondsLeft, 0);
      const offset = (consumed / totalSeconds) * ringCircumference;
      ringProgress.setAttribute('stroke-dashoffset', String(offset));
    }

    if (secondsLeft <= 0) {
      clearInterval(interval);
      document.removeEventListener('keydown', handleEscape);
      chrome.storage.onChanged.removeListener(storageListener);
      osQuery.removeEventListener('change', osListener);
      chrome.runtime.sendMessage({ action: 'closeTab' });
      countdownState = null;
    }
  }, 1000);

  // Store state so we can abort programmatically
  countdownState = { interval, abortCountdown, handleEscape };
}

function abortCountdownIfActive() {
  debugLog('DEBUG', 'abortCountdownIfActive called, state:', !!countdownState);

  if (countdownState) {
    debugLog('DEBUG', 'Aborting active countdown');
    countdownState.abortCountdown();
  } else {
    debugLog('DEBUG', 'No active countdown to abort');
  }
}
