// Content script - extracts job posting text from any page
// Architecture: content-based extraction that works on ALL sites
// 1. Quick-win selectors (optimization, not required)
// 2. Marker-based: find job headings, walk up to container
// 3. Keyword density scoring: find best job-content block
// 4. Generous fallback: grab main content area

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractJobText') {
    const text = extractJobText();
    sendResponse({ text });
  }
  return true;
});

// Job content headings — used to find where the description starts
const JOB_MARKERS = [
  'About the job', 'About the role', 'About this role', 'About this position',
  'Job description', 'Job Description', 'Job summary', 'Job Summary',
  'Role Description', 'Role description', 'Position Description',
  'Key Responsibilities', 'Responsibilities', 'What you\'ll do', 'What you will do',
  'The Role', 'The Opportunity', 'Your Role',
  // Dutch
  'Over de functie', 'Functieomschrijving', 'Functie-omschrijving',
  'Wat ga je doen', 'Jouw rol',
  // German
  'Über die Stelle', 'Stellenbeschreibung', 'Ihre Aufgaben', 'Deine Aufgaben',
];

// Keywords that signal job-posting content
const JOB_KEYWORDS = [
  'experience', 'requirements', 'qualifications', 'responsibilities',
  'salary', 'benefits', 'skills', 'apply', 'position', 'candidate',
  'team', 'company', 'opportunity', 'working', 'hybrid', 'remote',
  'key responsibilities', 'what you', 'nice to have', 'must have',
  // Dutch
  'ervaring', 'functie', 'verantwoordelijkheden', 'salaris', 'vaardigheden',
  // German
  'erfahrung', 'anforderungen', 'qualifikationen', 'gehalt',
];

// Elements to exclude from extraction
const NOISE_SELECTORS = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-label="navigation"]';

function extractJobText() {
  console.log('[JRFD] Starting extraction on', window.location.hostname);

  // Strategy 1: Quick-win selectors (site-specific optimization)
  const selectorResult = trySelectors();
  if (selectorResult) {
    console.log('[JRFD] Found via selector - length:', selectorResult.length);
    return cleanText(selectorResult);
  }

  // Strategy 2: Marker-based extraction (find heading, walk up to container)
  const markerResult = tryMarkerExtraction();
  if (markerResult) {
    console.log('[JRFD] Found via marker - length:', markerResult.length);
    return cleanText(markerResult);
  }

  // Strategy 3: Keyword density scoring
  const scoredResult = tryKeywordScoring();
  if (scoredResult) {
    console.log('[JRFD] Found via keyword scoring - length:', scoredResult.length);
    return cleanText(scoredResult);
  }

  // Strategy 4: Generous fallback — grab main content or largest text block
  const fallbackResult = tryFallback();
  if (fallbackResult) {
    console.log('[JRFD] Found via fallback - length:', fallbackResult.length);
    return cleanText(fallbackResult);
  }

  console.log('[JRFD] All extraction strategies failed');
  return null;
}

// ── Strategy 1: Quick-win selectors ──
function trySelectors() {
  const selectors = [
    '#job-details',
    '#jobDescriptionText',
    '.jobDescriptionContent',
    '[class*="jobs-description"]',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="JobDescription"]',
    '[id*="job-description"]',
    '[id*="jobDescription"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText.trim().length > 100) {
      return el.innerText.trim();
    }
  }
  return null;
}

// ── Strategy 2: Marker-based extraction ──
function tryMarkerExtraction() {
  // Use TreeWalker to find text nodes that match job headings
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let textNode;

  while ((textNode = walker.nextNode())) {
    const trimmed = textNode.textContent.trim();
    if (trimmed.length < 5 || trimmed.length > 50) continue;

    const matchedMarker = JOB_MARKERS.find(m => trimmed.toLowerCase() === m.toLowerCase());
    if (!matchedMarker) continue;

    console.log('[JRFD] Found marker:', matchedMarker, 'in:', textNode.parentElement?.tagName);

    // Walk up the DOM to find a container with substantial job content
    let container = textNode.parentElement;
    for (let i = 0; i < 20; i++) {
      if (!container || container === document.body) break;

      // Skip noise elements
      if (container.matches && container.matches(NOISE_SELECTORS)) {
        container = container.parentElement;
        continue;
      }

      const text = container.innerText.trim();

      // Accept containers between 500 and 30000 chars that have job signals
      if (text.length > 500 && text.length < 30000) {
        const lower = text.toLowerCase();
        const signalCount = JOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
        if (signalCount >= 2) {
          console.log('[JRFD] Using container:', container.tagName, '- length:', text.length, '- signals:', signalCount);
          return text;
        }
      }
      container = container.parentElement;
    }

    // Container walk didn't find a good block — grab from body text starting at the marker
    const bodyText = getCleanBodyText();
    const markerIdx = bodyText.indexOf(matchedMarker);
    if (markerIdx === -1) {
      // Try case-insensitive
      const lowerBody = bodyText.toLowerCase();
      const lowerMarker = matchedMarker.toLowerCase();
      const idx = lowerBody.indexOf(lowerMarker);
      if (idx !== -1) {
        return bodyText.substring(idx, idx + 10000);
      }
    } else {
      return bodyText.substring(markerIdx, markerIdx + 10000);
    }
  }

  // TreeWalker didn't find headings — try plain text search on body
  const bodyText = getCleanBodyText();
  for (const marker of JOB_MARKERS) {
    const idx = bodyText.indexOf(marker);
    if (idx !== -1) {
      console.log('[JRFD] Found marker in body text:', marker);
      return bodyText.substring(idx, idx + 10000);
    }
  }

  return null;
}

// ── Strategy 3: Keyword density scoring ──
function tryKeywordScoring() {
  const candidates = document.querySelectorAll('div, section, article, main, [role="main"]');
  let bestText = '';
  let bestScore = 0;

  candidates.forEach((el) => {
    // Skip noise containers
    if (el.closest(NOISE_SELECTORS)) return;

    const text = el.innerText.trim();
    if (text.length < 300) return;

    const lower = text.toLowerCase();
    // Score: count unique keyword matches, weighted by density
    const matchCount = JOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
    // Prefer elements that aren't the entire page — penalize very large blocks slightly
    const sizePenalty = text.length > 15000 ? 0.7 : 1;
    const score = matchCount * sizePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestText = text;
    }
  });

  if (bestScore < 3 || bestText.length < 300) return null;

  // If the best block is large, try to trim from a known marker
  if (bestText.length > 10000) {
    for (const marker of JOB_MARKERS) {
      const idx = bestText.indexOf(marker);
      if (idx !== -1) {
        return bestText.substring(idx, idx + 10000);
      }
    }
    return bestText.substring(0, 10000);
  }

  return bestText;
}

// ── Strategy 4: Generous fallback ──
function tryFallback() {
  // Try main content area
  const main = document.querySelector('main, [role="main"], article');
  if (main && main.innerText.trim().length > 300) {
    const text = main.innerText.trim();
    return text.length > 10000 ? text.substring(0, 10000) : text;
  }

  // Last resort: clean body text (minus nav/header/footer)
  const bodyText = getCleanBodyText();
  if (bodyText.length > 300) {
    return bodyText.length > 10000 ? bodyText.substring(0, 10000) : bodyText;
  }

  return null;
}

// ── Helpers ──

// Get body text with noise elements removed
function getCleanBodyText() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll(NOISE_SELECTORS).forEach(el => el.remove());
  return clone.innerText.trim();
}

// Clean extracted text: remove excessive whitespace but keep structure
function cleanText(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')  // Collapse multiple blank lines
    .replace(/[ \t]+/g, ' ')      // Collapse horizontal whitespace
    .trim();
}

console.log('[Job Red Flag Detector] Content script loaded on', window.location.hostname);
