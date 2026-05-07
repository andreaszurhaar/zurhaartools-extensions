// Shared license key helpers — used by all credit-based extensions
// Loaded via <script> tag before extension-specific code

function getLicenseKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['license_key'], result => {
      resolve(result.license_key || null);
    });
  });
}

function saveLicenseKey(key) {
  return new Promise(resolve => {
    chrome.storage.local.set({ license_key: key }, resolve);
  });
}

function clearLicenseKey() {
  return new Promise(resolve => {
    chrome.storage.local.remove(['license_key'], resolve);
  });
}
