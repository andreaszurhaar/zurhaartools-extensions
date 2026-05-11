// Content script — extracts Terms of Service / Privacy Policy text from any page
//
// May be injected twice: once via "Scan This Page" optional permissions flow,
// once via executeScript fallback. Guard against duplicate registration.

if (window.__tos_scanner_loaded) {
  // Already loaded — skip
}

if (!window.__tos_scanner_loaded) {
window.__tos_scanner_loaded = true;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'extractLegalText') return false;

  // Sub-frames must not respond
  if (window.self !== window.top) return false;

  const text = extractLegalText();
  sendResponse({ text });
  return true;
});

// Headings that signal legal / ToS / privacy content
const LEGAL_MARKERS = [
  'Terms of Service', 'Terms and Conditions', 'Terms of Use', 'Terms & Conditions',
  'User Agreement', 'License Agreement', 'End User License Agreement', 'EULA',
  'Privacy Policy', 'Privacy Notice', 'Privacy Statement',
  'Cookie Policy', 'Cookie Notice',
  'Acceptable Use Policy', 'Data Processing Agreement',
  'Algemene Voorwaarden', 'Privacybeleid', 'Privacyverklaring',
  'Nutzungsbedingungen', 'Datenschutzerklärung', 'Datenschutzhinweise',
];

// Keywords that signal legal content
const LEGAL_KEYWORDS = [
  'agreement', 'terms', 'conditions', 'privacy', 'data', 'personal information',
  'cookies', 'consent', 'liability', 'indemnify', 'warranty', 'disclaimer',
  'governing law', 'jurisdiction', 'arbitration', 'termination', 'intellectual property',
  'third party', 'third-party', 'sub-processor', 'data controller', 'data processor',
  'retention', 'deletion', 'opt-out', 'opt out', 'unsubscribe',
  'shall', 'hereby', 'herein', 'pursuant', 'notwithstanding', 'aforementioned',
  'we reserve the right', 'you agree', 'by using', 'by accessing',
];

const NOISE_SELECTORS = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-label="navigation"]';
const INVISIBLE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME']);

// ── Main extraction ──

function extractLegalText() {
  // Strategy 1: Page title / heading match
  const titleResult = tryTitleMatch();
  if (titleResult) return cleanText(titleResult);

  // Strategy 2: Common content selectors
  const selectorResult = tryContentSelectors();
  if (selectorResult) return cleanText(selectorResult);

  // Strategy 3: Largest text block with legal keywords
  const scoredResult = tryKeywordScoring();
  if (scoredResult) return cleanText(scoredResult);

  // Strategy 4: Full page fallback
  const fallbackResult = tryFallback();
  if (fallbackResult) return cleanText(fallbackResult);

  return null;
}

// ── Strategy 1: Title / heading match ──
function tryTitleMatch() {
  // Check page title
  const pageTitle = document.title.toLowerCase();
  const hasLegalTitle = LEGAL_MARKERS.some(m => pageTitle.includes(m.toLowerCase()));

  if (hasLegalTitle) {
    // Grab the main content area or body text
    const main = document.querySelector('main, [role="main"], article, .content, #content');
    if (main) {
      const text = getVisibleText(main);
      if (text.length > 300) return text;
    }
  }

  // Check h1/h2 headings
  const headings = document.querySelectorAll('h1, h2');
  for (const heading of headings) {
    const headingText = heading.textContent.trim().toLowerCase();
    const matchedMarker = LEGAL_MARKERS.find(m => headingText.includes(m.toLowerCase()));
    if (!matchedMarker) continue;

    // Walk up to find a container with substantial text
    let container = heading.parentElement;
    for (let i = 0; i < 15; i++) {
      if (!container || container === document.body) break;
      if (container.matches && container.matches(NOISE_SELECTORS)) {
        container = container.parentNode;
        continue;
      }
      const text = getVisibleText(container);
      if (text.length > 500 && text.length < 100000) {
        const lower = text.toLowerCase();
        const signalCount = LEGAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
        if (signalCount >= 3) return text;
      }
      container = container.parentNode;
    }
  }

  return null;
}

// ── Strategy 2: Common content selectors ──
function tryContentSelectors() {
  const selectors = [
    'article', 'main', '[role="main"]',
    '.content', '#content',
    '.terms', '#terms',
    '.privacy', '#privacy',
    '.legal', '#legal',
    '.policy-content', '#policy-content',
    '[class*="terms"]', '[class*="privacy"]', '[class*="legal"]', '[class*="policy"]',
  ];

  for (const selector of selectors) {
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      if (el.closest && el.closest(NOISE_SELECTORS)) continue;
      const text = getVisibleText(el);
      if (text.length > 500) {
        const lower = text.toLowerCase();
        const signalCount = LEGAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
        if (signalCount >= 3) return text;
      }
    }
  }
  return null;
}

// ── Strategy 3: Keyword scoring ──
function tryKeywordScoring() {
  const candidates = document.querySelectorAll('div, section, article, main');
  let bestText = '';
  let bestScore = 0;

  for (const el of candidates) {
    if (el.closest && el.closest(NOISE_SELECTORS)) continue;
    const text = getVisibleText(el);
    if (text.length < 500) continue;
    const lower = text.toLowerCase();
    const matchCount = LEGAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
    const sizePenalty = text.length > 50000 ? 0.7 : 1;
    const score = matchCount * sizePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestText = text;
    }
  }

  if (bestScore < 3 || bestText.length < 500) return null;

  // Truncate very long documents
  if (bestText.length > 30000) {
    return bestText.substring(0, 30000);
  }

  return bestText;
}

// ── Strategy 4: Fallback ──
function tryFallback() {
  const main = document.querySelector('main, [role="main"], article');
  if (main) {
    const text = getVisibleText(main);
    if (text.length > 300) {
      return text.length > 30000 ? text.substring(0, 30000) : text;
    }
  }

  const bodyText = getVisibleText(document.body);
  if (bodyText.length > 500) {
    // Only use body text if it has legal keywords
    const lower = bodyText.toLowerCase();
    const signalCount = LEGAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
    if (signalCount >= 3) {
      return bodyText.length > 30000 ? bodyText.substring(0, 30000) : bodyText;
    }
  }

  return null;
}

// ── Helpers ──

function getVisibleText(root) {
  let text = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim();
      if (t) text += t + '\n';
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (INVISIBLE_TAGS.has(node.tagName)) return;
      if (node.matches && node.matches(NOISE_SELECTORS)) return;
    }
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      walk(children[i]);
    }
  };
  walk(root);
  return text;
}

function cleanText(text) {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

} // end duplicate-injection guard
