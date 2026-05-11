const { test, expect } = require('@playwright/test');
const {
  launchExtension, openSidePanel, seedLicenseKey, clearLicenseKey,
  mockCreditsAPI, mockCreditsInvalidKey, mockNetworkFailure,
} = require('./test-utils');

let context;
let extensionId;

test.beforeAll(async () => {
  ({ context, extensionId } = await launchExtension());
});

test.afterAll(async () => {
  await context.close();
});

test.describe('Welcome state (no license key)', () => {
  test('shows welcome state when no license key is set', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearLicenseKey(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#state-welcome')).toBeVisible();
    await expect(page.locator('#state-initial')).toBeHidden();
    await expect(page.locator('h1')).toHaveText('ToS Scanner');
    await expect(page.locator('#license-input')).toBeVisible();
    await expect(page.locator('#activate-btn')).toBeVisible();

    await page.close();
  });

  test('privacy policy link exists and points to correct URL', async () => {
    const page = await openSidePanel(context, extensionId);

    const privacyLink = page.locator('.footer a[href="https://zurhaartools.com/privacy"]');
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveText('Privacy Policy');

    await page.close();
  });

  test('recover link exists and points to correct URL', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearLicenseKey(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const recoverLink = page.locator('a[href="https://zurhaartools.com/recover"]');
    await expect(recoverLink).toBeVisible();
    await expect(recoverLink).toHaveText('Lost your license key?');

    await page.close();
  });
});

test.describe('License activation', () => {
  test('activates license and shows credits', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearLicenseKey(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await mockCreditsAPI(page, 100);

    await page.locator('#license-input').fill('VALID-KEY-123');
    await page.locator('#activate-btn').click();

    await expect(page.locator('#state-initial')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#credits-display')).toHaveText('100 scans remaining');

    await page.close();
  });

  test('shows error for invalid license key', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearLicenseKey(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await mockCreditsInvalidKey(page);

    await page.locator('#license-input').fill('INVALID-KEY');
    await page.locator('#activate-btn').click();

    await expect(page.locator('#license-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#license-error')).toHaveText('Invalid license key. Please check and try again.');
    await expect(page.locator('#state-welcome')).toBeVisible();

    await page.close();
  });

  test('shows error for empty license key', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearLicenseKey(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.locator('#activate-btn').click();

    await expect(page.locator('#license-error')).toBeVisible();
    await expect(page.locator('#license-error')).toHaveText('Please enter a license key.');

    await page.close();
  });
});

test.describe('No-credits state', () => {
  test('shows no-credits state when credits are zero', async () => {
    const page = await openSidePanel(context, extensionId);

    await mockCreditsAPI(page, 0);
    await seedLicenseKey(page, 'zero-credits-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#state-no-credits')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#credits-display')).toHaveText('0 scans remaining');
    await expect(page.locator('#buy-more-btn')).toBeVisible();

    await page.close();
  });
});

test.describe('Change key flow', () => {
  test('returns to welcome state when changing key', async () => {
    const page = await openSidePanel(context, extensionId);

    await mockCreditsAPI(page, 0);
    await seedLicenseKey(page, 'some-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#state-no-credits')).toBeVisible({ timeout: 5000 });

    await page.locator('#change-key-btn').click();

    await expect(page.locator('#state-welcome')).toBeVisible();
    await expect(page.locator('#credits-display')).toBeHidden();

    await page.close();
  });
});

test.describe('Error handling', () => {
  test('shows initial state on network failure during init', async () => {
    const page = await openSidePanel(context, extensionId);

    await mockNetworkFailure(page);
    await seedLicenseKey(page, 'some-key');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#state-initial')).toBeVisible({ timeout: 5000 });

    await page.close();
  });
});
