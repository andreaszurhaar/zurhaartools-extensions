// Service worker: opens side panel on icon click.
// Content script injection is handled by:
// - manifest content_scripts matches (for listed sites)
// - "Scan This Page" button in side panel (for non-listed sites, via optional permissions)

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});
