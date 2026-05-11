const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*/tests/*.spec.js',
  timeout: 30000,
  retries: 0,
  workers: 1, // Extensions require persistent context — run serially
  reporter: 'list',
  use: {
    // Extensions only work in headed Chromium (not headless)
    headless: false,
  },
});
