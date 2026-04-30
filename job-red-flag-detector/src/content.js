// Content script - extracts job posting text from any page
// Architecture: content-based extraction that works on ALL sites
// Supports shadow DOM (LinkedIn renders content inside shadow roots)
//
// May be injected twice: once via manifest matches, once via background.js
// executeScript. Guard against duplicate registration.

// Guard against duplicate injection (manifest matches + background.js executeScript)
if (window.__jrfd_loaded) {
  console.log('[JRFD] Content script already loaded, skipping');
  // Still need to end the script — throw is too harsh, so we use an IIFE wrapper below
}

if (!window.__jrfd_loaded) {
window.__jrfd_loaded = true;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractJobText') {
    const isMainFrame = window.self === window.top;
    console.log('[JRFD] >>> Message received | frame:', isMainFrame ? 'MAIN' : 'SUB', '| URL:', window.location.href);
    console.log('[JRFD] >>> body.innerText length:', document.body?.innerText?.length || 0);

    // Only extract from the main frame
    if (!isMainFrame) {
      console.log('[JRFD] >>> Skipping sub-frame, NOT responding');
      return;
    }

    const text = extractJobText();
    console.log('[JRFD] >>> Responding with text length:', text ? text.length : 'null');
    console.log('[JRFD] >>> Response first 300 chars:', text ? text.substring(0, 300) : 'null');
    sendResponse({ text });
  }
  return true;
});

// Job content headings
const JOB_MARKERS = [
  'About the job', 'About the role', 'About this role', 'About this position',
  'Job description', 'Job Description', 'Job summary', 'Job Summary',
  'Role Description', 'Role description', 'Position Description',
  'Key Responsibilities', 'Responsibilities', 'What you\'ll do', 'What you will do',
  'The Role', 'The Opportunity', 'Your Role',
  'Over de functie', 'Functieomschrijving', 'Functie-omschrijving',
  'Wat ga je doen', 'Jouw rol',
  'Über die Stelle', 'Stellenbeschreibung', 'Ihre Aufgaben', 'Deine Aufgaben',
];

// Keywords that signal job-posting content
const JOB_KEYWORDS = [
  'experience', 'requirements', 'qualifications', 'responsibilities',
  'salary', 'benefits', 'skills', 'apply', 'position', 'candidate',
  'team', 'company', 'opportunity', 'working', 'hybrid', 'remote',
  'key responsibilities', 'what you', 'nice to have', 'must have',
  'ervaring', 'functie', 'verantwoordelijkheden', 'salaris', 'vaardigheden',
  'erfahrung', 'anforderungen', 'qualifikationen', 'gehalt',
];

const NOISE_SELECTORS = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-label="navigation"]';

// Tags whose text content is code/metadata, not visible page text
const INVISIBLE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME']);

// ── Shadow DOM helpers ──

// Recursively extract all visible text, descending into shadow roots
function getDeepText(root) {
  let text = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim();
      if (t) text += t + '\n';
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      // Skip script, style, and other non-visible elements
      if (INVISIBLE_TAGS.has(node.tagName)) return;
      // Skip noise elements
      if (node.matches && node.matches(NOISE_SELECTORS)) return;
      // Descend into shadow root if present
      if (node.shadowRoot) {
        walk(node.shadowRoot);
        return;
      }
    }
    // Walk children (works for both Element and DocumentFragment/ShadowRoot)
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      walk(children[i]);
    }
  };
  walk(root);
  return text;
}

// querySelectorAll across shadow boundaries
function deepQuerySelectorAll(root, selector) {
  const results = [];
  const collect = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      if (node.querySelectorAll) {
        const found = node.querySelectorAll(selector);
        for (let i = 0; i < found.length; i++) results.push(found[i]);
      }
      // Descend into shadow roots
      const children = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (let i = 0; i < children.length; i++) {
        if (children[i].shadowRoot) {
          collect(children[i].shadowRoot);
        }
      }
    }
  };
  collect(root);
  return results;
}

// Find text nodes across shadow boundaries (skips script/style)
function deepFindTextNodes(root) {
  const nodes = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      nodes.push(node);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (INVISIBLE_TAGS.has(node.tagName)) return;
      if (node.shadowRoot) {
        walk(node.shadowRoot);
        return;
      }
    }
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      walk(children[i]);
    }
  };
  walk(root);
  return nodes;
}

// Get text from an element, descending into shadow roots within it
function getElementDeepText(el) {
  if (!el.shadowRoot && !el.querySelector('*')) {
    return el.innerText?.trim() || '';
  }
  // Check if any descendants have shadow roots
  let hasShadow = !!el.shadowRoot;
  if (!hasShadow) {
    const all = el.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) { hasShadow = true; break; }
    }
  }
  return hasShadow ? getDeepText(el) : (el.innerText?.trim() || '');
}

// ── Main extraction ──

function extractJobText() {
  console.log('[JRFD] ========== EXTRACTION START ==========');
  console.log('[JRFD] URL:', window.location.href);
  console.log('[JRFD] body.innerText length:', document.body?.innerText?.length || 0);

  // Detect shadow DOM
  let shadowCount = 0;
  document.querySelectorAll('*').forEach(el => { if (el.shadowRoot) shadowCount++; });
  console.log('[JRFD] Shadow DOM hosts:', shadowCount);

  const deepText = getDeepText(document.body);
  console.log('[JRFD] Deep text length (with shadow DOM):', deepText.length);
  console.log('[JRFD] Deep text first 300 chars:', deepText.substring(0, 300));

  // Strategy 1: Quick-win selectors (across shadow boundaries)
  console.log('[JRFD] --- Strategy 1: Selectors ---');
  const selectorResult = trySelectors();
  if (selectorResult) {
    console.log('[JRFD] SUCCESS via selector - length:', selectorResult.length);
    return cleanText(selectorResult);
  }

  // Strategy 2: Marker-based extraction
  console.log('[JRFD] --- Strategy 2: Markers ---');
  const markerResult = tryMarkerExtraction(deepText);
  if (markerResult) {
    console.log('[JRFD] SUCCESS via marker - length:', markerResult.length);
    return cleanText(markerResult);
  }

  // Strategy 3: Keyword density scoring
  console.log('[JRFD] --- Strategy 3: Keyword scoring ---');
  const scoredResult = tryKeywordScoring();
  if (scoredResult) {
    console.log('[JRFD] SUCCESS via keyword scoring - length:', scoredResult.length);
    return cleanText(scoredResult);
  }

  // Strategy 4: Generous fallback
  console.log('[JRFD] --- Strategy 4: Fallback ---');
  const fallbackResult = tryFallback(deepText);
  if (fallbackResult) {
    console.log('[JRFD] SUCCESS via fallback - length:', fallbackResult.length);
    return cleanText(fallbackResult);
  }

  console.log('[JRFD] ALL STRATEGIES FAILED');
  return null;
}

// ── Strategy 1: Selectors (across shadow DOM) ──
function trySelectors() {
  const selectors = [
    '#job-details', '#jobDescriptionText', '.jobDescriptionContent',
    '[class*="jobs-description"]', '[class*="job-description"]',
    '[class*="jobDescription"]', '[class*="JobDescription"]',
    '[id*="job-description"]', '[id*="jobDescription"]',
  ];

  for (const selector of selectors) {
    const els = deepQuerySelectorAll(document.body, selector);
    for (const el of els) {
      const text = getElementDeepText(el);
      console.log('[JRFD]   Selector', selector, '-> found, deep text length:', text.length);
      if (text.length > 100) return text;
    }
  }
  return null;
}

// ── Strategy 2: Marker-based (across shadow DOM) ──
function tryMarkerExtraction(deepText) {
  // Walk all text nodes including inside shadow roots
  const textNodes = deepFindTextNodes(document.body);
  console.log('[JRFD]   Deep text nodes found:', textNodes.length);

  for (const textNode of textNodes) {
    const trimmed = textNode.textContent.trim();
    if (trimmed.length < 5 || trimmed.length > 50) continue;

    const matchedMarker = JOB_MARKERS.find(m => trimmed.toLowerCase() === m.toLowerCase());
    if (!matchedMarker) continue;

    console.log('[JRFD]   MARKER HIT:', matchedMarker, 'in:', textNode.parentElement?.tagName);

    // Walk up from the heading to find a content container
    // Need to cross shadow root boundaries when walking up
    let container = textNode.parentElement;
    for (let i = 0; i < 25; i++) {
      if (!container || container === document.body) break;

      // Cross shadow root boundary: if parent is a ShadowRoot, jump to host
      if (container.nodeType === Node.DOCUMENT_FRAGMENT_NODE && container.host) {
        container = container.host;
        continue;
      }

      if (container.matches && container.matches(NOISE_SELECTORS)) {
        container = container.parentNode;
        continue;
      }

      const text = getElementDeepText(container);
      if (text.length > 500 && text.length < 30000) {
        const lower = text.toLowerCase();
        const signalCount = JOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
        console.log('[JRFD]     Step', i, ':', container.tagName || 'ShadowRoot', '- length:', text.length, '- signals:', signalCount);
        if (signalCount >= 2) {
          console.log('[JRFD]     ACCEPTED!');
          return text;
        }
      }
      container = container.parentNode;
    }

    // Fallback: find marker in deep text and grab from there
    console.log('[JRFD]   Container walk failed, using deep text fallback');
    const idx = deepText.indexOf(matchedMarker);
    if (idx !== -1) {
      console.log('[JRFD]   Found marker in deep text at index:', idx);
      return deepText.substring(idx, idx + 10000);
    }
    const idxLower = deepText.toLowerCase().indexOf(matchedMarker.toLowerCase());
    if (idxLower !== -1) {
      console.log('[JRFD]   Found marker (case-insensitive) in deep text at index:', idxLower);
      return deepText.substring(idxLower, idxLower + 10000);
    }
  }

  // No text node match — try plain text search on deep text
  console.log('[JRFD]   No text node markers, trying deep text search...');
  for (const marker of JOB_MARKERS) {
    const idx = deepText.indexOf(marker);
    if (idx !== -1) {
      console.log('[JRFD]   Found marker in deep text:', marker);
      return deepText.substring(idx, idx + 10000);
    }
  }

  return null;
}

// ── Strategy 3: Keyword scoring (across shadow DOM) ──
function tryKeywordScoring() {
  const candidates = deepQuerySelectorAll(document.body, 'div, section, article, main, [role="main"]');
  let bestText = '';
  let bestScore = 0;
  let scoredCount = 0;

  for (const el of candidates) {
    if (el.closest && el.closest(NOISE_SELECTORS)) continue;
    const text = getElementDeepText(el);
    if (text.length < 300) continue;

    scoredCount++;
    const lower = text.toLowerCase();
    const matchCount = JOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
    const sizePenalty = text.length > 15000 ? 0.7 : 1;
    const score = matchCount * sizePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestText = text;
    }
  }

  console.log('[JRFD]   Scored:', scoredCount, '- Best score:', bestScore, '- Best length:', bestText.length);

  if (bestScore < 3 || bestText.length < 300) return null;

  if (bestText.length > 10000) {
    for (const marker of JOB_MARKERS) {
      const idx = bestText.indexOf(marker);
      if (idx !== -1) return bestText.substring(idx, idx + 10000);
    }
    return bestText.substring(0, 10000);
  }

  return bestText;
}

// ── Strategy 4: Generous fallback ──
function tryFallback(deepText) {
  // Try main content area (across shadow DOM)
  const mains = deepQuerySelectorAll(document.body, 'main, [role="main"], article');
  for (const main of mains) {
    const text = getElementDeepText(main);
    console.log('[JRFD]   main/article deep text length:', text.length);
    if (text.length > 300) {
      return text.length > 10000 ? text.substring(0, 10000) : text;
    }
  }

  // Last resort: use deep text (already has noise removed)
  console.log('[JRFD]   Using full deep text, length:', deepText.length);
  if (deepText.length > 300) {
    return deepText.length > 10000 ? deepText.substring(0, 10000) : deepText;
  }

  return null;
}

// ── Helpers ──

function cleanText(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

console.log('[Job Red Flag Detector] Content script loaded on', window.location.hostname);

} // end duplicate-injection guard
