// Shared service worker — opens side panel on icon click.
// Content script injection is handled by:
// - manifest content_scripts matches (for listed sites)
// - "Scan This Page" button in side panel (for non-listed sites, via optional permissions)

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
  // Notify any open side panel that the action icon was clicked. If the panel
  // is already open, chrome.sidePanel.open() is a no-op and does not trigger
  // visibilitychange — the panel needs an explicit signal to refresh state.
  // The .catch() swallows "no receiver" errors when no panel is listening.
  chrome.runtime.sendMessage({ type: 'action-clicked', tabId: tab.id }).catch(() => {});
});
