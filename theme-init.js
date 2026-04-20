// Apply theme before CSS loads to avoid flash of wrong colors.
// Primary source is chrome.storage.sync but that's async; fall back to a
// same-session localStorage mirror (populated on first load) so subsequent
// opens don't flash.
(function () {
  try {
    var t = localStorage.getItem('cc-theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();
