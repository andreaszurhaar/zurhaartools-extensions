// ToS Scanner — extension-specific logic
// Shared code (license, UI, activation, API) is loaded via script tags before this file

const scanBtn = document.getElementById('scan-btn');
const rescanBtn = document.getElementById('rescan-btn');
const retryBtn = document.getElementById('retry-btn');
const retryScanBtn = document.getElementById('retry-scan-btn');
const retryPermissionBtn = document.getElementById('retry-permission-btn');
const stateNoLegal = document.getElementById('state-no-legal');
const stateStale = document.getElementById('state-stale');
const statePermissionNeeded = document.getElementById('state-permission-needed');

let isScanning = false;

// ── Results rendering ──

function getScoreClass(score) {
  if (score <= 4) return 'score-bad';
  if (score <= 6) return 'score-ok';
  return 'score-good';
}

function renderFlag(flag, type) {
  const div = document.createElement('div');
  const className = type === 'red' ? `severity-${flag.severity}` : 'green';
  div.className = `flag-item ${className}`;

  const textDiv = document.createElement('div');
  textDiv.className = 'flag-text';
  textDiv.textContent = '"' + flag.text + '"';

  const meaningDiv = document.createElement('div');
  meaningDiv.className = 'flag-meaning';
  meaningDiv.textContent = flag.meaning;

  div.appendChild(textDiv);
  div.appendChild(meaningDiv);
  return div;
}

function renderResults(data) {
  const scoreBadge = document.getElementById('score-badge');
  scoreBadge.textContent = data.score + '/10';
  scoreBadge.className = `score-badge ${getScoreClass(data.score)}`;

  document.getElementById('score-summary').textContent = data.summary;

  const redList = document.getElementById('red-flags-list');
  const redSection = document.getElementById('red-flags-section');
  redList.innerHTML = '';

  if (data.redFlags && data.redFlags.length > 0) {
    redSection.classList.remove('hidden');
    data.redFlags.forEach((flag) => redList.appendChild(renderFlag(flag, 'red')));
  } else {
    redSection.classList.add('hidden');
  }

  const greenList = document.getElementById('green-flags-list');
  const greenSection = document.getElementById('green-flags-section');
  greenList.innerHTML = '';

  if (data.greenFlags && data.greenFlags.length > 0) {
    greenSection.classList.remove('hidden');
    data.greenFlags.forEach((flag) => greenList.appendChild(renderFlag(flag, 'green')));
  } else {
    greenSection.classList.add('hidden');
  }

  if (data.credits_remaining !== undefined) {
    updateCreditsDisplay(data.credits_remaining);
  }

  showState(stateResults);
}

// ── Legal text extraction ──

async function extractLegalText(tabId) {
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { action: 'extractLegalText' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (response && response.text && response.text.length > 100) {
      return response.text;
    }
  } catch (e) {
    // Content script not available or timed out — caller will try executeScript
  }
  return null;
}

// Detect permission/access errors from chrome.scripting.executeScript
function isPermissionError(err) {
  const msg = (err && err.message) || '';
  return /Cannot access|Extension manifest must request permission|Missing host permission|cannot be scripted/i.test(msg);
}

// ── Core scan function ──

async function scanPage() {
  if (isScanning) return;

  const licenseKey = await getLicenseKey();
  if (!licenseKey) {
    showState(stateWelcome);
    return;
  }

  isScanning = true;
  showState(stateLoading);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showState(statePermissionNeeded);
      return;
    }

    // Inject content script into the active tab using activeTab grant.
    // If activeTab is stale (user switched tabs / navigated after panel opened),
    // executeScript throws a permission error.
    try {
      await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: ['src/content.js'],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('inject-timeout')), 3000)),
      ]);
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      if (isPermissionError(e)) {
        showState(statePermissionNeeded);
        return;
      }
      // Non-permission failure (e.g. timeout, already-injected, no-frame): continue and try to message
    }

    const legalText = await extractLegalText(tab.id);

    if (!legalText) {
      showState(stateNoLegal);
      return;
    }

    const result = await performScan('tos-scan', legalText, licenseKey);
    if (result.handled) return;

    const data = result.data;

    if (data.error && data.error === 'Could not parse structured response') {
      if (data.raw) {
        const jsonMatch = data.raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (data.credits_remaining !== undefined) {
              parsed.credits_remaining = data.credits_remaining;
            }
            renderResults(parsed);
            return;
          } catch (e) { /* fall through */ }
        }
      }
      throw new Error('Could not parse structured response');
    }

    if (data.error) {
      throw new Error(data.error);
    }

    renderResults(data);
  } catch (err) {
    showErrorState(err.message);
  } finally {
    isScanning = false;
  }
}

// ── Stale-state handling ──
//
// activeTab grant expires when the user switches tabs or navigates. The side panel
// stays open across those events, so we must detect them and show a state that
// instructs the user to re-click the toolbar icon (which re-grants activeTab).

function isReadyToScanState() {
  // States where activeTab freshness matters: initial (ready to scan) and results (scan again).
  return !stateInitial.classList.contains('hidden') || !stateResults.classList.contains('hidden');
}

function handleTabChanged() {
  if (isScanning) return;
  if (isReadyToScanState()) {
    showState(stateStale);
  }
}

chrome.tabs.onActivated.addListener(handleTabChanged);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') handleTabChanged();
});

// Re-arming: when the panel becomes visible again, the user has either re-clicked
// the toolbar icon (refreshing activeTab) or focused back to the panel. From a
// stale/permission-needed state, reset to the appropriate ready-to-scan state.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (isScanning) return;
  const inStale = !stateStale.classList.contains('hidden');
  const inPermissionNeeded = !statePermissionNeeded.classList.contains('hidden');
  if (inStale || inPermissionNeeded) {
    // initExtension() decides between welcome / initial / no-credits based on
    // license + credit state, so the user lands wherever they should be.
    initExtension();
  }
});

// Action-icon click broadcast: when the side panel is already open, re-clicking
// the toolbar icon is a no-op for chrome.sidePanel.open() and never fires
// visibilitychange. The background script broadcasts 'action-clicked' so we can
// re-initialize state (refreshing the activeTab grant view).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'action-clicked') {
    if (isScanning) return;
    initExtension();
  }
});

// ── Event listeners ──

scanBtn.addEventListener('click', scanPage);
rescanBtn.addEventListener('click', scanPage);
retryBtn.addEventListener('click', scanPage);
retryScanBtn.addEventListener('click', scanPage);
retryPermissionBtn.addEventListener('click', scanPage);

// ── Init ──
//
// Side panel script runs on every panel open (Chrome re-runs sidepanel.html when
// the user re-clicks the action icon while the panel is open). On load, activeTab
// is fresh, so initExtension() resets us to initial/welcome/no-credits as appropriate.

(async () => {
  await initExtension();
})();
