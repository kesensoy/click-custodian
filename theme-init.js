// Apply theme + palette before CSS loads to avoid flash of wrong colors.
// Primary source is chrome.storage.sync but that's async; fall back to a
// same-session localStorage mirror (populated on first load) so subsequent
// opens don't flash.
//
// The 'theme' preference can be 'light', 'dark', or 'auto'. The applied
// data-theme attribute is always the RESOLVED value ('light' | 'dark') so
// stylesheets don't need to know about 'auto'.
(function () {
  try {
    var pref = localStorage.getItem('cc-theme');
    var resolved;
    if (pref === 'light' || pref === 'dark') {
      resolved = pref;
    } else {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }

  try {
    var p = localStorage.getItem('cc-palette');
    // Only set attribute for non-default palettes; default "navy" is implied
    // by the absence of the attribute (base :root tokens).
    if (p && p !== 'navy' && (p === 'moss' || p === 'graphite' || p === 'ember')) {
      document.documentElement.setAttribute('data-palette', p);
    }
  } catch (e) { /* no palette override */ }
})();
