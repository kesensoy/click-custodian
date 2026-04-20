// Inject conflict test rules (both button + close rules for same URL)
// Run in Options page console (Right-click extension → Options → F12 → Console)

chrome.storage.sync.get(['buttonClickRules', 'tabCloseRules'], (result) => {
  const buttonClickRules = result.buttonClickRules || [];
  const tabCloseRules = result.tabCloseRules || [];

  // Add button click rule for conflict test
  buttonClickRules.push({
    id: 'test-conflict-button',
    name: 'Test Conflict Button',
    urlPattern: 'file://*/manual-tests/test-conflict-*.html',
    matchType: 'glob',
    selector: 'button',
    buttonText: 'Sign In',
    delay: 200,
    enabled: true
  });

  // Add tab close rule for conflict test
  tabCloseRules.push({
    id: 'test-conflict-close',
    name: 'Test Conflict Close',
    urlPattern: 'file://*/manual-tests/test-conflict-*.html',
    matchType: 'glob',
    delay: 3000,
    enabled: true
  });

  chrome.storage.sync.set({ buttonClickRules, tabCloseRules }, () => {
    console.log('✅ Conflict test rules injected!');
    console.log('Button rule + Close rule both match: file://*/manual-tests/test-conflict-*.html');
    console.log('Ready to test:');
    console.log('  - test-conflict-button-present.html (should click button, NO countdown)');
    console.log('  - test-conflict-button-absent.html (should show countdown after 3s)');
  });
});
