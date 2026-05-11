const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchExtension, openSidePanel, seedLicenseKey, mockCreditsAPI } = require('./test-utils');

const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'scripts', 'test-fixtures');
const TEST_LICENSE_KEY = process.env.TEST_LICENSE_KEY_TOS;

// Skip all smoke tests if no license key is provided
test.skip(!TEST_LICENSE_KEY, 'TEST_LICENSE_KEY_TOS environment variable not set');

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
  // Open a fixture page with legal content
  const fixturePage = await context.newPage();
  await fixturePage.goto(`http://localhost:${fixturePort}/tos-page.html`);
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

  // Mock only the credits check, let /api/scan go to the real API
  await panel.route('**/api/credits**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ credits_remaining: 9999 }),
    });
  });

  await panel.reload();
  await panel.waitForLoadState('domcontentloaded');

  await expect(panel.locator('#state-initial')).toBeVisible({ timeout: 5000 });

  // Extract text from the fixture page
  const legalText = await fixturePage.evaluate(() => {
    return typeof extractLegalText === 'function' ? extractLegalText() : null;
  });

  expect(legalText).not.toBeNull();
  expect(legalText.length).toBeGreaterThan(100);

  // Perform a real API scan
  const scanResult = await panel.evaluate(async ({ text, licenseKey }) => {
    const response = await fetch(`${CONFIG.API_URL}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'tos-scan',
        text: text,
        license_key: licenseKey,
      }),
    });
    return response.json();
  }, { text: legalText, licenseKey: TEST_LICENSE_KEY });

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
}, 30000);
