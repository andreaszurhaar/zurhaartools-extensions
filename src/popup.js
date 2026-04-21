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

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // LinkedIn-specific extraction (LinkedIn uses dynamic class names, so we need multiple strategies)
      const isLinkedIn = window.location.hostname.includes('linkedin.com');

      if (isLinkedIn) {
        // Strategy 1: Find "About the job" heading and grab its parent container
        const allHeaders = document.querySelectorAll('h2, h3, h4, span, div');
        for (const header of allHeaders) {
          const headerText = header.innerText.trim().toLowerCase();
          if (headerText === 'about the job' || headerText === 'over de functie') {
            // Walk up to find the container with the full description
            let container = header.parentElement;
            for (let i = 0; i < 5; i++) {
              if (container && container.innerText.trim().length > 300) {
                return container.innerText.trim();
              }
              container = container?.parentElement;
            }
          }
        }

        // Strategy 2: Known LinkedIn selectors (they change often)
        const linkedInSelectors = [
          '#job-details',
          '.jobs-description__content',
          '.jobs-box__html-content',
          '.jobs-description-content__text',
          '[class*="jobs-description"]',
          '[class*="job-details"]',
          '.job-view-layout',
        ];

        for (const selector of linkedInSelectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText.trim().length > 100) {
            return el.innerText.trim();
          }
        }

        // Strategy 3: Search the full page text for "About the job" marker
        const bodyText = document.body.innerText;
        const markers = ['About the job', 'Over de functie', 'Job description', 'Description'];
        for (const marker of markers) {
          const idx = bodyText.indexOf(marker);
          if (idx !== -1) {
            const jobSection = bodyText.substring(idx, idx + 10000);
            if (jobSection.length > 100) {
              return jobSection;
            }
          }
        }

        // Strategy 4: Find all divs/sections and pick the one that looks most like a job description
        const candidates = document.querySelectorAll('div, section, article');
        const jobKeywords = ['experience', 'requirements', 'qualifications', 'responsibilities', 'salary', 'benefits', 'apply', 'skills', 'role', 'position', 'ervaring', 'functie', 'verantwoordelijkheden'];
        let bestCandidate = '';
        let bestScore = 0;

        candidates.forEach((el) => {
          const text = el.innerText.trim();
          // Sweet spot: long enough to be a job desc, short enough to not be the whole page
          if (text.length > 300 && text.length < 8000) {
            const score = jobKeywords.filter(kw => text.toLowerCase().includes(kw)).length;
            if (score > bestScore) {
              bestScore = score;
              bestCandidate = text;
            }
          }
        });

        if (bestCandidate.length > 200) {
          return bestCandidate;
        }
      }

      // Non-LinkedIn: try common job posting selectors
      const selectors = [
        // Indeed
        '#jobDescriptionText',
        '.jobsearch-JobComponent-description',
        // Glassdoor
        '.jobDescriptionContent',
        '#JobDescriptionContainer',
        // Generic
        '[class*="job-description"]',
        '[class*="jobDescription"]',
        '[id*="job-description"]',
        '[id*="jobDescription"]',
        'article',
        '[role="main"]',
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText.trim().length > 100) {
          return el.innerText.trim();
        }
      }

      // Final fallback: find the largest text block that looks like a job posting
      const allElements = document.querySelectorAll('div, section, article, main');
      let bestMatch = '';
      const jobKeywords = ['experience', 'requirements', 'qualifications', 'responsibilities', 'salary', 'benefits', 'apply', 'role', 'position'];

      allElements.forEach((el) => {
        const text = el.innerText.trim();
        if (text.length > 300 && text.length < 15000) {
          const keywordCount = jobKeywords.filter(kw => text.toLowerCase().includes(kw)).length;
          const bestKeywordCount = jobKeywords.filter(kw => bestMatch.toLowerCase().includes(kw)).length;
          if (keywordCount > bestKeywordCount || (keywordCount === bestKeywordCount && text.length > bestMatch.length)) {
            bestMatch = text;
          }
        }
      });

      return bestMatch.length > 200 ? bestMatch : null;
    },
  });

  return results[0]?.result || null;
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
