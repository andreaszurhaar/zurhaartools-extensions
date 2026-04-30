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
  console.log('[JRFD] Starting LinkedIn extraction...');

  // Strategy 1: Known LinkedIn selectors (updated for current DOM)
  const selectors = [
    '#job-details',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content__text',
    '.jobs-description',
    '[class*="jobs-description"]',
    '[class*="job-details-about-the-job"]',
    'article[class*="jobs"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length > 100) {
      console.log('[JRFD] Found via selector:', selector, '- length:', el.innerText.trim().length);
      return el.innerText.trim();
    }
  }

  // Strategy 2: Find any element containing "About the job" as visible text
  // Use TreeWalker to find the text node, then walk up to the job content container
  const headingTexts = ['about the job', 'over de functie'];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const trimmed = node.textContent.trim().toLowerCase();
    if (!headingTexts.some(h => trimmed === h)) continue;

    console.log('[JRFD] Found heading text node in:', node.parentElement?.tagName, node.parentElement?.className);

    // Walk up from the heading to find the job description container
    let container = node.parentElement;
    for (let i = 0; i < 15; i++) {
      if (!container || container === document.body) break;
      const text = container.innerText.trim();

      // We want a container that holds the job content but not the entire page
      // LinkedIn typically wraps the description in a section/div of 500-20000 chars
      if (text.length > 500 && text.length < 20000) {
        // Verify it has actual job content keywords, not just UI
        const lower = text.toLowerCase();
        const jobSignals = ['responsibilities', 'requirements', 'qualifications',
          'experience', 'skills', 'what you', 'key responsibilities',
          'verantwoordelijkheden', 'ervaring', 'functie-eisen'];
        const signalCount = jobSignals.filter(s => lower.includes(s)).length;
        if (signalCount >= 2) {
          console.log('[JRFD] Using container:', container.tagName, '- length:', text.length, '- signals:', signalCount);
          return text;
        }
      }
      container = container.parentElement;
    }

    // Fallback: grab text from the heading onward in body.innerText
    const pageText = document.body.innerText;
    const headingIdx = pageText.toLowerCase().indexOf(trimmed);
    if (headingIdx !== -1) {
      const extracted = pageText.substring(headingIdx, headingIdx + 8000);
      console.log('[JRFD] Using page text from heading - length:', extracted.length);
      return extracted;
    }
  }

  // Strategy 3: Full page text search for markers
  const bodyText = document.body.innerText;
  const markers = ['About the job', 'Over de functie', 'Job description',
    'Key Responsibilities', 'About this role', 'About the role'];
  for (const marker of markers) {
    const idx = bodyText.indexOf(marker);
    if (idx !== -1) {
      const extracted = bodyText.substring(idx, idx + 8000);
      console.log('[JRFD] Found marker in page text:', marker, '- length:', extracted.length);
      return extracted;
    }
  }

  console.log('[JRFD] All LinkedIn strategies failed, trying keyword scoring');
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
  const candidates = document.querySelectorAll('div, section, article, main');
  const jobKeywords = ['experience', 'requirements', 'qualifications', 'responsibilities', 'salary', 'benefits', 'skills', 'role', 'position', 'apply', 'ervaring', 'functie', 'verantwoordelijkheden', 'salaris', 'key responsibilities', 'what you'];
  let bestCandidate = '';
  let bestScore = 0;

  candidates.forEach((el) => {
    const text = el.innerText.trim();
    if (text.length > 300 && text.length < 20000) {
      const score = jobKeywords.filter(kw => text.toLowerCase().includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = text;
      }
    }
  });

  // If the best candidate is very long, try to trim from a known heading
  if (bestCandidate.length > 8000) {
    const markers = ['About the job', 'Job description', 'Key Responsibilities', 'About this role'];
    for (const marker of markers) {
      const idx = bestCandidate.indexOf(marker);
      if (idx !== -1) {
        return bestCandidate.substring(idx, idx + 8000);
      }
    }
    return bestCandidate.substring(0, 8000);
  }

  return bestCandidate.length > 200 ? bestCandidate : null;
}

console.log('[Job Red Flag Detector] Content script loaded on', window.location.hostname);
