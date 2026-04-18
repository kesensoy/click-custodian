// debug.js - Centralized debug logging utility

// Toggle debug mode:
// - Set to false for production (no console pollution)
// - Set to true for development (verbose logging)
// - Could be configurable via extension options in future
const DEBUG = false; // Set to true for development debugging

/**
 * Logs a debug message if DEBUG mode is enabled.
 * @param {string} category - Log category (e.g., 'DEBUG', 'DIAGNOSTIC')
 * @param {string} message - The message to log
 * @param {*} data - Optional data to include in log
 */
function debugLog(category, message, data = null) {
  if (DEBUG) {
    if (data !== null) {
      console.log(`[${category}] ${message}`, data);
    } else {
      console.log(`[${category}] ${message}`);
    }
  }
}

/**
 * Logs an error message (always shown, regardless of DEBUG flag).
 * @param {string} category - Log category
 * @param {string} message - The error message
 * @param {*} error - Optional error object
 */
function debugError(category, message, error = null) {
  if (error !== null) {
    console.error(`[${category}] ${message}`, error);
  } else {
    console.error(`[${category}] ${message}`);
  }
}

// Export for ES6 modules (if using modules)
// For Chrome Extension without modules, functions are global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { debugLog, debugError, DEBUG };
}
