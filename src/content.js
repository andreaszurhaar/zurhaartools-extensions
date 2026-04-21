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
  // Debug: log what we can find to help troubleshoot
  console.log('[JRFD] Starting LinkedIn extraction...');

  // Strategy 1: Known LinkedIn selectors (most reliable when they work)
  const selectors = [
    '#job-details',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content__text',
    '[class*="jobs-description"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length > 100) {
      console.log('[JRFD] Found via selector:', selector, '- length:', el.innerText.trim().length);
      return el.innerText.trim();
    }
  }

  // Strategy 2: Find "About the job" text node and collect all text that follows it
  // This works by finding the heading, then collecting text from ALL subsequent elements
  const headings = ['about the job', 'over de functie'];
  const allElements = document.querySelectorAll('*');

  for (const el of allElements) {
    // Check only direct text content (not children) to find the heading element precisely
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim().toLowerCase())
      .join('');

    if (headings.includes(directText)) {
      console.log('[JRFD] Found heading element:', el.tagName, el.className);

      // Collect text from this element and everything after it in the same scroll container
      let parent = el.parentElement;
      // Walk up to find a reasonable container (not the body)
      for (let i = 0; i < 10; i++) {
        if (!parent || parent === document.body) break;
        const text = parent.innerText.trim();
        console.log('[JRFD] Checking parent:', parent.tagName, parent.className?.substring(0, 50), '- length:', text.length);

        // Look for a container that has the job description but isn't the whole page
        if (text.length > 300 && text.length < 12000) {
          // Make sure it actually contains job-related content, not just UI
          const hasJobContent = text.includes('About the job') || text.includes('Over de functie');
          const hasDetails = text.length > 500;
          if (hasJobContent && hasDetails) {
            console.log('[JRFD] Using parent container - length:', text.length);
            return text;
          }
        }
        parent = parent.parentElement;
      }

      // If walking up didn't work, just grab everything from the heading onwards in the page text
      const pageText = document.body.innerText;
      const headingIdx = pageText.toLowerCase().indexOf(directText);
      if (headingIdx !== -1) {
        const extracted = pageText.substring(headingIdx, headingIdx + 8000);
        console.log('[JRFD] Using page text from heading - length:', extracted.length);
        return extracted;
      }
    }
  }

  // Strategy 3: Full page text search for markers (broadest approach)
  const bodyText = document.body.innerText;
  const markers = ['About the job', 'Over de functie'];
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
