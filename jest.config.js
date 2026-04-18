// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: [
    '**/tests/unit/**/*.test.js'
  ],
  collectCoverageFrom: [
    'background.js',
    'content.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  // NOTE: Unit tests in tests/unit/ use copied function stubs rather than importing from
  // production source (background.js, content.js do not export functions). Tests validate
  // behavioral approximations and may diverge from production implementations (e.g. glob
  // case-sensitivity, text matching strategy). Refactor source files to export functions
  // before enabling coverage thresholds or treating unit test results as authoritative.
  // TODO: Enable coverage thresholds after refactoring source files to export functions
  // coverageThreshold: {
  //   global: {
  //     functions: 70,
  //     lines: 70,
  //     statements: 70
  //   }
  // },
  transformIgnorePatterns: [
    'node_modules/(?!(@exodus/bytes)/)'
  ]
};
