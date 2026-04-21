/**
 * Unit tests for the GitHub repo star-detection logic in content.js.
 *
 * Mirrors the project's existing pattern (see pattern-matching.test.js):
 * production source files don't export functions, so the predicate is
 * copied here. Keep this in sync with content.js:detectRepoStar().
 */

const REPO_PATH = '/kesensoy/click-custodian';

/**
 * COPIED FROM content.js — the form-action selector that distinguishes
 * starred (unstar form present) from unstarred (star form present).
 */
const STAR_FORM_SELECTOR = [
  `form[action="${REPO_PATH}/unstar"]`,
  `form[action^="${REPO_PATH}/unstar?"]`,
  `form[action="https://github.com${REPO_PATH}/unstar"]`,
  `form[action^="https://github.com${REPO_PATH}/unstar?"]`,
].join(', ');

function isVisiblyRendered(el) {
  for (let node = el; node && node !== document; node = node.parentElement) {
    if (window.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

function isStarred() {
  const forms = document.querySelectorAll(STAR_FORM_SELECTOR);
  return Array.from(forms).some(isVisiblyRendered);
}

function setBodyHTML(html) {
  document.body.innerHTML = html;
}

describe('star detection — form selector', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('detects starred state when /unstar form is present', () => {
    setBodyHTML(`<form action="${REPO_PATH}/unstar" method="post"></form>`);
    expect(isStarred()).toBe(true);
  });

  test('detects starred state when /unstar form has query string', () => {
    setBodyHTML(`<form action="${REPO_PATH}/unstar?async=1" method="post"></form>`);
    expect(isStarred()).toBe(true);
  });

  test('reports unstarred when only /star form is present', () => {
    setBodyHTML(`<form action="${REPO_PATH}/star" method="post"></form>`);
    expect(isStarred()).toBe(false);
  });

  test('reports unstarred on empty DOM (header not yet rendered)', () => {
    expect(isStarred()).toBe(false);
  });

  test('does not false-positive on /stargazers links — substring match would', () => {
    // /stargazers is a real GitHub URL on every repo page. A naive
    // selector like `form[action^="/repo/star"]` would match it; the
    // exact + `?` variants in the production selector must not.
    setBodyHTML(`
      <a href="${REPO_PATH}/stargazers">123 stargazers</a>
      <form action="${REPO_PATH}/stargazers/refresh"></form>
    `);
    expect(isStarred()).toBe(false);
  });

  test('does not match a different repo\'s unstar form', () => {
    setBodyHTML(`<form action="/someoneelse/different-repo/unstar" method="post"></form>`);
    expect(isStarred()).toBe(false);
  });

  test('detects starred state when GitHub renders absolute form actions', () => {
    // Defense-in-depth: GitHub currently renders relative actions, but if
    // they ever switch to absolute URLs the explicit absolute-URL selector
    // still catches it. The hostname guard in production prevents this
    // from matching forms on a non-github.com page.
    setBodyHTML(`<form action="https://github.com${REPO_PATH}/unstar" method="post"></form>`);
    expect(isStarred()).toBe(true);
  });

  test('does not false-match a nested path that ends with our repo+/unstar', () => {
    // An earlier `[action$="..."]` selector would have matched this — the
    // exact selectors must not.
    setBodyHTML(`<form action="/someoneelse${REPO_PATH}/unstar" method="post"></form>`);
    expect(isStarred()).toBe(false);
  });

  test('does not false-match a query-string echoing our repo path', () => {
    // An earlier `[action*="..."]` selector would have matched this. Must not.
    setBodyHTML(`<form action="${REPO_PATH}/anything?goto=${REPO_PATH}/unstar" method="post"></form>`);
    expect(isStarred()).toBe(false);
  });

  test('treats GitHub layout where /unstar form exists but is display:none as NOT starred', () => {
    // Critical: GitHub renders BOTH /star and /unstar forms in the DOM at
    // all times, inside .starred / .unstarred wrapper divs that toggle via
    // display:none. The mere presence of an /unstar form is NOT a starred
    // signal — verified against live github.com on 2026-04-20. The only
    // honest signal is whether the form is actually rendered to the user.
    setBodyHTML(`
      <div class="starred" style="display:none;">
        <form action="${REPO_PATH}/unstar" method="post"><button>Unstar</button></form>
      </div>
      <div class="unstarred" style="display:flex;">
        <form action="${REPO_PATH}/star" method="post"><button>Star</button></form>
      </div>
    `);
    expect(isStarred()).toBe(false);
  });

  test('treats GitHub layout where /unstar wrapper is visible as starred', () => {
    // The mirrored case — user IS starred, .starred wrapper is visible,
    // .unstarred wrapper is hidden.
    setBodyHTML(`
      <div class="starred" style="display:flex;">
        <form action="${REPO_PATH}/unstar" method="post"><button>Unstar</button></form>
      </div>
      <div class="unstarred" style="display:none;">
        <form action="${REPO_PATH}/star" method="post"><button>Star</button></form>
      </div>
    `);
    expect(isStarred()).toBe(true);
  });

  test('any display:none anywhere in the ancestor chain hides the form', () => {
    // GitHub nests forms several divs deep. The check must walk the whole
    // chain, not just the immediate parent.
    setBodyHTML(`
      <div style="display:none;">
        <div>
          <div>
            <form action="${REPO_PATH}/unstar" method="post"><button>Unstar</button></form>
          </div>
        </div>
      </div>
    `);
    expect(isStarred()).toBe(false);
  });
});

describe('star detection — URL guard', () => {
  // The production code guards with:
  //   if (location.hostname !== 'github.com') return;
  //   if (location.pathname !== REPO_PATH &&
  //       !location.pathname.startsWith(REPO_PATH + '/')) return;
  //
  // Validates the matcher predicate directly — keeps the test
  // independent of jsdom's read-only `location` object.
  function shouldRunOn(hostname, pathname) {
    if (hostname !== 'github.com') return false;
    if (pathname !== REPO_PATH && !pathname.startsWith(REPO_PATH + '/')) return false;
    return true;
  }

  test('runs on the bare repo path', () => {
    expect(shouldRunOn('github.com', REPO_PATH)).toBe(true);
  });

  test('runs on subpaths (issues, pulls, tree, etc.)', () => {
    expect(shouldRunOn('github.com', `${REPO_PATH}/issues`)).toBe(true);
    expect(shouldRunOn('github.com', `${REPO_PATH}/tree/main`)).toBe(true);
  });

  test('skips non-github hosts', () => {
    expect(shouldRunOn('gitlab.com', REPO_PATH)).toBe(false);
    expect(shouldRunOn('example.com', '/anything')).toBe(false);
  });

  test('skips other repos on github.com', () => {
    expect(shouldRunOn('github.com', '/kesensoy/sneetches')).toBe(false);
    expect(shouldRunOn('github.com', '/anyone/click-custodian-fork')).toBe(false);
  });

  test('skips paths that share the repo prefix without the slash boundary', () => {
    // /kesensoy/click-custodian-other should NOT match /kesensoy/click-custodian.
    // The startsWith check uses REPO_PATH + '/' specifically to enforce the
    // boundary and avoid this false positive.
    expect(shouldRunOn('github.com', '/kesensoy/click-custodian-other')).toBe(false);
  });
});
