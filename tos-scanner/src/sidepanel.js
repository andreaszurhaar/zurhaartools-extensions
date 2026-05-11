// ToS Scanner — extension-specific logic
// Shared code (license, UI, activation, API) is loaded via script tags before this file

const scanBtn = document.getElementById('scan-btn');
const rescanBtn = document.getElementById('rescan-btn');
const retryBtn = document.getElementById('retry-btn');
const retryScanBtn = document.getElementById('retry-scan-btn');
const stateNoLegal = document.getElementById('state-no-legal');

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

async function extractLegalText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { action: 'extractLegalText' }),
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
      chrome.tabs.sendMessage(tab.id, { action: 'extractLegalText' }),
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
    // Request broad permission — ToS pages can be on any domain
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    } catch (e) {
      // Permission request failed (e.g. not in user gesture context on retry)
      // Proceed anyway — content script may already be injected
      granted = true;
    }

    if (!granted) {
      showState(stateNoLegal);
      return;
    }

    // Inject content script into the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
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
        // May already be injected
      }
    }

    const legalText = await extractLegalText();

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

// ── Event listeners ──

scanBtn.addEventListener('click', scanPage);
rescanBtn.addEventListener('click', scanPage);
retryBtn.addEventListener('click', scanPage);
retryScanBtn.addEventListener('click', scanPage);

// ── Init ──

(async () => {
  await initExtension();
})();
