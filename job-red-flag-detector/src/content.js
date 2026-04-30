// Content script - extracts job posting text from any page
// Architecture: content-based extraction that works on ALL sites
// Supports shadow DOM (LinkedIn renders content inside shadow roots)
//
// May be injected twice: once via manifest matches, once via "Scan This Page"
// optional permissions flow. Guard against duplicate registration.

if (window.__jrfd_loaded) {
  // Already loaded — skip
}

if (!window.__jrfd_loaded) {
window.__jrfd_loaded = true;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'extractJobText') return false;

  // Sub-frames must not respond — return false so Chrome doesn't hold the channel open
  if (window.self !== window.top) return false;

  const text = extractJobText();
  sendResponse({ text });
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
  const deepText = getDeepText(document.body);

  // Strategy 1: Quick-win selectors (across shadow boundaries)
  const selectorResult = trySelectors();
  if (selectorResult) return cleanText(selectorResult);

  // Strategy 2: Marker-based extraction
  const markerResult = tryMarkerExtraction(deepText);
  if (markerResult) return cleanText(markerResult);

  // Strategy 3: Keyword density scoring
  const scoredResult = tryKeywordScoring();
  if (scoredResult) return cleanText(scoredResult);

  // Strategy 4: Generous fallback
  const fallbackResult = tryFallback(deepText);
  if (fallbackResult) return cleanText(fallbackResult);

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
      if (text.length > 100) return text;
    }
  }
  return null;
}

// ── Strategy 2: Marker-based (across shadow DOM) ──
function tryMarkerExtraction(deepText) {
  const textNodes = deepFindTextNodes(document.body);

  for (const textNode of textNodes) {
    const trimmed = textNode.textContent.trim();
    if (trimmed.length < 5 || trimmed.length > 50) continue;

    const matchedMarker = JOB_MARKERS.find(m => trimmed.toLowerCase() === m.toLowerCase());
    if (!matchedMarker) continue;

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
        if (signalCount >= 2) return text;
      }
      container = container.parentNode;
    }

    const idx = deepText.indexOf(matchedMarker);
    if (idx !== -1) return deepText.substring(idx, idx + 10000);
    const idxLower = deepText.toLowerCase().indexOf(matchedMarker.toLowerCase());
    if (idxLower !== -1) return deepText.substring(idxLower, idxLower + 10000);
  }

  for (const marker of JOB_MARKERS) {
    const idx = deepText.indexOf(marker);
    if (idx !== -1) return deepText.substring(idx, idx + 10000);
  }

  return null;
}

// ── Strategy 3: Keyword scoring (across shadow DOM) ──
function tryKeywordScoring() {
  const candidates = deepQuerySelectorAll(document.body, 'div, section, article, main, [role="main"]');
  let bestText = '';
  let bestScore = 0;

  for (const el of candidates) {
    if (el.closest && el.closest(NOISE_SELECTORS)) continue;
    const text = getElementDeepText(el);
    if (text.length < 300) continue;
    const lower = text.toLowerCase();
    const matchCount = JOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
    const sizePenalty = text.length > 15000 ? 0.7 : 1;
    const score = matchCount * sizePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestText = text;
    }
  }

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
    if (text.length > 300) {
      return text.length > 10000 ? text.substring(0, 10000) : text;
    }
  }

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

} // end duplicate-injection guard
