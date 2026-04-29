# Job Red Flag Detector — Product Specification

## Overview

The Job Red Flag Detector is a Chrome browser extension that analyzes job postings and identifies warning signs (red flags) and positive signals (green flags). It uses Claude Haiku to perform the analysis and displays results in a side panel alongside the job posting page.

**Status:** MVP complete, pre-launch
**Version:** 1.1.0
**Product ID in backend:** `job-red-flag-detector`
**Scan type in API:** `job-red-flags`

## What It Does

When a user is browsing job listings on any supported job board, they click the extension icon to open a side panel. They click "Scan This Job Posting" and the extension:

1. Extracts the job posting text from the current page
2. Sends it to the backend API with their license key
3. Backend deducts 1 credit, sends text to Claude Haiku for analysis
4. Returns a structured analysis with:
   - **Overall score** (1-10, with color coding: red ≤4, orange 5-6, green 7+)
   - **Summary** (one sentence assessment)
   - **Red flags** (quoted text from posting + plain language explanation + severity: high/medium/low)
   - **Green flags** (quoted text + why it's positive)
5. Extension displays results in the side panel with color-coded severity indicators

## Red Flags It Detects

- Vague or missing salary information ("competitive salary")
- Unrealistic experience requirements (10 years in a 5-year-old technology)
- Toxic culture signals ("fast-paced environment", "we're like a family", "work hard play hard")
- Excessive requirements for the seniority level
- Unpaid overtime expectations disguised as "passion"
- Vague role definition ("other duties as assigned", "wear many hats")
- Scope creep indicators (entry-level doing senior-level work)
- Missing benefits information

## Green Flags It Detects

- Clear salary range disclosed
- Realistic experience requirements
- Concrete benefits listed (training budget, vacation days, etc.)
- Clear role definition and responsibilities
- Growth/development opportunities
- Transparent hiring process

## Supported Job Sites

Content script auto-injects on:
- LinkedIn (linkedin.com/*)
- Indeed (indeed.com/*)
- Glassdoor (glassdoor.com/*, glassdoor.nl/*)
- Nationale Vacaturebank (nationalevacaturebank.nl/*)
- Monster (monster.com/*, monster.nl/*)
- Reed (reed.co.uk/*)
- SEEK (seek.com.au/*)
- StepStone (stepstone.de/*, stepstone.nl/*)

Also works on any other job site via the generic keyword-scoring fallback extractor (triggered via chrome.scripting.executeScript).

## Technical Architecture

### Extension structure
```
job-red-flag-detector/
├── manifest.json              # Manifest V3, side panel, permissions
├── PRODUCT.md                 # This file
├── product-image.html         # HTML template for generating product images
├── .gitignore
├── icons/
│   ├── icon16.png             # Placeholder orange icons
│   ├── icon48.png             # TODO: Replace with proper designed icons
│   └── icon128.png
└── src/
    ├── background.js          # Service worker: icon click → open side panel
    ├── config.js              # API URL + pricing URL constants
    ├── content.js             # Injected into job sites, extracts job text
    ├── content.css            # Reserved for future inline highlighting
    ├── sidepanel.html         # Side panel UI with 7 states
    ├── sidepanel.css          # Dark theme, orange-red gradient styling
    └── sidepanel.js           # Main logic: license management, scanning, rendering
```

### Manifest permissions
- `activeTab` — access current tab content
- `scripting` — inject scripts for text extraction on non-matched sites
- `sidePanel` — Chrome Side Panel API
- `tabs` — detect navigation for auto-rescan
- `storage` — save license key locally

### UI States (7 total)

1. **Welcome** (`state-welcome`) — No license key saved. Shows feature list, "Get Started" button (links to pricing page), license key input field with "Activate" button.

2. **Initial** (`state-initial`) — License key saved, credits available. Shows "Scan This Job Posting" button.

3. **Loading** (`state-loading`) — Scan in progress. Shows spinner + "Analyzing job posting..."

4. **Results** (`state-results`) — Scan complete. Shows score badge (color-coded), summary, red flags list (with severity borders), green flags list, "Scan Again" button.

5. **No Credits** (`state-no-credits`) — License key valid but 0 credits remaining. Shows "Buy More Scans" button + "Use a different license key" link.

6. **Error** (`state-error`) — API error or parsing failure. Shows error message + "Try Again" button.

7. **No Job** (`state-no-job`) — Text extraction found no job posting on current page. Shows message + list of supported sites.

### State flow
```
Extension opened
    ↓
Check chrome.storage.local for license_key
    ├── No key → WELCOME
    └── Has key → GET /api/credits
                    ├── Invalid key → clear key → WELCOME
                    ├── Credits = 0 → NO CREDITS
                    └── Credits > 0 → INITIAL
                                         ↓
                                    User clicks "Scan"
                                         ↓
                                      LOADING
                                         ↓
                               Extract job text from page
                                    ├── No text found → NO JOB
                                    └── Text found → POST /api/scan
                                                        ├── 401 → clear key → WELCOME
                                                        ├── 403 → NO CREDITS
                                                        ├── 502 → ERROR (credit refunded)
                                                        ├── Parse error → ERROR
                                                        └── Success → RESULTS
                                                                        ↓
                                                                  Update credits display
```

### Job text extraction strategies

The content script (`content.js`) uses site-specific extraction:

**LinkedIn extraction (most complex due to dynamic SPA):**
1. Find "About the job" / "Over de functie" heading via TreeWalker, walk up DOM to find container
2. Known CSS selectors (#job-details, .jobs-description__content, etc.)
3. Full page text search for heading markers
4. Keyword-scored content blocks (best match by job-related keyword density)

**Glassdoor extraction:**
- .jobDescriptionContent, #JobDescriptionContainer selectors
- Falls back to generic

**Indeed extraction:**
- #jobDescriptionText, .jobsearch-JobComponent-description selectors
- Falls back to generic

**Generic extraction (all other sites):**
- Common job description CSS selectors
- Keyword-scored fallback: finds div/section/article elements (300-10K chars) and scores by job keyword density
- Keywords: experience, requirements, qualifications, responsibilities, salary, benefits, skills, role, position, apply (+ Dutch: ervaring, functie, verantwoordelijkheden, salaris)

**Communication pattern:**
- Side panel sends `chrome.tabs.sendMessage(tabId, {action: 'extractJobText'})` to content script
- Content script responds with `{text: "..."}`
- If content script not available (non-matched site), falls back to `chrome.scripting.executeScript`

### Auto-scan on navigation
When the side panel is open and the user navigates to a new page on a supported job site, the extension automatically triggers a scan after 1.5 seconds (delay for SPA content loading). Only fires if a valid license key is saved. Protected by `isScanning` flag to prevent duplicate requests.

## API Integration

### Scan request
```
POST https://zurhaartools-api.andreaszurhaar.workers.dev/api/scan
Content-Type: application/json

{
  "type": "job-red-flags",
  "text": "<extracted job posting text>",
  "license_key": "<user's license key>"
}
```

### Successful response
```json
{
  "score": 7,
  "summary": "A well-structured posting with clear expectations...",
  "redFlags": [
    {
      "text": "Competitive salary",
      "meaning": "Vague compensation with no specific range...",
      "severity": "high"
    }
  ],
  "greenFlags": [
    {
      "text": "25 vacation days",
      "meaning": "Above-average vacation allowance...",
    }
  ],
  "credits_remaining": 47
}
```

### Error responses
- 401 `{"error": "license_required"}` — no key provided
- 401 `{"error": "invalid_key"}` — key not found or wrong product
- 403 `{"error": "no_credits", "credits_remaining": 0}` — out of credits
- 502 `{"error": "Analysis service temporarily unavailable"}` — Claude API failed (credit refunded)

### Claude prompt
The backend uses a detailed system prompt that instructs Claude to:
- Act as an expert career advisor
- Identify red flags with exact quotes, plain language meanings, and severity levels
- Identify green flags with quotes and explanations
- Provide an overall score 1-10 and one-sentence summary
- Respond in strict JSON format
- Text is truncated to 15,000 characters to control costs

### JSON parsing
Claude sometimes wraps JSON in markdown code blocks or includes extra text. The backend strips markdown fences and uses regex (`/\{[\s\S]*\}/`) to extract JSON from non-clean responses. The extension also has a client-side fallback parser.

## Pricing

### Credit packs (via LemonSqueezy)
| Pack | Price | Per scan | Margin |
|---|---|---|---|
| 50 scans | €1.99 | €0.04 | ~87% |
| 150 scans | €4.99 | €0.03 | ~93% |
| 500 scans | €9.99 | €0.02 | ~96% |

### Cost per scan
- Claude Haiku API: ~€0.005
- Cloudflare Workers: €0 (free tier)
- D1 database: €0 (free tier)

### LemonSqueezy product
- Store: zurhaartools.lemonsqueezy.com
- Product name: Job Red Flag Detector
- 3 variants: 50 Scans, 150 Scans, 500 Scans
- Variant IDs: TBD (update CREDIT_BUNDLES in backend after publishing)
- Custom data on checkout: `product=job-red-flag-detector`

## Known Issues & Limitations

### LinkedIn extraction
- LinkedIn is a SPA with dynamic class names that change frequently
- The current extraction works but can sometimes fail to find the job description
- When it fails, it may pick up LinkedIn UI elements instead of the job text
- Solution: multiple extraction strategies with fallbacks, but may need periodic updates as LinkedIn changes their DOM

### JSON parsing
- Claude occasionally returns responses that can't be parsed as JSON
- The "Could not parse structured response" error appears intermittently
- Current mitigation: aggressive regex-based JSON extraction on both backend and client
- Clicking "Scan Again" usually works on retry

### Text extraction on unknown sites
- Generic keyword-scoring fallback works reasonably well but can grab too much or too little text
- Best results on LinkedIn, Glassdoor, Indeed where we have specific selectors

## Roadmap / Future Improvements

### Short term
- [ ] Replace placeholder icons with properly designed ones
- [ ] Add "Copy results" button for sharing scan results
- [ ] Improve LinkedIn extraction reliability
- [ ] Fine-tune the Claude prompt to reduce JSON parsing errors
- [ ] Add a privacy policy page (required for Chrome Web Store)

### Medium term
- [ ] Inline highlighting — mark red flags directly on the job posting page
- [ ] Scan history — show previously scanned jobs (stored locally)
- [ ] Batch scan — scan multiple job listings from a search results page
- [ ] Support for Dutch-language job postings (improved extraction + Dutch prompt variant)

### Long term
- [ ] Firefox and Edge versions (using WXT framework for cross-browser)
- [ ] Mobile-friendly web version at zurhaartools.com (no extension needed)

## Distribution

### Chrome Web Store
- Developer account: andreaszurhaar
- Extension name: Job Red Flag Detector
- Category: Productivity (or Job Search)
- Not yet submitted — waiting for final polish + proper icons

### Marketing channels
- Product page on zurhaartools.com
- Reddit: r/jobs, r/cscareerquestions, r/recruitinghell, r/jobsearchhacks
- LinkedIn posts showing real scan results (high viral potential — people love sharing bad job postings)
- Product Hunt launch
- Chrome Web Store organic search ("job posting analyzer", "job red flags")

## Files & Paths

| Item | Path |
|---|---|
| Extension source | /Users/andreaszurhaar/Projects/zurhaartools-extensions/job-red-flag-detector/ |
| Backend source | /Users/andreaszurhaar/Projects/zurhaartools-api/ |
| Hub website | /Users/andreaszurhaar/Projects/zurhaartools/ |
| Product images | /Users/andreaszurhaar/Projects/media/job-red-flag-detector/ |
| D1 database | zurhaartools-db (Cloudflare, region WEUR) |
| Live API | https://zurhaartools-api.andreaszurhaar.workers.dev |
| Live website | https://zurhaartools.com |
