// Content script - extracts job posting text from any page
// Architecture: content-based extraction that works on ALL sites
// 1. Quick-win selectors (optimization, not required)
// 2. Marker-based: find job headings, walk up to container
// 3. Keyword density scoring: find best job-content block
// 4. Generous fallback: grab main content area

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractJobText') {
    const isMainFrame = window.self === window.top;
    console.log('[JRFD] >>> Message received | frame:', isMainFrame ? 'MAIN' : 'SUB', '| URL:', window.location.href);
    console.log('[JRFD] >>> document.body.innerText length:', document.body?.innerText?.length || 0);

    // Only extract from the main frame — sub-frames have no useful content
    // IMPORTANT: do NOT call sendResponse from sub-frames, otherwise Chrome
    // uses the first response and ignores the main frame's response
    if (!isMainFrame) {
      console.log('[JRFD] >>> Skipping sub-frame, NOT responding (letting main frame respond)');
      return;
    }

    console.log('[JRFD] >>> body first 300 chars:', document.body?.innerText?.substring(0, 300));

    // Check for shadow DOM elements
    const shadowHosts = document.querySelectorAll('*');
    let shadowCount = 0;
    shadowHosts.forEach(el => { if (el.shadowRoot) shadowCount++; });
    console.log('[JRFD] >>> Elements with shadowRoot:', shadowCount);

    const text = extractJobText();
    console.log('[JRFD] >>> Responding with text length:', text ? text.length : 'null');
    console.log('[JRFD] >>> Response first 300 chars:', text ? text.substring(0, 300) : 'null');
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
  console.log('[JRFD] ========== EXTRACTION START ==========');
  console.log('[JRFD] URL:', window.location.href);
  console.log('[JRFD] document.body exists:', !!document.body);
  console.log('[JRFD] document.body.innerText length:', document.body?.innerText?.length || 0);

  // Strategy 1: Quick-win selectors (site-specific optimization)
  console.log('[JRFD] --- Strategy 1: Quick-win selectors ---');
  const selectorResult = trySelectors();
  if (selectorResult) {
    console.log('[JRFD] SUCCESS via selector - length:', selectorResult.length);
    console.log('[JRFD] First 300 chars:', selectorResult.substring(0, 300));
    return cleanText(selectorResult);
  }
  console.log('[JRFD] Strategy 1 failed: no selectors matched');

  // Strategy 2: Marker-based extraction (find heading, walk up to container)
  console.log('[JRFD] --- Strategy 2: Marker-based extraction ---');
  const markerResult = tryMarkerExtraction();
  if (markerResult) {
    console.log('[JRFD] SUCCESS via marker - length:', markerResult.length);
    console.log('[JRFD] First 300 chars:', markerResult.substring(0, 300));
    return cleanText(markerResult);
  }
  console.log('[JRFD] Strategy 2 failed: no markers found');

  // Strategy 3: Keyword density scoring
  console.log('[JRFD] --- Strategy 3: Keyword density scoring ---');
  const scoredResult = tryKeywordScoring();
  if (scoredResult) {
    console.log('[JRFD] SUCCESS via keyword scoring - length:', scoredResult.length);
    console.log('[JRFD] First 300 chars:', scoredResult.substring(0, 300));
    return cleanText(scoredResult);
  }
  console.log('[JRFD] Strategy 3 failed');

  // Strategy 4: Generous fallback — grab main content or largest text block
  console.log('[JRFD] --- Strategy 4: Generous fallback ---');
  const fallbackResult = tryFallback();
  if (fallbackResult) {
    console.log('[JRFD] SUCCESS via fallback - length:', fallbackResult.length);
    console.log('[JRFD] First 300 chars:', fallbackResult.substring(0, 300));
    return cleanText(fallbackResult);
  }

  console.log('[JRFD] ALL STRATEGIES FAILED');
  console.log('[JRFD] ========== EXTRACTION END ==========');
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
    if (el) {
      const text = el.innerText.trim();
      console.log('[JRFD]   Selector', selector, '-> found, length:', text.length);
      if (text.length > 100) {
        return text;
      }
      console.log('[JRFD]   -> too short, skipping');
    } else {
      console.log('[JRFD]   Selector', selector, '-> not found');
    }
  }
  return null;
}

// ── Strategy 2: Marker-based extraction ──
function tryMarkerExtraction() {
  // Use TreeWalker to find text nodes that match job headings
  console.log('[JRFD]   Walking text nodes with TreeWalker...');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let textNode;
  let textNodeCount = 0;
  let markerHits = 0;

  while ((textNode = walker.nextNode())) {
    textNodeCount++;
    const trimmed = textNode.textContent.trim();
    if (trimmed.length < 5 || trimmed.length > 50) continue;

    const matchedMarker = JOB_MARKERS.find(m => trimmed.toLowerCase() === m.toLowerCase());
    if (!matchedMarker) continue;

    markerHits++;
    console.log('[JRFD]   MARKER HIT:', matchedMarker);
    console.log('[JRFD]     Parent element:', textNode.parentElement?.tagName, textNode.parentElement?.className?.substring(0, 80));
    console.log('[JRFD]     Parent outerHTML (first 200):', textNode.parentElement?.outerHTML?.substring(0, 200));

    // Walk up the DOM to find a container with substantial job content
    let container = textNode.parentElement;
    for (let i = 0; i < 20; i++) {
      if (!container || container === document.body) {
        console.log('[JRFD]     Walk step', i, ': reached body/null, stopping');
        break;
      }

      // Skip noise elements
      if (container.matches && container.matches(NOISE_SELECTORS)) {
        console.log('[JRFD]     Walk step', i, ': noise element, skipping -', container.tagName);
        container = container.parentElement;
        continue;
      }

      const text = container.innerText.trim();
      console.log('[JRFD]     Walk step', i, ':', container.tagName, '- class:', container.className?.substring(0, 60), '- length:', text.length);

      // Accept containers between 500 and 30000 chars that have job signals
      if (text.length > 500 && text.length < 30000) {
        const lower = text.toLowerCase();
        const signalCount = JOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
        console.log('[JRFD]     -> In range (500-30000), signals:', signalCount);
        if (signalCount >= 2) {
          console.log('[JRFD]     -> ACCEPTED! First 300 chars:', text.substring(0, 300));
          return text;
        }
        console.log('[JRFD]     -> Not enough signals (need >= 2)');
      } else if (text.length <= 500) {
        console.log('[JRFD]     -> Too short (< 500)');
      } else {
        console.log('[JRFD]     -> Too long (> 30000)');
      }
      container = container.parentElement;
    }

    // Container walk didn't find a good block — grab from body text starting at the marker
    console.log('[JRFD]   Container walk failed, trying body text fallback for marker:', matchedMarker);
    const bodyText = getCleanBodyText();
    console.log('[JRFD]   Clean body text length:', bodyText.length);
    const markerIdx = bodyText.indexOf(matchedMarker);
    if (markerIdx !== -1) {
      console.log('[JRFD]   Found marker at index:', markerIdx);
      const extracted = bodyText.substring(markerIdx, markerIdx + 10000);
      console.log('[JRFD]   Extracted first 300 chars:', extracted.substring(0, 300));
      return extracted;
    }
    // Try case-insensitive
    const lowerBody = bodyText.toLowerCase();
    const lowerMarker = matchedMarker.toLowerCase();
    const idx = lowerBody.indexOf(lowerMarker);
    if (idx !== -1) {
      console.log('[JRFD]   Found marker (case-insensitive) at index:', idx);
      return bodyText.substring(idx, idx + 10000);
    }
    console.log('[JRFD]   Marker not found in clean body text either');
  }

  console.log('[JRFD]   TreeWalker traversed', textNodeCount, 'text nodes,', markerHits, 'marker hits');

  // TreeWalker didn't find headings — try plain text search on body
  console.log('[JRFD]   Trying plain text search on body...');
  const bodyText = getCleanBodyText();
  console.log('[JRFD]   Clean body text length:', bodyText.length);
  for (const marker of JOB_MARKERS) {
    const idx = bodyText.indexOf(marker);
    if (idx !== -1) {
      console.log('[JRFD]   Found marker in body text:', marker, 'at index:', idx);
      const extracted = bodyText.substring(idx, idx + 10000);
      console.log('[JRFD]   First 300 chars:', extracted.substring(0, 300));
      return extracted;
    }
  }
  console.log('[JRFD]   No markers found in body text');

  return null;
}

// ── Strategy 3: Keyword density scoring ──
function tryKeywordScoring() {
  const candidates = document.querySelectorAll('div, section, article, main, [role="main"]');
  let bestText = '';
  let bestScore = 0;
  let bestEl = null;
  let candidateCount = 0;
  let scoredCount = 0;

  candidates.forEach((el) => {
    candidateCount++;
    // Skip noise containers
    if (el.closest(NOISE_SELECTORS)) return;

    const text = el.innerText.trim();
    if (text.length < 300) return;

    scoredCount++;
    const lower = text.toLowerCase();
    const matchCount = JOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
    const sizePenalty = text.length > 15000 ? 0.7 : 1;
    const score = matchCount * sizePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestText = text;
      bestEl = el;
    }
  });

  console.log('[JRFD]   Candidates:', candidateCount, '- Scored (>300 chars, non-noise):', scoredCount);
  console.log('[JRFD]   Best score:', bestScore, '- Best length:', bestText.length);
  if (bestEl) {
    console.log('[JRFD]   Best element:', bestEl.tagName, '- class:', bestEl.className?.substring(0, 80));
    console.log('[JRFD]   Best text first 300 chars:', bestText.substring(0, 300));
  }

  if (bestScore < 3 || bestText.length < 300) {
    console.log('[JRFD]   Rejected: score < 3 or length < 300');
    return null;
  }

  // If the best block is large, try to trim from a known marker
  if (bestText.length > 10000) {
    console.log('[JRFD]   Best block is large (' + bestText.length + '), trimming...');
    for (const marker of JOB_MARKERS) {
      const idx = bestText.indexOf(marker);
      if (idx !== -1) {
        console.log('[JRFD]   Trimming from marker:', marker, 'at index:', idx);
        return bestText.substring(idx, idx + 10000);
      }
    }
    console.log('[JRFD]   No marker found for trimming, using first 10000 chars');
    return bestText.substring(0, 10000);
  }

  return bestText;
}

// ── Strategy 4: Generous fallback ──
function tryFallback() {
  // Try main content area
  const main = document.querySelector('main, [role="main"], article');
  console.log('[JRFD]   main/article element:', main ? main.tagName + ' - length: ' + main.innerText.trim().length : 'not found');
  if (main && main.innerText.trim().length > 300) {
    const text = main.innerText.trim();
    console.log('[JRFD]   Using main/article, first 300 chars:', text.substring(0, 300));
    return text.length > 10000 ? text.substring(0, 10000) : text;
  }

  // Last resort: clean body text (minus nav/header/footer)
  const bodyText = getCleanBodyText();
  console.log('[JRFD]   Clean body text length:', bodyText.length);
  if (bodyText.length > 300) {
    console.log('[JRFD]   Using clean body text, first 300 chars:', bodyText.substring(0, 300));
    return bodyText.length > 10000 ? bodyText.substring(0, 10000) : bodyText;
  }

  return null;
}

// ── Helpers ──

// Get body text with noise elements removed
function getCleanBodyText() {
  const clone = document.body.cloneNode(true);
  const removed = clone.querySelectorAll(NOISE_SELECTORS);
  console.log('[JRFD]   getCleanBodyText: removing', removed.length, 'noise elements');
  removed.forEach(el => el.remove());
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
