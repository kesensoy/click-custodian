// Minimal JSON tokenizer for the Click Custodian options-page editor.
// Returns an HTML string with token-classed spans (.t-key, .t-string,
// .t-number, .t-bool, .t-null, .t-punct) for use as innerHTML on the
// overlay <code> element. Not a parser — runs cleanly on invalid JSON,
// just leaves unrecognized fragments unclassified.
//
// Token order matters: keys (a string immediately followed by a colon)
// must be tested before generic strings so the colon stays out of the
// generic-string match. Strings allow escape sequences (\\.) and any
// character except an unescaped quote, backslash, or newline — matching
// strict JSON.
(function () {
  'use strict';

  const RX = /("(?:\\.|[^"\\\n])*")(\s*:)|("(?:\\.|[^"\\\n])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}\[\],:])/g;

  function escapeHTML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightJSON(text) {
    let out = '';
    let i = 0;
    let m;
    RX.lastIndex = 0;
    while ((m = RX.exec(text)) !== null) {
      if (m.index > i) out += escapeHTML(text.slice(i, m.index));
      const [whole, key, kColon, str, num, bool, nul, punct] = m;
      if (key !== undefined) {
        out += '<span class="t-key">' + escapeHTML(key) + '</span>';
        out += '<span class="t-punct">' + escapeHTML(kColon) + '</span>';
      } else if (str !== undefined) {
        out += '<span class="t-string">' + escapeHTML(str) + '</span>';
      } else if (num !== undefined) {
        out += '<span class="t-number">' + escapeHTML(num) + '</span>';
      } else if (bool !== undefined) {
        out += '<span class="t-bool">' + escapeHTML(bool) + '</span>';
      } else if (nul !== undefined) {
        out += '<span class="t-null">' + escapeHTML(nul) + '</span>';
      } else if (punct !== undefined) {
        out += '<span class="t-punct">' + escapeHTML(punct) + '</span>';
      }
      i = m.index + whole.length;
    }
    if (i < text.length) out += escapeHTML(text.slice(i));
    // Trailing newline keeps the overlay's content height aligned with the
    // textarea when the user's last line is empty.
    return out + '\n';
  }

  window.highlightJSON = highlightJSON;
})();
