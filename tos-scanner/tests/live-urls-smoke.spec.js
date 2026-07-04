const { test, expect } = require('@playwright/test');
const path = require('path');
const { launchExtension, openSidePanel, seedLicenseKey } = require('./test-utils');

const TEST_LICENSE_KEY = process.env.TEST_LICENSE_KEY_TOS;

test.skip(!TEST_LICENSE_KEY, 'TEST_LICENSE_KEY_TOS environment variable not set');

const LEGAL_KEYWORDS = [
  'agreement', 'terms', 'conditions', 'privacy', 'data', 'personal information',
  'cookies', 'consent', 'liability', 'indemnify', 'warranty', 'disclaimer',
  'governing law', 'jurisdiction', 'arbitration', 'termination', 'intellectual property',
  'third party', 'third-party', 'sub-processor', 'data controller', 'data processor',
  'retention', 'deletion', 'opt-out', 'opt out', 'unsubscribe',
  'shall', 'hereby', 'herein', 'pursuant', 'notwithstanding', 'aforementioned',
  'we reserve the right', 'you agree', 'by using', 'by accessing',
];

// Varied 15-site representative spread for pre-submission smoke.
// Picks across categories + known-edge-case layouts (SPAs, static templates, weird URLs).
const LIVE_URLS = [
  // Big Tech / social SPAs
  { name: 'Google ToS', url: 'https://policies.google.com/terms' },
  { name: 'Meta ToS', url: 'https://www.facebook.com/terms.php' },
  { name: 'X/Twitter ToS', url: 'https://x.com/en/tos' },
  { name: 'TikTok ToS', url: 'https://www.tiktok.com/legal/terms-of-service' },
  // E-commerce
  { name: 'Amazon Conditions', url: 'https://www.amazon.com/gp/help/customer/display.html?nodeId=508088' },
  { name: 'Shopify ToS', url: 'https://www.shopify.com/legal/terms' },
  // Dev tools / SaaS
  { name: 'GitHub ToS', url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service' },
  { name: 'Stripe SSA', url: 'https://stripe.com/legal/ssa' },
  // AI services
  { name: 'OpenAI ToS', url: 'https://openai.com/policies/terms-of-use' },
  { name: 'Anthropic ToS', url: 'https://www.anthropic.com/legal/consumer-terms' },
  // News / media
  { name: 'NYT ToS', url: 'https://help.nytimes.com/hc/en-us/articles/115014893428-Terms-of-service' },
  // Streaming
  { name: 'Netflix ToS', url: 'https://help.netflix.com/legal/termsofuse' },
  // Edge: YouTube static template (?template=terms), AliExpress unusual CDN URL,
  // Telegram very-simple/short page (paragraph-only layout).
  { name: 'YouTube ToS', url: 'https://www.youtube.com/static?template=terms' },
  { name: 'AliExpress ToS', url: 'https://terms.alicdn.com/legal-agreement/terms/tc_platform_en/tc_platform_en202204182224_29498.html' },
  { name: 'Telegram ToS', url: 'https://telegram.org/tos' },
];

const VALID_SEVERITIES = new Set(['high', 'medium', 'low']);

test.describe('Pre-submission smoke: 15 varied live URLs', () => {
  let context;
  let extensionId;
  let panel;

  test.beforeAll(async () => {
    ({ context, extensionId } = await launchExtension());
    panel = await openSidePanel(context, extensionId);
    await seedLicenseKey(panel, TEST_LICENSE_KEY);

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
  });

  test.afterAll(async () => {
    await context?.close();
  });

  for (const { name, url } of LIVE_URLS) {
    test(`${name} — ${url}`, async () => {
      test.setTimeout(60_000);

      const page = await context.newPage();

      try {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        } catch (navErr) {
          if (navErr.message.includes('Timeout') || navErr.message.includes('ERR_')) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          } else {
            throw navErr;
          }
        }

        await page.evaluate(() => {
          if (typeof chrome === 'undefined') window.chrome = {};
          if (!chrome.runtime) chrome.runtime = {};
          if (!chrome.runtime.onMessage) {
            chrome.runtime.onMessage = { addListener: () => {} };
          }
        });

        await page.addScriptTag({
          path: path.resolve(__dirname, '..', 'src', 'content.js'),
        });

        const legalText = await page.evaluate(() => {
          return typeof extractLegalText === 'function' ? extractLegalText() : null;
        });

        expect(legalText, 'extractLegalText() returned null').not.toBeNull();
        expect(legalText.length, `Extracted text too short (${legalText.length} chars)`).toBeGreaterThan(300);

        const lowerText = legalText.toLowerCase();
        const matchedKeywords = LEGAL_KEYWORDS.filter(kw => lowerText.includes(kw));
        console.log(`  ${name}: ${legalText.length} chars, ${matchedKeywords.length} keywords`);

        const scanResult = await panel.evaluate(async ({ text, licenseKey }) => {
          const response = await fetch(`${CONFIG.API_URL}/api/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'tos-scan',
              text,
              license_key: licenseKey,
            }),
          });
          return response.json();
        }, { text: legalText, licenseKey: TEST_LICENSE_KEY });

        expect(scanResult).toHaveProperty('score');
        expect(typeof scanResult.score).toBe('number');
        expect(scanResult.score).toBeGreaterThanOrEqual(0);
        expect(scanResult.score).toBeLessThanOrEqual(10);

        expect(scanResult).toHaveProperty('summary');
        expect(typeof scanResult.summary).toBe('string');
        expect(scanResult.summary.length).toBeGreaterThan(0);

        expect(scanResult).toHaveProperty('redFlags');
        expect(Array.isArray(scanResult.redFlags)).toBe(true);

        expect(scanResult).toHaveProperty('greenFlags');
        expect(Array.isArray(scanResult.greenFlags)).toBe(true);

        for (const flag of scanResult.redFlags) {
          expect(flag).toHaveProperty('text');
          expect(typeof flag.text).toBe('string');
          expect(flag.text.length).toBeGreaterThan(0);

          expect(flag).toHaveProperty('meaning');
          expect(typeof flag.meaning).toBe('string');
          expect(flag.meaning.length).toBeGreaterThan(0);

          expect(flag).toHaveProperty('severity');
          expect(VALID_SEVERITIES.has(flag.severity), `Invalid severity: ${flag.severity}`).toBe(true);
        }

        for (const flag of scanResult.greenFlags) {
          expect(flag).toHaveProperty('text');
          expect(typeof flag.text).toBe('string');
          expect(flag.text.length).toBeGreaterThan(0);

          expect(flag).toHaveProperty('meaning');
          expect(typeof flag.meaning).toBe('string');
          expect(flag.meaning.length).toBeGreaterThan(0);
        }

        await panel.evaluate((data) => {
          renderResults(data);
        }, scanResult);

        await expect(panel.locator('#score-badge')).toBeVisible({ timeout: 3000 });

        const renderedFlagCount = await panel.locator('.flag-item').count();
        const expectedFlagCount = scanResult.redFlags.length + scanResult.greenFlags.length;
        expect(renderedFlagCount).toBe(expectedFlagCount);

        console.log(`  ${name}: ${legalText.length} chars extracted, score ${scanResult.score}/10, ${scanResult.redFlags.length} red + ${scanResult.greenFlags.length} green flags`);
      } finally {
        await page.close();
      }
    });
  }
});
