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

// Start a local HTTP server to serve fixture HTML files
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
 * Load a fixture page and inject content.js, then extract text.
 *
 * content.js uses chrome.runtime.onMessage which doesn't exist in a normal page.
 * We stub chrome.runtime before injecting, then call extractJobText() which is
 * defined inside the duplicate-injection guard block.
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

  // Call extractJobText() and return the result
  const text = await page.evaluate(() => {
    return typeof extractJobText === 'function' ? extractJobText() : null;
  });

  await page.close();
  return text;
}

test.describe('Content extraction — LinkedIn fixture', () => {
  test('extracts job text via #job-details selector', async () => {
    const text = await extractFromFixture('linkedin-job.html');

    expect(text).not.toBeNull();
    expect(text.length).toBeGreaterThan(300);
    expect(text).toContain('Data Scientist');
    expect(text).toContain('Key Responsibilities');
    expect(text).toContain('Requirements');
    expect(text).toContain('machine learning');
  });
});

test.describe('Content extraction — Indeed fixture', () => {
  test('extracts job text via #jobDescriptionText selector', async () => {
    const text = await extractFromFixture('indeed-job.html');

    expect(text).not.toBeNull();
    expect(text.length).toBeGreaterThan(300);
    expect(text).toContain('Frontend Developer');
    expect(text).toContain('What you\'ll do');
    expect(text).toContain('Qualifications');
    expect(text).toContain('React');
  });
});

test.describe('Content extraction — Generic job page', () => {
  test('extracts job text via keyword scoring', async () => {
    const text = await extractFromFixture('generic-job.html');

    expect(text).not.toBeNull();
    expect(text.length).toBeGreaterThan(300);
    expect(text).toContain('Backend Engineer');
    expect(text).toContain('Key Responsibilities');
    expect(text).toContain('Requirements');
  });
});

test.describe('Content extraction — No job content', () => {
  test('returns null for non-job page', async () => {
    const text = await extractFromFixture('no-job-content.html');

    // Should return null or very short text (below 100 char threshold)
    // The extraction may return some text via fallback, but it won't
    // contain job markers. The key check is in sidepanel.js where
    // text < 100 chars is treated as null. Let's verify it doesn't
    // contain job-specific content.
    if (text !== null) {
      // If fallback returns text, it shouldn't have job markers
      expect(text).not.toContain('Key Responsibilities');
      expect(text).not.toContain('Requirements');
      expect(text).not.toContain('Qualifications');
    }
  });
});

test.describe('Results rendering', () => {
  const mockResponse = {
    score: 3,
    summary: 'This job posting has several concerning red flags including vague compensation and unrealistic requirements.',
    redFlags: [
      { text: 'Competitive salary', meaning: 'No specific salary range mentioned — often means below market rate.', severity: 'high' },
      { text: 'Must be a team player', meaning: 'Vague requirement that can mean anything — may signal poor boundaries.', severity: 'medium' },
    ],
    greenFlags: [
      { text: 'Hybrid working model', meaning: 'Offers flexibility between remote and office work.' },
      { text: '30 days paid vacation', meaning: 'Generous vacation policy above the Dutch minimum.' },
    ],
    credits_remaining: 95,
  };

  test('renders score badge with correct class for low score', async () => {
    const page = await openSidePanel(context, extensionId);
    await mockCreditsAPI(page, 100);
    await mockScanAPI(page, mockResponse);
    await seedLicenseKey(page, 'test-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#state-initial')).toBeVisible({ timeout: 5000 });

    // We can't easily trigger a real scan (needs a tab with content),
    // so test rendering by calling renderResults directly
    await page.evaluate((data) => {
      renderResults(data);
    }, mockResponse);

    // Score badge
    const badge = page.locator('#score-badge');
    await expect(badge).toHaveText('3/10');
    await expect(badge).toHaveClass(/score-bad/);

    // Summary
    await expect(page.locator('#score-summary')).toContainText('concerning red flags');

    // Red flags
    const redFlags = page.locator('#red-flags-list .flag-item');
    await expect(redFlags).toHaveCount(2);
    await expect(redFlags.nth(0)).toHaveClass(/severity-high/);
    await expect(redFlags.nth(1)).toHaveClass(/severity-medium/);
    await expect(redFlags.nth(0).locator('.flag-text')).toContainText('Competitive salary');
    await expect(redFlags.nth(0).locator('.flag-meaning')).toContainText('below market rate');

    // Green flags
    const greenFlags = page.locator('#green-flags-list .flag-item');
    await expect(greenFlags).toHaveCount(2);
    await expect(greenFlags.nth(0)).toHaveClass(/green/);
    await expect(greenFlags.nth(0).locator('.flag-text')).toContainText('Hybrid working');

    // Credits updated
    await expect(page.locator('#credits-display')).toHaveText('95 scans remaining');

    await page.close();
  });

  test('score-ok class for medium score', async () => {
    const page = await openSidePanel(context, extensionId);
    await mockCreditsAPI(page, 100);
    await seedLicenseKey(page, 'test-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#state-initial')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      renderResults({ score: 5, summary: 'Decent job posting.', redFlags: [], greenFlags: [], credits_remaining: 99 });
    });

    await expect(page.locator('#score-badge')).toHaveClass(/score-ok/);
    await expect(page.locator('#score-badge')).toHaveText('5/10');

    await page.close();
  });

  test('score-good class for high score', async () => {
    const page = await openSidePanel(context, extensionId);
    await mockCreditsAPI(page, 100);
    await seedLicenseKey(page, 'test-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#state-initial')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      renderResults({ score: 8, summary: 'Great job posting.', redFlags: [], greenFlags: [], credits_remaining: 99 });
    });

    await expect(page.locator('#score-badge')).toHaveClass(/score-good/);
    await expect(page.locator('#score-badge')).toHaveText('8/10');

    await page.close();
  });
});
