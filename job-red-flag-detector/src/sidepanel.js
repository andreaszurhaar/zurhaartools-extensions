// Job Red Flag Detector — extension-specific logic
// Shared code (license, UI, activation, API) is loaded via script tags before this file

const scanBtn = document.getElementById('scan-btn');
const rescanBtn = document.getElementById('rescan-btn');
const retryBtn = document.getElementById('retry-btn');
const retryScanBtn = document.getElementById('retry-scan-btn');
const scanThisPageBtn = document.getElementById('scan-this-page-btn');
const stateNoJob = document.getElementById('state-no-job');

let isScanning = false;
let currentTabId = null;
let currentTabUrl = null;

// Keep current tab info up-to-date for "Scan This Page"
chrome.tabs.onActivated.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      currentTabUrl = tab.url;
    }
  } catch (e) { /* ignore */ }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === currentTabId && changeInfo.url) {
    currentTabUrl = changeInfo.url;
  }
});

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

// ── Job text extraction ──

async function extractJobText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { action: 'extractJobText' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (response && response.text && response.text.length > 100) {
      return response.text;
    }
  } catch (e) {
    // Content script not available or timed out — inject and retry
  }

  try {
    await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: ['src/content.js'],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('inject-timeout')), 3000)),
    ]);
    await new Promise(r => setTimeout(r, 200));

    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { action: 'extractJobText' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (response && response.text && response.text.length > 100) {
      return response.text;
    }
  } catch (e) {
    // Injection failed, timed out, or content script still not responding
  }

  return null;
}

// ── Core scan function ──

async function scanJob() {
  if (isScanning) return;

  const licenseKey = await getLicenseKey();
  if (!licenseKey) {
    showState(stateWelcome);
    return;
  }

  isScanning = true;
  showState(stateLoading);

  try {
    const jobText = await extractJobText();

    if (!jobText) {
      showState(stateNoJob);
      return;
    }

    const result = await performScan('job-red-flags', jobText, licenseKey);
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

// ── Event listeners ──

scanBtn.addEventListener('click', scanJob);
rescanBtn.addEventListener('click', scanJob);
retryBtn.addEventListener('click', scanJob);
retryScanBtn.addEventListener('click', scanJob);

scanThisPageBtn.addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: ['src/content.js'],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('inject-timeout')), 3000)),
    ]);

    await new Promise(r => setTimeout(r, 200));
    scanJob();
  } catch (e) {
    showState(stateNoJob);
  }
});

// ── Init ──

(async () => {
  // Cache current tab info
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      currentTabUrl = tab.url;
    }
  } catch (e) { /* ignore */ }

  await initExtension();
})();
