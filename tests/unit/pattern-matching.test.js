/**
 * Unit tests for URL pattern matching logic
 * Tests background.js:matchesPattern() function
 */

// Mock Chrome API
global.chrome = {
  runtime: { id: 'test-extension-id' }
};

// Import function under test
// Note: background.js needs to export functions for testing
// For now, we'll copy the function or use dynamic import

/**
 * COPIED FROM background.js for testing
 * TODO: Refactor background.js to export functions
 */
function globMatch(url, pattern) {
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(url);
}

function matchesPattern(url, pattern, matchType) {
  switch (matchType) {
    case 'glob':
      return globMatch(url, pattern);
    case 'regex':
      try {
        const regex = new RegExp(pattern);
        return regex.test(url);
      } catch (e) {
        console.error('Invalid regex pattern:', pattern);
        return false;
      }
    case 'exact':
      return url === pattern;
    case 'contains':
      return url.includes(pattern);
    default:
      console.error('Unknown match type:', matchType);
      return false;
  }
}

describe('Pattern Matching', () => {
  describe('glob matching', () => {
    test('matches wildcard protocol', () => {
      expect(matchesPattern('https://example.com/', '*://example.com/', 'glob')).toBe(true);
      expect(matchesPattern('http://example.com/', '*://example.com/', 'glob')).toBe(true);
    });

    test('matches wildcard path', () => {
      expect(matchesPattern('https://example.com/path/to/page', 'https://example.com/*', 'glob')).toBe(true);
      expect(matchesPattern('https://example.com/', 'https://example.com/*', 'glob')).toBe(true);
    });

    test('matches wildcard subdomain', () => {
      expect(matchesPattern('https://sub.example.com/', 'https://*.example.com/', 'glob')).toBe(true);
      expect(matchesPattern('https://example.com/', 'https://*.example.com/', 'glob')).toBe(false);
    });

    test('does not match different domain', () => {
      expect(matchesPattern('https://other.com/', '*://example.com/*', 'glob')).toBe(false);
    });

    test('case insensitive matching', () => {
      expect(matchesPattern('HTTPS://EXAMPLE.COM/', '*://example.com/', 'glob')).toBe(true);
    });
  });

  describe('regex matching', () => {
    test('matches regex pattern', () => {
      expect(matchesPattern('https://example.com/123', 'https://example\\.com/\\d+', 'regex')).toBe(true);
      expect(matchesPattern('https://example.com/abc', 'https://example\\.com/\\d+', 'regex')).toBe(false);
    });

    test('handles invalid regex gracefully', () => {
      expect(matchesPattern('https://example.com/', '(invalid[regex', 'regex')).toBe(false);
    });

    test('negative lookahead regex excludes specific sub-paths', () => {
      const pattern = '^https://example\\.com/app/#/(?!device).*$';
      // Should NOT match device sub-path
      expect(matchesPattern('https://example.com/app/#/device?user_code=ABCD-1234', pattern, 'regex')).toBe(false);
      // Should match post-approval pages
      expect(matchesPattern('https://example.com/app/#/', pattern, 'regex')).toBe(true);
      expect(matchesPattern('https://example.com/app/#/?action=authorize&clientId=abc', pattern, 'regex')).toBe(true);
      expect(matchesPattern('https://example.com/app/#/success', pattern, 'regex')).toBe(true);
    });
  });

  describe('exact matching', () => {
    test('matches exact URL', () => {
      expect(matchesPattern('https://example.com/', 'https://example.com/', 'exact')).toBe(true);
    });

    test('does not match partial URL', () => {
      expect(matchesPattern('https://example.com/path', 'https://example.com/', 'exact')).toBe(false);
    });
  });

  describe('contains matching', () => {
    test('matches substring', () => {
      expect(matchesPattern('https://example.com/auth/callback', '/auth/callback', 'contains')).toBe(true);
    });

    test('does not match non-substring', () => {
      expect(matchesPattern('https://example.com/', '/auth/callback', 'contains')).toBe(false);
    });
  });
});
