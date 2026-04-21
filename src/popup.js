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
        // Strategy 1: Job detail panel selectors (LinkedIn changes these frequently)
        const linkedInSelectors = [
          '.jobs-description__content',
          '.jobs-box__html-content',
          '.jobs-description-content__text',
          '.jobs-unified-top-card__job-insight',
          '#job-details',
          '.job-view-layout',
          // The job description is usually inside a div with these attributes
          '[class*="jobs-description"]',
          '[class*="job-details"]',
        ];

        for (const selector of linkedInSelectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText.trim().length > 100) {
            return el.innerText.trim();
          }
        }

        // Strategy 2: Find the "About the job" section and grab everything after it
        const allText = document.body.innerText;
        const aboutIndex = allText.indexOf('About the job');
        if (aboutIndex !== -1) {
          // Grab text from "About the job" onwards, limited to ~10K chars
          const jobSection = allText.substring(aboutIndex, aboutIndex + 10000);
          if (jobSection.length > 100) {
            return jobSection;
          }
        }

        // Strategy 3: Look for the right-side detail panel
        const rightPanel = document.querySelector('.jobs-search__job-details, .job-view-layout .jobs-details');
        if (rightPanel && rightPanel.innerText.trim().length > 200) {
          return rightPanel.innerText.trim();
        }

        // Strategy 4: Get the main content area, filtering out the sidebar job list
        const mainContent = document.querySelector('main');
        if (mainContent) {
          // Try to exclude the left sidebar (job listings) and just get the detail view
          const detailSections = mainContent.querySelectorAll('section');
          for (const section of detailSections) {
            const text = section.innerText.trim();
            // Job descriptions are usually 500+ chars and contain keywords
            if (text.length > 500 && (text.includes('About the job') || text.includes('Qualifications') || text.includes('Requirements') || text.includes('Responsibilities') || text.includes('What you') || text.includes('Role'))) {
              return text;
            }
          }
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
