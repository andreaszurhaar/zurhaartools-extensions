const path = require('path');
const { chromium } = require('@playwright/test');

const EXTENSION_PATH = path.resolve(__dirname, '..');

/**
 * Launch a Chromium browser with the extension loaded.
 * Returns { context, extensionId }.
 */
async function launchExtension() {
  const userDataDir = path.join(__dirname, '..', '..', 'test-results', '.tmp-profile');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  // Wait for the service worker to register, then extract extension ID
  let extensionId;
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const swUrl = sw.url();
  // URL format: chrome-extension://<id>/shared/background.js
  const match = swUrl.match(/chrome-extension:\/\/([^/]+)/);
  if (match) {
    extensionId = match[1];
  } else {
    throw new Error(`Could not extract extension ID from service worker URL: ${swUrl}`);
  }

  return { context, extensionId };
}

/**
 * Open the side panel page in a new tab.
 */
async function openSidePanel(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel.html`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/**
 * Pre-seed a license key into chrome.storage.local.
 * Must be called on a chrome-extension:// page.
 */
async function seedLicenseKey(page, key) {
  await page.evaluate((k) => {
    return new Promise(resolve => chrome.storage.local.set({ license_key: k }, resolve));
  }, key);
}

/**
 * Clear the license key from chrome.storage.local.
 */
async function clearLicenseKey(page) {
  await page.evaluate(() => {
    return new Promise(resolve => chrome.storage.local.remove(['license_key'], resolve));
  });
}

/**
 * Mock the /api/credits endpoint to return a specific credits count.
 */
async function mockCreditsAPI(page, creditsRemaining) {
  await page.route('**/api/credits**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ credits_remaining: creditsRemaining }),
    });
  });
}

/**
 * Mock the /api/credits endpoint to return an invalid key error.
 */
async function mockCreditsInvalidKey(page) {
  await page.route('**/api/credits**', route => {
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_key' }),
    });
  });
}

/**
 * Mock the /api/scan endpoint with a custom response.
 */
async function mockScanAPI(page, scanResponse) {
  await page.route('**/api/scan**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scanResponse),
    });
  });
}

/**
 * Mock the /api/scan endpoint to simulate a network failure.
 */
async function mockScanNetworkError(page) {
  await page.route('**/api/scan**', route => {
    route.abort('connectionrefused');
  });
}

/**
 * Mock all API endpoints to simulate network failure.
 */
async function mockNetworkFailure(page) {
  await page.route('**/api/**', route => {
    route.abort('connectionrefused');
  });
}

module.exports = {
  EXTENSION_PATH,
  launchExtension,
  openSidePanel,
  seedLicenseKey,
  clearLicenseKey,
  mockCreditsAPI,
  mockCreditsInvalidKey,
  mockScanAPI,
  mockScanNetworkError,
  mockNetworkFailure,
};
