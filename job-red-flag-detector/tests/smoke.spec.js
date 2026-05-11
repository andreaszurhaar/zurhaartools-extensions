const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchExtension, openSidePanel, seedLicenseKey, mockCreditsAPI } = require('./test-utils');

const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'scripts', 'test-fixtures');
const TEST_LICENSE_KEY = process.env.TEST_LICENSE_KEY;

// Skip all smoke tests if no license key is provided
test.skip(!TEST_LICENSE_KEY, 'TEST_LICENSE_KEY environment variable not set');

let context;
let extensionId;
let fixtureServer;
let fixturePort;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtension());

  fixtureServer = http.createServer((req, res) => {
    const filePath = path.join(FIXTURES_DIR, req.url.replace(/^\//, ''));
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(filePath, 'utf8'));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise(resolve => {
    fixtureServer.listen(0, () => {
      fixturePort = fixtureServer.address().port;
      resolve();
    });
  });
});

test.afterAll(async () => {
  await context.close();
  if (fixtureServer) fixtureServer.close();
});

test('end-to-end scan with real API', async () => {
  // Open a fixture page in the first tab
  const fixturePage = await context.newPage();
  await fixturePage.goto(`http://localhost:${fixturePort}/generic-job.html`);
  await fixturePage.waitForLoadState('domcontentloaded');

  // Stub chrome.runtime so content.js doesn't throw on a regular page
  await fixturePage.evaluate(() => {
    if (typeof chrome === 'undefined') window.chrome = {};
    if (!chrome.runtime) chrome.runtime = {};
    if (!chrome.runtime.onMessage) {
      chrome.runtime.onMessage = { addListener: () => {} };
    }
  });

  // Inject content.js into the fixture page
  await fixturePage.addScriptTag({ path: path.resolve(__dirname, '..', 'src', 'content.js') });

  // Open the side panel
  const panel = await openSidePanel(context, extensionId);

  // Seed the test license key
  await seedLicenseKey(panel, TEST_LICENSE_KEY);

  // Mock only the credits check (so init shows the scan button), but let /api/scan go to the real API
  await panel.route('**/api/credits**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ credits_remaining: 9999 }),
    });
  });

  await panel.reload();
  await panel.waitForLoadState('domcontentloaded');

  // Should show initial state
  await expect(panel.locator('#state-initial')).toBeVisible({ timeout: 5000 });

  // The side panel's extractJobText() sends a message to the active tab.
  // Since our fixture tab is separate and doesn't have the content script
  // injected via the extension's message listener, we need to test the
  // full flow differently. Instead, we call scanJob() after directly
  // providing the text via the API mock.
  //
  // For a true E2E test, we'd need the fixture page to be the active tab
  // and have the content script injected via manifest matches or executeScript.
  // Since localhost isn't in the manifest matches, we test by calling the
  // scan with the text pre-extracted.

  // Extract text from the fixture page
  const jobText = await fixturePage.evaluate(() => {
    return typeof extractJobText === 'function' ? extractJobText() : null;
  });

  expect(jobText).not.toBeNull();
  expect(jobText.length).toBeGreaterThan(100);

  // Now perform a real API scan from the extension page
  const scanResult = await panel.evaluate(async ({ text, licenseKey }) => {
    const response = await fetch(`${CONFIG.API_URL}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'job-red-flags',
        text: text,
        license_key: licenseKey,
      }),
    });
    return response.json();
  }, { text: jobText, licenseKey: TEST_LICENSE_KEY });

  // Verify we got a valid scan result
  expect(scanResult).toHaveProperty('score');
  expect(scanResult.score).toBeGreaterThanOrEqual(0);
  expect(scanResult.score).toBeLessThanOrEqual(10);
  expect(scanResult).toHaveProperty('summary');
  expect(scanResult.summary.length).toBeGreaterThan(0);

  // Render the results in the side panel
  await panel.evaluate((data) => {
    renderResults(data);
  }, scanResult);

  // Verify results rendered
  await expect(panel.locator('#state-results')).toBeVisible();
  await expect(panel.locator('#score-badge')).toBeVisible();
  await expect(panel.locator('#score-summary')).not.toBeEmpty();

  // Should have at least one flag (red or green)
  const totalFlags = await panel.locator('.flag-item').count();
  expect(totalFlags).toBeGreaterThan(0);

  await fixturePage.close();
  await panel.close();
}, 30000); // Allow extra time for real API call
