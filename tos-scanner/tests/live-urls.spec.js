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

const LIVE_URLS = [
  // ── Big Tech ──
  { name: 'OpenAI ToS', url: 'https://openai.com/policies/terms-of-use' },
  { name: 'Apple Developer SLA', url: 'https://www.apple.com/legal/internet-services/itunes/dev/stdfla/' },
  { name: 'Discord ToS', url: 'https://discord.com/terms' },
  { name: 'Zoom ToS', url: 'https://zoom.us/en/trust/terms' },
  { name: 'Google ToS', url: 'https://policies.google.com/terms' },
  { name: 'Google Privacy', url: 'https://policies.google.com/privacy' },
  { name: 'Microsoft ToS', url: 'https://www.microsoft.com/en-us/servicesagreement' },
  { name: 'Microsoft Privacy', url: 'https://privacy.microsoft.com/en-us/privacystatement' },
  { name: 'Amazon Conditions', url: 'https://www.amazon.com/gp/help/customer/display.html?nodeId=508088' },
  { name: 'Meta ToS', url: 'https://www.facebook.com/terms.php' },
  { name: 'Meta Privacy', url: 'https://www.facebook.com/privacy/policy/' },
  { name: 'Apple Privacy', url: 'https://www.apple.com/legal/privacy/' },
  { name: 'Apple ToS', url: 'https://www.apple.com/legal/internet-services/terms/site.html' },

  // ── Social / Consumer ──
  { name: 'TikTok ToS', url: 'https://www.tiktok.com/legal/terms-of-service' },
  { name: 'Reddit User Agreement', url: 'https://www.reddit.com/policies/user-agreement' },
  { name: 'Twitch ToS', url: 'https://www.twitch.tv/p/en/legal/terms-of-service/' },
  { name: 'Snapchat ToS', url: 'https://www.snapchat.com/terms' },
  { name: 'X/Twitter ToS', url: 'https://x.com/en/tos' },
  { name: 'X/Twitter Privacy', url: 'https://x.com/en/privacy' },
  { name: 'LinkedIn User Agreement', url: 'https://www.linkedin.com/legal/user-agreement' },
  { name: 'LinkedIn Privacy', url: 'https://www.linkedin.com/legal/privacy-policy' },
  { name: 'Pinterest ToS', url: 'https://policy.pinterest.com/en/terms-of-service' },
  { name: 'Tumblr ToS', url: 'https://www.tumblr.com/policy/en/terms-of-service' },
  { name: 'WhatsApp ToS', url: 'https://www.whatsapp.com/legal/terms-of-service' },
  { name: 'WhatsApp Privacy', url: 'https://www.whatsapp.com/legal/privacy-policy' },
  { name: 'Telegram ToS', url: 'https://telegram.org/tos' },
  { name: 'Telegram Privacy', url: 'https://telegram.org/privacy' },
  { name: 'Signal ToS', url: 'https://signal.org/legal/' },
  { name: 'YouTube ToS', url: 'https://www.youtube.com/static?template=terms' },

  // ── SaaS / Productivity ──
  { name: 'Notion ToS', url: 'https://notion.so/terms' },
  { name: 'Slack ToS', url: 'https://slack.com/terms-of-service' },
  { name: 'Canva ToS', url: 'https://www.canva.com/policies/terms-of-use/' },
  { name: 'Linear ToS', url: 'https://linear.app/terms' },
  { name: 'Figma ToS', url: 'https://www.figma.com/tos/' },
  { name: 'Dropbox ToS', url: 'https://www.dropbox.com/terms' },
  { name: 'Zoom Privacy', url: 'https://zoom.us/en/trust/privacy' },
  { name: 'Atlassian Cloud ToS', url: 'https://www.atlassian.com/legal/cloud-terms-of-service' },
  { name: 'GitHub ToS', url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service' },
  { name: 'GitHub Privacy', url: 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement' },
  { name: 'GitLab ToS', url: 'https://handbook.gitlab.com/handbook/legal/subscription-agreement/' },
  { name: 'Salesforce ToS', url: 'https://www.salesforce.com/company/legal/agreements/' },
  { name: 'HubSpot ToS', url: 'https://legal.hubspot.com/terms-of-service' },
  { name: 'Vercel ToS', url: 'https://vercel.com/legal/terms' },
  { name: 'Cloudflare ToS', url: 'https://www.cloudflare.com/terms/' },

  // ── Finance / Fintech ──
  { name: 'Stripe SSA', url: 'https://stripe.com/legal/ssa' },
  { name: 'PayPal User Agreement', url: 'https://www.paypal.com/webapps/mpp/ua/useragreement-full' },
  { name: 'Wise ToS', url: 'https://wise.com/terms-of-use' },
  { name: 'Revolut ToS', url: 'https://www.revolut.com/legal/terms/' },
  { name: 'Coinbase User Agreement', url: 'https://www.coinbase.com/legal/user_agreement/united_states' },
  { name: 'Robinhood ToS', url: 'https://robinhood.com/us/en/about/legal/' },
  { name: 'Square ToS', url: 'https://squareup.com/us/en/legal/general/ua' },
  { name: 'Klarna ToS', url: 'https://www.klarna.com/us/legal/' },
  { name: 'Plaid ToS', url: 'https://plaid.com/legal/' },

  // ── E-commerce / Marketplace ──
  { name: 'Etsy ToS', url: 'https://www.etsy.com/legal/terms-of-use' },
  { name: 'Airbnb ToS', url: 'https://www.airbnb.com/terms' },
  { name: 'Uber ToS', url: 'https://www.uber.com/legal/en/document/-id=general-terms-of-use' },
  { name: 'eBay User Agreement', url: 'https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259' },
  { name: 'Shopify ToS', url: 'https://www.shopify.com/legal/terms' },
  { name: 'AliExpress ToS', url: 'https://terms.alicdn.com/legal-agreement/terms/tc_platform_en/tc_platform_en202204182224_29498.html' },
  { name: 'Booking.com ToS', url: 'https://www.booking.com/content/terms.html' },
  { name: 'DoorDash ToS', url: 'https://www.doordash.com/terms/' },
  { name: 'Instacart ToS', url: 'https://www.instacart.com/terms' },

  // ── Entertainment / Streaming ──
  { name: 'Spotify Privacy', url: 'https://www.spotify.com/legal/privacy-policy/' },
  { name: 'Spotify ToS', url: 'https://www.spotify.com/legal/end-user-agreement/' },
  { name: 'Netflix Privacy', url: 'https://www.netflix.com/privacy' },
  { name: 'Netflix ToS', url: 'https://help.netflix.com/legal/termsofuse' },
  { name: 'Disney+ ToS', url: 'https://www.disneyplus.com/legal/subscriber-agreement' },
  { name: 'Hulu ToS', url: 'https://www.hulu.com/terms' },
  { name: 'Twitch Privacy', url: 'https://www.twitch.tv/p/en/legal/privacy-notice/' },
  { name: 'Steam Subscriber Agreement', url: 'https://store.steampowered.com/subscriber_agreement/' },
  { name: 'Epic Games ToS', url: 'https://www.epicgames.com/site/en-US/tos' },
  { name: 'EA ToS', url: 'https://www.ea.com/legal/user-agreement' },

  // ── Travel / Transport ──
  { name: 'Lyft ToS', url: 'https://www.lyft.com/terms' },
  { name: 'Expedia ToS', url: 'https://www.expedia.com/lp/lg-terms' },
  { name: 'Tripadvisor ToS', url: 'https://www.tripadvisor.com/pages/terms.html' },

  // ── Health / Fitness ──
  { name: 'Peloton ToS', url: 'https://www.onepeloton.com/terms-of-service' },
  { name: 'MyFitnessPal ToS', url: 'https://www.myfitnesspal.com/terms-of-service' },
  { name: 'Headspace ToS', url: 'https://www.headspace.com/terms-and-conditions' },

  // ── Education ──
  { name: 'Coursera ToS', url: 'https://www.coursera.org/about/terms' },
  { name: 'Duolingo ToS', url: 'https://www.duolingo.com/terms' },
  { name: 'Khan Academy ToS', url: 'https://www.khanacademy.org/about/tos' },

  // ── News / Media ──
  { name: 'NYT ToS', url: 'https://help.nytimes.com/hc/en-us/articles/115014893428-Terms-of-service' },
  { name: 'BBC ToS', url: 'https://www.bbc.co.uk/usingthebbc/terms-of-use/' },
  { name: 'CNN ToS', url: 'https://edition.cnn.com/terms' },
  { name: 'Medium ToS', url: 'https://policy.medium.com/medium-terms-of-service-9db0094a1e0f' },
  { name: 'Substack ToS', url: 'https://substack.com/tos' },
  { name: 'WordPress ToS', url: 'https://wordpress.com/tos/' },
  { name: 'Wikipedia ToS', url: 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use' },

  // ── Cloud / Developer ──
  { name: 'AWS Customer Agreement', url: 'https://aws.amazon.com/agreement/' },
  { name: 'DigitalOcean ToS', url: 'https://www.digitalocean.com/legal/terms-of-service-agreement' },
  { name: 'Netlify ToS', url: 'https://www.netlify.com/legal/terms-of-use/' },
  { name: 'Heroku ToS', url: 'https://www.heroku.com/policy/tos' },
  { name: 'MongoDB ToS', url: 'https://www.mongodb.com/legal/terms-of-use' },
  { name: 'Twilio ToS', url: 'https://www.twilio.com/en-us/legal/tos' },
  { name: 'Anthropic ToS', url: 'https://www.anthropic.com/legal/consumer-terms' },
  { name: 'OpenAI Privacy', url: 'https://openai.com/policies/privacy-policy' },

  // ── Other major sites ──
  { name: 'Grammarly ToS', url: 'https://www.grammarly.com/terms' },
  { name: 'Canva Privacy', url: 'https://www.canva.com/policies/privacy-policy/' },
  { name: 'Adobe ToS', url: 'https://www.adobe.com/legal/terms.html' },
  { name: 'Zoom Marketplace ToS', url: 'https://explore.zoom.us/en/marketplace-terms-of-use/' },
];

const VALID_SEVERITIES = new Set(['high', 'medium', 'low']);

test.describe('Live URL ToS extraction and scanning', () => {
  let context;
  let extensionId;
  let panel;

  test.beforeAll(async () => {
    ({ context, extensionId } = await launchExtension());
    panel = await openSidePanel(context, extensionId);
    await seedLicenseKey(panel, TEST_LICENSE_KEY);

    // Mock credits so we don't burn real credits checking balance
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
        // Navigate to the live URL (retry once on timeout)
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        } catch (navErr) {
          if (navErr.message.includes('Timeout') || navErr.message.includes('ERR_')) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          } else {
            throw navErr;
          }
        }

        // Stub chrome.runtime so content.js can be injected on a regular page
        await page.evaluate(() => {
          if (typeof chrome === 'undefined') window.chrome = {};
          if (!chrome.runtime) chrome.runtime = {};
          if (!chrome.runtime.onMessage) {
            chrome.runtime.onMessage = { addListener: () => {} };
          }
        });

        // Inject content.js
        await page.addScriptTag({
          path: path.resolve(__dirname, '..', 'src', 'content.js'),
        });

        // 1. Extraction — must return non-null text > 300 chars
        const legalText = await page.evaluate(() => {
          return typeof extractLegalText === 'function' ? extractLegalText() : null;
        });

        expect(legalText, 'extractLegalText() returned null').not.toBeNull();
        expect(legalText.length, `Extracted text too short (${legalText.length} chars)`).toBeGreaterThan(300);

        // 2. Log keyword matches (informational, no longer a gate)
        const lowerText = legalText.toLowerCase();
        const matchedKeywords = LEGAL_KEYWORDS.filter(kw => lowerText.includes(kw));
        console.log(`  ${name}: ${legalText.length} chars, ${matchedKeywords.length} keywords`);

        // 3. API scan — call real API
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

        // API response structure
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

        // 4. Flag structure validation
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

        // 5. Results rendering
        await panel.evaluate((data) => {
          renderResults(data);
        }, scanResult);

        await expect(panel.locator('#score-badge')).toBeVisible({ timeout: 3000 });

        const renderedFlagCount = await panel.locator('.flag-item').count();
        const expectedFlagCount = scanResult.redFlags.length + scanResult.greenFlags.length;
        expect(renderedFlagCount).toBe(expectedFlagCount);

        // Log results for visibility
        console.log(`  ${name}: ${legalText.length} chars extracted, score ${scanResult.score}/10, ${scanResult.redFlags.length} red + ${scanResult.greenFlags.length} green flags`);
      } finally {
        await page.close();
      }
    });
  }
});
