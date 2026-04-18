const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    // Headless in CI environments, headed locally for debugging
    // Set CI=true to force headless mode
    // Or use 'npx playwright test --headed' to force headed mode
    headless: process.env.CI !== undefined,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
