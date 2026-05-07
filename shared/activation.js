// Shared license activation + init flow — used by all credit-based extensions
// Loaded via <script> tag after license.js, ui.js, and config.js
//
// Expects these elements: #activate-btn, #license-input, #get-started-btn,
//   #buy-more-btn, #change-key-btn
// Expects CONFIG.API_URL and CONFIG.PRICING_URL from config.js

const activateBtn = document.getElementById('activate-btn');
const licenseInput = document.getElementById('license-input');
const getStartedBtn = document.getElementById('get-started-btn');
const buyMoreBtn = document.getElementById('buy-more-btn');
const changeKeyBtn = document.getElementById('change-key-btn');

async function activateLicense() {
  const key = licenseInput.value.trim();
  if (!key) {
    showLicenseError('Please enter a license key.');
    return;
  }

  hideLicenseError();
  activateBtn.textContent = 'Checking...';
  activateBtn.disabled = true;

  try {
    const response = await fetch(`${CONFIG.API_URL}/api/credits?license_key=${encodeURIComponent(key)}`);
    const data = await response.json();

    if (response.status === 401 || data.error === 'invalid_key') {
      showLicenseError('Invalid license key. Please check and try again.');
      return;
    }

    await saveLicenseKey(key);

    if (data.credits_remaining <= 0) {
      updateCreditsDisplay(0);
      showState(stateNoCredits);
    } else {
      updateCreditsDisplay(data.credits_remaining);
      showState(stateInitial);
    }
  } catch (err) {
    showLicenseError('Could not verify key. Check your connection and try again.');
  } finally {
    activateBtn.textContent = 'Activate';
    activateBtn.disabled = false;
  }
}

async function initExtension() {
  // Set pricing URLs
  getStartedBtn.href = CONFIG.PRICING_URL;
  buyMoreBtn.href = CONFIG.PRICING_URL;

  const licenseKey = await getLicenseKey();

  if (!licenseKey) {
    showState(stateWelcome);
    return;
  }

  // Validate saved key
  try {
    const response = await fetch(`${CONFIG.API_URL}/api/credits?license_key=${encodeURIComponent(licenseKey)}`);
    const data = await response.json();

    if (response.status === 401 || data.error === 'invalid_key') {
      await clearLicenseKey();
      showState(stateWelcome);
      return;
    }

    if (data.credits_remaining <= 0) {
      updateCreditsDisplay(0);
      showState(stateNoCredits);
    } else {
      updateCreditsDisplay(data.credits_remaining);
      showState(stateInitial);
    }
  } catch (err) {
    // Network error — show scan UI anyway (will fail gracefully on scan attempt)
    showState(stateInitial);
  }
}

// Wire up shared event listeners
activateBtn.addEventListener('click', activateLicense);

licenseInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') activateLicense();
});

changeKeyBtn.addEventListener('click', async () => {
  await clearLicenseKey();
  updateCreditsDisplay(null);
  showState(stateWelcome);
});
