// Content script - injected directly into job posting pages
// Communicates with popup via chrome.runtime.onMessage

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractJobText') {
    const text = extractJobText();
    sendResponse({ text });
  }
  return true; // Keep message channel open for async response
});

function extractJobText() {
  const isLinkedIn = window.location.hostname.includes('linkedin.com');

  if (isLinkedIn) {
    return extractLinkedIn();
  }

  if (window.location.hostname.includes('glassdoor')) {
    return extractGlassdoor();
  }

  if (window.location.hostname.includes('indeed')) {
    return extractIndeed();
  }

  return extractGeneric();
}

function extractLinkedIn() {
  // Strategy 1: Find "About the job" heading element and grab content after it
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim().toLowerCase();
    if (text === 'about the job' || text === 'over de functie') {
      // Found the heading, now walk up and get the parent container's full text
      let container = node.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!container) break;
        const containerText = container.innerText.trim();
        // We want a container that has substantial content (the job description)
        // but isn't the entire page
        if (containerText.length > 500 && containerText.length < 15000) {
          return containerText;
        }
        container = container.parentElement;
      }
    }
  }

  // Strategy 2: Known LinkedIn selectors
  const selectors = [
    '#job-details',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content__text',
    '[class*="jobs-description"]',
    '[class*="job-details"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length > 100) {
      return el.innerText.trim();
    }
  }

  // Strategy 3: Full page text search for markers
  const bodyText = document.body.innerText;
  const markers = ['About the job', 'Over de functie', 'Job description'];
  for (const marker of markers) {
    const idx = bodyText.indexOf(marker);
    if (idx !== -1) {
      return bodyText.substring(idx, idx + 10000);
    }
  }

  // Strategy 4: Keyword-scored content blocks
  return extractByKeywordScore();
}

function extractGlassdoor() {
  const selectors = [
    '.jobDescriptionContent',
    '#JobDescriptionContainer',
    '[class*="jobDescription"]',
    '[class*="JobDescription"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length > 100) {
      return el.innerText.trim();
    }
  }

  return extractGeneric();
}

function extractIndeed() {
  const selectors = [
    '#jobDescriptionText',
    '.jobsearch-JobComponent-description',
    '[class*="jobDescription"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length > 100) {
      return el.innerText.trim();
    }
  }

  return extractGeneric();
}

function extractGeneric() {
  // Try generic job description selectors
  const selectors = [
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

  return extractByKeywordScore();
}

function extractByKeywordScore() {
  const candidates = document.querySelectorAll('div, section, article');
  const jobKeywords = ['experience', 'requirements', 'qualifications', 'responsibilities', 'salary', 'benefits', 'skills', 'role', 'position', 'apply', 'ervaring', 'functie', 'verantwoordelijkheden', 'salaris'];
  let bestCandidate = '';
  let bestScore = 0;

  candidates.forEach((el) => {
    const text = el.innerText.trim();
    if (text.length > 300 && text.length < 10000) {
      const score = jobKeywords.filter(kw => text.toLowerCase().includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = text;
      }
    }
  });

  return bestCandidate.length > 200 ? bestCandidate : null;
}

console.log('[Job Red Flag Detector] Content script loaded on', window.location.hostname);
