const stateWelcome = document.getElementById('state-welcome');
const stateInitial = document.getElementById('state-initial');
const stateLoading = document.getElementById('state-loading');
const stateResults = document.getElementById('state-results');
const stateError = document.getElementById('state-error');
const stateNoJob = document.getElementById('state-no-job');
const stateNoCredits = document.getElementById('state-no-credits');

const scanBtn = document.getElementById('scan-btn');
const rescanBtn = document.getElementById('rescan-btn');
const retryBtn = document.getElementById('retry-btn');
const activateBtn = document.getElementById('activate-btn');
const getStartedBtn = document.getElementById('get-started-btn');
const buyMoreBtn = document.getElementById('buy-more-btn');
const changeKeyBtn = document.getElementById('change-key-btn');
const retryScanBtn = document.getElementById('retry-scan-btn');
const scanThisPageBtn = document.getElementById('scan-this-page-btn');
const licenseInput = document.getElementById('license-input');
const licenseError = document.getElementById('license-error');

let isScanning = false;
let currentTabId = null;
let currentTabUrl = null;

// Keep current tab info up-to-date for "Scan This Page" (needs sync access)
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

// ── License key helpers ──

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

// ── UI helpers ──

function showState(state) {
  [stateWelcome, stateInitial, stateLoading, stateResults, stateError, stateNoJob, stateNoCredits].forEach(
    (el) => el.classList.add('hidden')
  );
  state.classList.remove('hidden');
}

function updateCreditsDisplay(count) {
  const el = document.getElementById('credits-display');
  if (count !== null && count !== undefined && count >= 0) {
    el.textContent = `${count} scan${count !== 1 ? 's' : ''} remaining`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function showLicenseError(message) {
  licenseError.textContent = message;
  licenseError.classList.remove('hidden');
}

function hideLicenseError() {
  licenseError.classList.add('hidden');
}

function getScoreClass(score) {
  if (score <= 4) return 'score-bad';
  if (score <= 6) return 'score-ok';
  return 'score-good';
}

function renderFlag(flag, type) {
  const div = document.createElement('div');
  const className = type === 'red' ? `severity-${flag.severity}` : 'green';
  div.className = `flag-item ${className}`;
  div.innerHTML = `
    <div class="flag-text">"${flag.text}"</div>
    <div class="flag-meaning">${flag.meaning}</div>
  `;
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
    // Race sendMessage against a timeout — if the content script isn't available
    // (e.g. site access set to "On click"), sendMessage may hang indefinitely
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { action: 'extractJobText' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    if (response && response.text && response.text.length > 100) {
      return response.text;
    }
  } catch (e) {
    // Content script not available or timed out — use executeScript fallback
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: () => {
        const noiseSelector = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]';
        const markers = [
          'About the job', 'About the role', 'About this role', 'About this position',
          'Job description', 'Job Description', 'Job summary', 'Job Summary',
          'Role Description', 'Position Description',
          'Key Responsibilities', 'Responsibilities', 'What you\'ll do', 'What you will do',
          'The Role', 'The Opportunity', 'Your Role',
          'Over de functie', 'Functieomschrijving', 'Wat ga je doen', 'Jouw rol',
          'Über die Stelle', 'Stellenbeschreibung', 'Ihre Aufgaben', 'Deine Aufgaben',
        ];
        const jobKeywords = [
          'experience', 'requirements', 'qualifications', 'responsibilities',
          'salary', 'benefits', 'skills', 'apply', 'position', 'candidate',
          'team', 'company', 'opportunity', 'key responsibilities', 'what you',
          'ervaring', 'functie', 'verantwoordelijkheden', 'salaris',
          'erfahrung', 'anforderungen', 'qualifikationen', 'gehalt',
        ];

        // Tags whose text content is code/metadata, not visible text
        const invisibleTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME']);

        // Shadow DOM helpers
        function getDeepText(root) {
          let text = '';
          const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              const t = node.textContent.trim();
              if (t) text += t + '\n';
              return;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (invisibleTags.has(node.tagName)) return;
              if (node.matches && node.matches(noiseSelector)) return;
              if (node.shadowRoot) { walk(node.shadowRoot); return; }
            }
            const ch = node.childNodes;
            for (let i = 0; i < ch.length; i++) walk(ch[i]);
          };
          walk(root);
          return text;
        }

        function deepQuerySelectorAll(root, sel) {
          const results = [];
          const collect = (node) => {
            if (node.querySelectorAll) {
              const found = node.querySelectorAll(sel);
              for (let i = 0; i < found.length; i++) results.push(found[i]);
              const all = node.querySelectorAll('*');
              for (let i = 0; i < all.length; i++) {
                if (all[i].shadowRoot) collect(all[i].shadowRoot);
              }
            }
          };
          collect(root);
          return results;
        }

        function deepFindTextNodes(root) {
          const nodes = [];
          const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) { nodes.push(node); return; }
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (invisibleTags.has(node.tagName)) return;
              if (node.shadowRoot) { walk(node.shadowRoot); return; }
            }
            const ch = node.childNodes;
            for (let i = 0; i < ch.length; i++) walk(ch[i]);
          };
          walk(root);
          return nodes;
        }

        function getElementDeepText(el) {
          let hasShadow = !!el.shadowRoot;
          if (!hasShadow) {
            const all = el.querySelectorAll('*');
            for (let i = 0; i < all.length; i++) {
              if (all[i].shadowRoot) { hasShadow = true; break; }
            }
          }
          return hasShadow ? getDeepText(el) : (el.innerText?.trim() || '');
        }

        function trimResult(text) {
          const cleaned = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
          return cleaned.length > 10000 ? cleaned.substring(0, 10000) : cleaned;
        }

        const deepText = getDeepText(document.body);

        // Strategy 1: Selectors
        const selectors = [
          '#job-details', '#jobDescriptionText', '.jobDescriptionContent',
          '[class*="jobs-description"]', '[class*="job-description"]',
          '[class*="jobDescription"]', '[class*="JobDescription"]',
          '[id*="job-description"]', '[id*="jobDescription"]',
        ];
        for (const sel of selectors) {
          const els = deepQuerySelectorAll(document.body, sel);
          for (const el of els) {
            const text = getElementDeepText(el);
            if (text.length > 100) return trimResult(text);
          }
        }

        // Strategy 2: Markers via deep text nodes
        const textNodes = deepFindTextNodes(document.body);
        for (const tn of textNodes) {
          const trimmed = tn.textContent.trim();
          if (trimmed.length < 5 || trimmed.length > 50) continue;
          const matched = markers.find(m => trimmed.toLowerCase() === m.toLowerCase());
          if (!matched) continue;

          let container = tn.parentElement;
          for (let i = 0; i < 25; i++) {
            if (!container || container === document.body) break;
            if (container.nodeType === Node.DOCUMENT_FRAGMENT_NODE && container.host) {
              container = container.host; continue;
            }
            if (container.matches && container.matches(noiseSelector)) {
              container = container.parentNode; continue;
            }
            const text = getElementDeepText(container);
            if (text.length > 500 && text.length < 30000) {
              const lower = text.toLowerCase();
              const signals = jobKeywords.filter(kw => lower.includes(kw)).length;
              if (signals >= 2) return trimResult(text);
            }
            container = container.parentNode;
          }

          const idx = deepText.indexOf(matched);
          if (idx !== -1) return trimResult(deepText.substring(idx, idx + 10000));
          const idxL = deepText.toLowerCase().indexOf(matched.toLowerCase());
          if (idxL !== -1) return trimResult(deepText.substring(idxL, idxL + 10000));
        }

        // Deep text marker fallback
        for (const marker of markers) {
          const idx = deepText.indexOf(marker);
          if (idx !== -1) return trimResult(deepText.substring(idx, idx + 10000));
        }

        // Strategy 3: Keyword scoring
        const candidates = deepQuerySelectorAll(document.body, 'div, section, article, main, [role="main"]');
        let best = '', bestScore = 0;
        for (const el of candidates) {
          if (el.closest && el.closest(noiseSelector)) continue;
          const text = getElementDeepText(el);
          if (text.length < 300) continue;
          const lower = text.toLowerCase();
          const score = jobKeywords.filter(kw => lower.includes(kw)).length * (text.length > 15000 ? 0.7 : 1);
          if (score > bestScore) { bestScore = score; best = text; }
        }
        if (bestScore >= 3 && best.length >= 300) {
          if (best.length > 10000) {
            for (const m of markers) { const i = best.indexOf(m); if (i !== -1) return trimResult(best.substring(i, i + 10000)); }
          }
          return trimResult(best);
        }

        // Strategy 4: Fallback
        const mains = deepQuerySelectorAll(document.body, 'main, [role="main"], article');
        for (const m of mains) {
          const text = getElementDeepText(m);
          if (text.length > 300) return trimResult(text);
        }
        if (deepText.length > 300) return trimResult(deepText);

        return null;
      },
    });

    return results[0]?.result || null;
  } catch (e) {
    return null;
  }
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

    const response = await fetch(`${CONFIG.API_URL}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'job-red-flags',
        text: jobText,
        license_key: licenseKey,
      }),
    });

    const data = await response.json();
    if (response.status === 401 && (data.error === 'license_required' || data.error === 'invalid_key')) {
      await clearLicenseKey();
      updateCreditsDisplay(null);
      showState(stateWelcome);
      return;
    }

    if (response.status === 403 && data.error === 'no_credits') {
      updateCreditsDisplay(0);
      showState(stateNoCredits);
      return;
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

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
    document.getElementById('error-message').textContent =
      err.message || 'Something went wrong. Please try again.';
    showState(stateError);
  } finally {
    isScanning = false;
  }
}

// ── License activation ──

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

    // Valid key
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

// ── Initialization ──

async function init() {
  // Cache current tab info for "Scan This Page" button (needs sync access)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabId = tab.id;
      currentTabUrl = tab.url;
    }
  } catch (e) { /* ignore */ }

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

// ── Event listeners ──

scanBtn.addEventListener('click', scanJob);
rescanBtn.addEventListener('click', scanJob);
retryBtn.addEventListener('click', scanJob);
retryScanBtn.addEventListener('click', scanJob);
activateBtn.addEventListener('click', activateLicense);

scanThisPageBtn.addEventListener('click', async () => {
  try {
    // Request broad optional permission — must be the first async call to preserve
    // user gesture context. We can't request per-origin because tab.url is undefined
    // without the tabs permission.
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) return;

    // Now get the current tab (we can read tab.id without tabs permission)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: ['src/content.js'],
    });

    // Brief delay for content script to initialize, then scan
    await new Promise(r => setTimeout(r, 200));
    scanJob();
  } catch (e) {
    showState(stateNoJob);
  }
});

licenseInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') activateLicense();
});

changeKeyBtn.addEventListener('click', async () => {
  await clearLicenseKey();
  updateCreditsDisplay(null);
  showState(stateWelcome);
});

// Start
init();
