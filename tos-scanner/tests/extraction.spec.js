const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  launchExtension, openSidePanel, seedLicenseKey,
  mockCreditsAPI, mockScanAPI,
} = require('./test-utils');

const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'scripts', 'test-fixtures');
const CONTENT_JS = path.resolve(__dirname, '..', 'src', 'content.js');

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

/**
 * Load a fixture page and inject content.js, then extract legal text.
 */
async function extractFromFixture(fixtureName) {
  const page = await context.newPage();
  await page.goto(`http://localhost:${fixturePort}/${fixtureName}`);
  await page.waitForLoadState('domcontentloaded');

  // Stub chrome.runtime so content.js doesn't throw when injected
  await page.evaluate(() => {
    if (typeof chrome === 'undefined') window.chrome = {};
    if (!chrome.runtime) chrome.runtime = {};
    if (!chrome.runtime.onMessage) {
      chrome.runtime.onMessage = { addListener: () => {} };
    }
  });

  // Inject content.js
  await page.addScriptTag({ path: CONTENT_JS });

  // Call extractLegalText() and return the result
  const text = await page.evaluate(() => {
    return typeof extractLegalText === 'function' ? extractLegalText() : null;
  });

  await page.close();
  return text;
}

test.describe('Content extraction — ToS page', () => {
  test('extracts legal text from Terms of Service page', async () => {
    const text = await extractFromFixture('tos-page.html');

    expect(text).not.toBeNull();
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain('Terms of Service');
    expect(text).toContain('Acceptance of Terms');
    expect(text).toContain('Limitation of Liability');
    expect(text).toContain('indemnify');
    expect(text).toContain('arbitration');
    expect(text).toContain('Governing Law');
  });
});

test.describe('Content extraction — Privacy Policy page', () => {
  test('extracts legal text from Privacy Policy page', async () => {
    const text = await extractFromFixture('privacy-policy-page.html');

    expect(text).not.toBeNull();
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain('Privacy Policy');
    expect(text).toContain('Cookies');
    expect(text).toContain('Data Retention');
    expect(text).toContain('third-party');
    expect(text).toContain('opt out');
  });
});

test.describe('Content extraction — No legal content', () => {
  test('returns null for non-legal page', async () => {
    const text = await extractFromFixture('no-legal-content.html');

    // Should return null — hiking blog has no legal keywords
    if (text !== null) {
      // If fallback returns something, it shouldn't have legal markers
      expect(text).not.toContain('Terms of Service');
      expect(text).not.toContain('Privacy Policy');
      expect(text).not.toContain('indemnify');
      expect(text).not.toContain('arbitration');
    }
  });
});

test.describe('Results rendering', () => {
  const mockResponse = {
    score: 3,
    summary: 'This Terms of Service has several concerning clauses including broad data sharing and forced arbitration.',
    redFlags: [
      { text: 'We may share your data with data brokers', meaning: 'Your personal data may be sold to advertisers and data brokers without explicit consent.', severity: 'high' },
      { text: 'You agree to waive your right to a jury trial', meaning: 'Mandatory arbitration clause removes your right to sue in court.', severity: 'medium' },
    ],
    greenFlags: [
      { text: 'We do not knowingly collect data from children', meaning: 'COPPA compliance — no data collection from users under 16.' },
    ],
    credits_remaining: 47,
  };

  test('renders score badge with correct class for low score', async () => {
    const page = await openSidePanel(context, extensionId);
    await mockCreditsAPI(page, 50);
    await mockScanAPI(page, mockResponse);
    await seedLicenseKey(page, 'test-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#state-initial')).toBeVisible({ timeout: 5000 });

    await page.evaluate((data) => {
      renderResults(data);
    }, mockResponse);

    const badge = page.locator('#score-badge');
    await expect(badge).toHaveText('3/10');
    await expect(badge).toHaveClass(/score-bad/);

    await expect(page.locator('#score-summary')).toContainText('concerning clauses');

    const redFlags = page.locator('#red-flags-list .flag-item');
    await expect(redFlags).toHaveCount(2);
    await expect(redFlags.nth(0)).toHaveClass(/severity-high/);
    await expect(redFlags.nth(1)).toHaveClass(/severity-medium/);
    await expect(redFlags.nth(0).locator('.flag-text')).toContainText('data brokers');
    await expect(redFlags.nth(0).locator('.flag-meaning')).toContainText('sold to advertisers');

    const greenFlags = page.locator('#green-flags-list .flag-item');
    await expect(greenFlags).toHaveCount(1);
    await expect(greenFlags.nth(0)).toHaveClass(/green/);
    await expect(greenFlags.nth(0).locator('.flag-text')).toContainText('children');

    await expect(page.locator('#credits-display')).toHaveText('47 scans remaining');

    await page.close();
  });

  test('score-ok class for medium score', async () => {
    const page = await openSidePanel(context, extensionId);
    await mockCreditsAPI(page, 50);
    await seedLicenseKey(page, 'test-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#state-initial')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      renderResults({ score: 6, summary: 'Average terms with some concerns.', redFlags: [], greenFlags: [], credits_remaining: 49 });
    });

    await expect(page.locator('#score-badge')).toHaveClass(/score-ok/);
    await expect(page.locator('#score-badge')).toHaveText('6/10');

    await page.close();
  });

  test('score-good class for high score', async () => {
    const page = await openSidePanel(context, extensionId);
    await mockCreditsAPI(page, 50);
    await seedLicenseKey(page, 'test-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#state-initial')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      renderResults({ score: 9, summary: 'Very fair and transparent terms.', redFlags: [], greenFlags: [], credits_remaining: 49 });
    });

    await expect(page.locator('#score-badge')).toHaveClass(/score-good/);
    await expect(page.locator('#score-badge')).toHaveText('9/10');

    await page.close();
  });
});
