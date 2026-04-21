const stateInitial = document.getElementById('state-initial');
const stateLoading = document.getElementById('state-loading');
const stateResults = document.getElementById('state-results');
const stateError = document.getElementById('state-error');
const stateNoJob = document.getElementById('state-no-job');

const scanBtn = document.getElementById('scan-btn');
const rescanBtn = document.getElementById('rescan-btn');
const retryBtn = document.getElementById('retry-btn');

function showState(state) {
  [stateInitial, stateLoading, stateResults, stateError, stateNoJob].forEach(
    (el) => el.classList.add('hidden')
  );
  state.classList.remove('hidden');
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
  // Score
  const scoreBadge = document.getElementById('score-badge');
  scoreBadge.textContent = data.score + '/10';
  scoreBadge.className = `score-badge ${getScoreClass(data.score)}`;

  document.getElementById('score-summary').textContent = data.summary;

  // Red flags
  const redList = document.getElementById('red-flags-list');
  const redSection = document.getElementById('red-flags-section');
  redList.innerHTML = '';

  if (data.redFlags && data.redFlags.length > 0) {
    redSection.classList.remove('hidden');
    data.redFlags.forEach((flag) => redList.appendChild(renderFlag(flag, 'red')));
  } else {
    redSection.classList.add('hidden');
  }

  // Green flags
  const greenList = document.getElementById('green-flags-list');
  const greenSection = document.getElementById('green-flags-section');
  greenList.innerHTML = '';

  if (data.greenFlags && data.greenFlags.length > 0) {
    greenSection.classList.remove('hidden');
    data.greenFlags.forEach((flag) => greenList.appendChild(renderFlag(flag, 'green')));
  } else {
    greenSection.classList.add('hidden');
  }

  showState(stateResults);
}

async function extractJobText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // First try: send message to content script (works on sites where content script is injected)
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractJobText' });
    if (response && response.text && response.text.length > 100) {
      return response.text;
    }
  } catch (e) {
    // Content script not injected on this page, fall through to executeScript
    console.log('Content script not available, using executeScript fallback');
  }

  // Fallback: inject and execute script directly (for sites not in content_scripts matches)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selectors = [
          '[class*="job-description"]',
          '[class*="jobDescription"]',
          '[id*="job-description"]',
          '[id*="jobDescription"]',
          '#jobDescriptionText',
          '.jobDescriptionContent',
          'article',
          '[role="main"]',
        ];

        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText.trim().length > 100) {
            return el.innerText.trim();
          }
        }

        // Keyword-scored fallback
        const candidates = document.querySelectorAll('div, section, article, main');
        const jobKeywords = ['experience', 'requirements', 'qualifications', 'responsibilities', 'salary', 'benefits', 'skills', 'apply'];
        let best = '';
        let bestScore = 0;

        candidates.forEach((el) => {
          const text = el.innerText.trim();
          if (text.length > 300 && text.length < 10000) {
            const score = jobKeywords.filter(kw => text.toLowerCase().includes(kw)).length;
            if (score > bestScore) {
              bestScore = score;
              best = text;
            }
          }
        });

        return best.length > 200 ? best : null;
      },
    });

    return results[0]?.result || null;
  } catch (e) {
    console.error('executeScript also failed:', e);
    return null;
  }
}

async function scanJob() {
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
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    renderResults(data);
  } catch (err) {
    console.error('Scan error:', err);
    document.getElementById('error-message').textContent =
      err.message || 'Something went wrong. Please try again.';
    showState(stateError);
  }
}

scanBtn.addEventListener('click', scanJob);
rescanBtn.addEventListener('click', scanJob);
retryBtn.addEventListener('click', scanJob);
