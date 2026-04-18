// Run this in the service worker console to inject button-only test rule
// 1. Go to chrome://extensions
// 2. Click "service worker" under Click Custodian
// 3. Paste this entire script and press Enter

chrome.storage.sync.get(['userRules'], (result) => {
  const userRules = result.userRules || { tabCloseRules: [], buttonClickRules: [] };

  // Add button-only test rule
  userRules.buttonClickRules.push({
    id: 'test-button-only',
    name: 'Test Button Only',
    urlPattern: 'file://*/manual-tests/test-button-only.html',
    matchType: 'glob',
    selector: 'button',
    buttonText: 'Sign In',
    delay: 200
  });

  chrome.storage.sync.set({ userRules }, () => {
    console.log('✅ Button-only test rule injected!');
    console.log('Now open: file:///.../manual-tests/test-button-only.html');
  });
});
