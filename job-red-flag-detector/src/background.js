// Service worker: opens side panel + injects content script on icon click
// The icon click grants activeTab, so we inject content.js at this moment
// (not later when "Scan" is clicked, when activeTab may have expired).
// This ensures the content script is available on ANY site, not just those
// listed in manifest.json content_scripts matches.

// Handle injection requests from the side panel (after optional permission grant)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'injectContentScript' && msg.tabId) {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId, frameIds: [0] },
      files: ['src/content.js'],
    }).then(() => {
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false });
    });
    return true;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  // 1. Open the side panel
  await chrome.sidePanel.open({ tabId: tab.id });

  // 2. Inject content script while activeTab permission is still valid
  // This covers sites NOT in the manifest matches list.
  // Sites in the matches list already have the content script from auto-injection.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: ['src/content.js'],
    });
  } catch (e) {
    // May fail on chrome:// pages, extensions pages, etc. — that's fine
  }
});
