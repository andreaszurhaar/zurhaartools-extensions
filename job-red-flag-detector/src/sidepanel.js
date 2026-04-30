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
const licenseInput = document.getElementById('license-input');
const licenseError = document.getElementById('license-error');

let isScanning = false;

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
  console.log('[JRFD-sidepanel] extractJobText called, tab:', tab?.id, tab?.url);

  try {
    console.log('[JRFD-sidepanel] Trying content script messaging (chrome.tabs.sendMessage)...');
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractJobText' });
    console.log('[JRFD-sidepanel] Content script responded:', response ? 'yes' : 'no', '- text length:', response?.text?.length || 0);
    if (response && response.text && response.text.length > 100) {
      console.log('[JRFD-sidepanel] SUCCESS via content script, first 300 chars:', response.text.substring(0, 300));
      return response.text;
    }
    console.log('[JRFD-sidepanel] Content script response too short or empty, falling through to executeScript');
  } catch (e) {
    console.log('[JRFD-sidepanel] Content script not available:', e.message, '- using executeScript fallback');
  }

  try {
    console.log('[JRFD-sidepanel] Trying executeScript fallback...');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        console.log('[JRFD-executeScript] Running in page context, URL:', window.location.href);
        console.log('[JRFD-executeScript] document.body.innerText length:', document.body?.innerText?.length || 0);
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
        const noiseSelector = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]';

        function getCleanBodyText() {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll(noiseSelector).forEach(el => el.remove());
          return clone.innerText.trim();
        }

        function trimResult(text) {
          const cleaned = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
          return cleaned.length > 10000 ? cleaned.substring(0, 10000) : cleaned;
        }

        // Strategy 1: Quick-win selectors
        const selectors = [
          '#job-details', '#jobDescriptionText', '.jobDescriptionContent',
          '[class*="jobs-description"]', '[class*="job-description"]',
          '[class*="jobDescription"]', '[class*="JobDescription"]',
          '[id*="job-description"]', '[id*="jobDescription"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText.trim().length > 100) {
            return trimResult(el.innerText.trim());
          }
        }

        // Strategy 2: Marker-based — find heading text, walk up to container
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let textNode;
        while ((textNode = walker.nextNode())) {
          const trimmed = textNode.textContent.trim();
          if (trimmed.length < 5 || trimmed.length > 50) continue;
          const matched = markers.find(m => trimmed.toLowerCase() === m.toLowerCase());
          if (!matched) continue;

          let container = textNode.parentElement;
          for (let i = 0; i < 20; i++) {
            if (!container || container === document.body) break;
            if (container.matches && container.matches(noiseSelector)) {
              container = container.parentElement;
              continue;
            }
            const text = container.innerText.trim();
            if (text.length > 500 && text.length < 30000) {
              const lower = text.toLowerCase();
              const signals = jobKeywords.filter(kw => lower.includes(kw)).length;
              if (signals >= 2) return trimResult(text);
            }
            container = container.parentElement;
          }

          // Fallback: grab from body text at the marker
          const bodyText = getCleanBodyText();
          const idx = bodyText.indexOf(matched);
          if (idx !== -1) return trimResult(bodyText.substring(idx));
          const idxLower = bodyText.toLowerCase().indexOf(matched.toLowerCase());
          if (idxLower !== -1) return trimResult(bodyText.substring(idxLower));
        }

        // Marker plain-text fallback
        const bodyText = getCleanBodyText();
        for (const marker of markers) {
          const idx = bodyText.indexOf(marker);
          if (idx !== -1) return trimResult(bodyText.substring(idx));
        }

        // Strategy 3: Keyword density scoring
        const candidates = document.querySelectorAll('div, section, article, main, [role="main"]');
        let best = '';
        let bestScore = 0;
        candidates.forEach((el) => {
          if (el.closest(noiseSelector)) return;
          const text = el.innerText.trim();
          if (text.length < 300) return;
          const lower = text.toLowerCase();
          const score = jobKeywords.filter(kw => lower.includes(kw)).length * (text.length > 15000 ? 0.7 : 1);
          if (score > bestScore) { bestScore = score; best = text; }
        });
        if (bestScore >= 3 && best.length >= 300) {
          if (best.length > 10000) {
            for (const m of markers) { const i = best.indexOf(m); if (i !== -1) return trimResult(best.substring(i)); }
          }
          return trimResult(best);
        }

        // Strategy 4: Generous fallback
        const main = document.querySelector('main, [role="main"], article');
        if (main && main.innerText.trim().length > 300) return trimResult(main.innerText.trim());
        if (bodyText.length > 300) return trimResult(bodyText);

        return null;
      },
    });

    const extractedText = results[0]?.result || null;
    console.log('[JRFD-sidepanel] executeScript result:', extractedText ? 'got text, length: ' + extractedText.length : 'null');
    if (extractedText) {
      console.log('[JRFD-sidepanel] executeScript first 300 chars:', extractedText.substring(0, 300));
    }
    return extractedText;
  } catch (e) {
    console.error('[JRFD-sidepanel] executeScript FAILED:', e.message);
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

    if (response.status === 401) {
      const errData = await response.json();
      if (errData.error === 'license_required' || errData.error === 'invalid_key') {
        await clearLicenseKey();
        updateCreditsDisplay(null);
        showState(stateWelcome);
        return;
      }
    }

    if (response.status === 403) {
      const errData = await response.json();
      if (errData.error === 'no_credits') {
        updateCreditsDisplay(0);
        showState(stateNoCredits);
        return;
      }
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

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
    console.error('Scan error:', err);
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
