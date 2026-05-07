// Shared API communication helpers — used by all credit-based extensions
// Loaded via <script> tag after license.js, ui.js, and config.js
//
// Provides performScan() which handles the common credit/license error flow.
// Extensions call it with their scan type and extracted text.

async function performScan(scanType, text, licenseKey) {
  const response = await fetch(`${CONFIG.API_URL}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: scanType,
      text: text,
      license_key: licenseKey,
    }),
  });

  const data = await response.json();

  if (response.status === 401 && (data.error === 'license_required' || data.error === 'invalid_key')) {
    await clearLicenseKey();
    updateCreditsDisplay(null);
    showState(stateWelcome);
    return { handled: true };
  }

  if (response.status === 403 && data.error === 'no_credits') {
    updateCreditsDisplay(0);
    showState(stateNoCredits);
    return { handled: true };
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return { handled: false, data };
}
