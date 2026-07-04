# ToS Scanner — Product Specification

## Overview

The ToS Scanner is a Chrome browser extension that analyzes Terms of Service and Privacy Policy documents and identifies red flags (clauses unfavorable to users) and green flags (user-friendly practices). It uses Claude Haiku to perform the analysis and displays results in a side panel alongside the legal document.

**Status:** Built, pre-submission
**Version:** 1.0.2
**Product ID in backend:** `tos-scanner`
**Scan type in API:** `tos-scan`

## What It Does

When a user is reading a Terms of Service, Privacy Policy, or similar legal document, they click the extension icon to open a side panel. They click "Scan This Page" and the extension:

1. Extracts the legal text from the current page
2. Sends it to the backend API with their license key
3. Backend deducts 1 credit, sends text to Claude Haiku for analysis
4. Returns a structured analysis with:
   - **Fairness score** (1-10, with color coding: red ≤4, orange 5-6, green 7+)
   - **Plain-language summary** (one paragraph)
   - **Red flags** (quoted text + plain-language meaning + severity: high/medium/low)
   - **Green flags** (quoted text + why it's user-friendly)
5. Extension displays results in the side panel with color-coded severity indicators

## Red Flags It Detects

- Data sharing with third parties or selling user data
- Broad license to user content (IP rights grab)
- Liability waivers or limitation of damages
- Unilateral right to change terms without notice
- Auto-renewal or difficult cancellation
- Binding arbitration or class-action waiver
- Jurisdiction in unfavorable locations
- Broad data retention or vague deletion policy
- Broad indemnification clauses

## Green Flags It Detects

- Clear data deletion / right to erasure
- No data selling
- Transparent data practices
- Easy cancellation
- Money-back guarantee or refund policy
- Clear contact information
- GDPR or other privacy-law compliance
- Open-source components disclosed

## Supported Sites

The extension works on **any website** with a Terms of Service or Privacy Policy. Unlike JRF (which uses site-specific selectors for job boards), ToS Scanner uses legal-keyword scoring to extract policy text from any page. Verified against 100 real ToS/Privacy pages across Big Tech, social, SaaS, fintech, e-commerce, media, and dev tools (89% pass rate in the May 13–14 smoke run, 86.7% in the 15-site varied smoke).

Page access uses `activeTab` only — the user clicks the toolbar icon on the page they want to scan, which grants temporary access to that tab. No `<all_urls>` permission, no permission prompt, no background access.

## Technical Architecture

### Extension structure
```
tos-scanner/
├── manifest.json              # Manifest V3, side panel, permissions
├── PRODUCT.md                 # This file
├── icons/
│   ├── icon16.png             # Red Z brand mark
│   ├── icon48.png
│   └── icon128.png            # 96×96 artwork + 16px padding
├── shared -> ../shared        # Symlink (build.sh resolves to real files)
├── src/
│   ├── config.js              # API_URL + PRICING_URL constants
│   ├── content.js             # Legal-text extraction (keyword-scored)
│   ├── content.css            # Reserved for future inline highlighting
│   ├── sidepanel.html         # Side panel UI with 7 states
│   ├── sidepanel.css          # Dark theme, orange-red gradient
│   └── sidepanel.js           # Main logic: scan, render results
└── tests/
    ├── shared.spec.js         # Layer 1: shared infra
    ├── extraction.spec.js     # Layer 2: extraction
    ├── smoke.spec.js          # Layer 3: end-to-end
    ├── live-urls.spec.js      # 100-site live URL smoke
    └── live-urls-smoke.spec.js # 15-site varied smoke (submission gate)
```

### Manifest permissions
- `activeTab` — access current tab content (granted on toolbar-icon click, scoped to that tab, expires when the user navigates or switches tabs)
- `scripting` — inject extractor into the active tab when the user initiates a scan
- `sidePanel` — Chrome Side Panel API
- `storage` — save license key locally

No `host_permissions` and no `optional_host_permissions` — the extension only ever touches the tab the user clicks the icon on.

### UI States (9 total)

1. **Welcome** — No license key. Feature list, "Get Started" button → pricing page, license key activation field.
2. **Initial** — License saved, credits available. "Scan This Page" button.
3. **Loading** — Scan in progress. Spinner + "Analyzing legal text..."
4. **Results** — Score badge (color-coded), summary, red flags (severity-bordered), green flags, "Scan Again".
5. **No Credits** — License valid, 0 credits. "Buy More Scans" + "Use a different license key".
6. **Error** — API or parsing failure. Error message + "Try Again" (credit refunded for 502s).
7. **No Legal Text** — Extraction found no legal document on the page. Hint to navigate to a Terms or Privacy page.
8. **Stale** — User switched tabs or navigated since the panel opened. activeTab grant is no longer valid. Instructs the user to click the toolbar icon to refresh access. No Scan button.
9. **Permission-needed** — `chrome.scripting.executeScript()` failed with a permission error (activeTab grant was missing or expired by the time the user clicked Scan). Instructs the user to click the toolbar icon to refresh access. Includes a "Try Again" button.

### State flow
```
Extension opened (user clicked Z toolbar icon, side panel opens with fresh activeTab grant)
    ↓
Check chrome.storage.local for license_key
    ├── No key → WELCOME
    └── Has key → GET /api/credits
                    ├── Invalid key → clear key → WELCOME
                    ├── Credits = 0 → NO CREDITS
                    └── Credits > 0 → INITIAL
                                         │
                                         │  (At any point while in INITIAL or RESULTS, if user
                                         │   switches tabs or navigates → STALE)
                                         ↓
                                    User clicks "Scan This Page"
                                         ↓
                                       LOADING
                                         ↓
                            chrome.scripting.executeScript() with activeTab
                                    ├── Permission error → PERMISSION-NEEDED
                                    └── Success → extractLegalText()
                                                     ├── No text found → NO LEGAL
                                                     └── Text found → POST /api/scan
                                                                         ├── 401 → clear key → WELCOME
                                                                         ├── 403 → NO CREDITS
                                                                         ├── 502 → ERROR (credit refunded)
                                                                         ├── Parse error → ERROR
                                                                         └── Success → RESULTS
                                                                                         ↓
                                                                                   Update credits display
```

### activeTab lifecycle

Chrome's `activeTab` permission is granted to the extension for the active tab when the user invokes the extension (clicks the toolbar icon or uses a configured shortcut). The grant covers exactly that tab and is revoked when the user switches tabs or navigates to a new URL.

This means:

- The side panel can stay open across tab switches, but the activeTab grant attached to it goes stale.
- A stale activeTab causes `chrome.scripting.executeScript()` to fail with a permission error.
- To re-arm the grant, the user must click the toolbar icon again (which is what the STALE and PERMISSION-NEEDED states instruct).

The side panel registers `chrome.tabs.onActivated` and `chrome.tabs.onUpdated` listeners. When either fires while the panel is in INITIAL or RESULTS state, it switches to STALE. Other states (LOADING, WELCOME, NO CREDITS, etc.) ignore tab-change events.

### Legal text extraction strategies

The content script (`content.js`) uses progressively broader strategies:

1. **Common legal-content selectors** — `main`, `article`, `.legal`, `#terms`, `.policy`, etc.
2. **Keyword-scored block selection** — scores `<div>`/`<section>`/`<article>` elements (300–250k chars) by density of legal keywords (agreement, terms, conditions, privacy, data, liability, indemnify, arbitration, governing law, retention, opt-out, "you agree", "by using", etc.)
3. **MutationObserver fallback** — for SPA pages (Meta, X/Twitter, TikTok), waits for content to render then re-extracts
4. **executeScript injection** — for sites where content_scripts didn't run, injects the extractor on demand

**Communication pattern:**
- Side panel sends `chrome.tabs.sendMessage(tabId, {action: 'extractLegalText'})` to content script
- Content script responds with `{text: "..."}`
- If content script isn't available, falls back to `chrome.scripting.executeScript`
- 3-second timeout per attempt

## API Integration

### Scan request
```
POST https://zurhaartools-api.andreaszurhaar.workers.dev/api/scan
Content-Type: application/json

{
  "type": "tos-scan",
  "text": "<extracted legal text>",
  "license_key": "<user's license key>"
}
```

### Successful response
```json
{
  "score": 4,
  "summary": "Several user-unfriendly clauses including broad data sharing and binding arbitration...",
  "redFlags": [
    {
      "text": "We may share your information with third parties for marketing purposes.",
      "meaning": "Your personal data can be sold or shared with advertisers and partners.",
      "severity": "high"
    }
  ],
  "greenFlags": [
    {
      "text": "You may delete your account at any time and we will remove your data within 30 days.",
      "meaning": "Clear right to erasure with a stated timeline."
    }
  ],
  "credits_remaining": 49
}
```

### Error responses
- 401 `{"error": "license_required"}` — no key provided
- 401 `{"error": "invalid_key"}` — key not found or wrong product
- 403 `{"error": "no_credits", "credits_remaining": 0}` — out of credits
- 502 `{"error": "Analysis service temporarily unavailable"}` — Claude API failed (credit refunded)

### Claude prompt
The backend uses a consumer-rights-expert system prompt that instructs Claude to:
- Identify red flags with exact quotes, plain-language meanings, severity levels
- Identify green flags with quotes and explanations
- Provide an overall fairness score 1–10 and a one-paragraph summary
- Respond in strict JSON format
- Text is truncated to 15,000 characters
- `max_tokens` raised to 4096 (long ToS pages need the headroom — Stripe SSA at 115k chars exercised this)

### JSON parsing
Claude occasionally wraps JSON in markdown fences or includes preamble. The backend strips markdown fences and uses regex (`/\{[\s\S]*\}/`) to extract JSON from non-clean responses. The extension also has a client-side fallback parser.

## Pricing

### Credit packs (via Stripe)
| Pack | Price | Per scan | Margin |
|---|---|---|---|
| 50 scans | €1.99 | €0.04 | ~87% |
| 150 scans | €4.99 | €0.03 | ~93% |
| 500 scans | €9.99 | €0.02 | ~96% |

### Cost per scan
- Claude Haiku API: ~€0.005
- Cloudflare Workers: €0 (free tier)
- D1 database: €0 (free tier)

### Stripe products
- Product: `tos-scanner`
- 3 live prices (50 / 150 / 500 scans) — already mapped in backend `STRIPE_PRICES`
- Custom data on checkout: `product=tos-scanner`

## Known Issues & Limitations

### Extraction
- 2 known failures from the 15-site smoke (May 14): Amazon Conditions and AliExpress ToS — `extractLegalText()` returns null due to unusual DOM structure. Both also failed in the 100-site baseline. Not a regression.
- SPA-heavy sites (Meta, X/Twitter, TikTok) require MutationObserver fallback — currently working.

### JSON parsing
- Same intermittent Claude JSON-format issues as JRF; same regex-based mitigation.

### Long documents
- Stripe SSA, Shopify ToS, and similar 80k+ char pages required raising `max_tokens` from 2048 to 4096 in the backend. Working as of May 13.

## Roadmap / Future Improvements

### Short term
- [ ] Submit to Chrome Web Store (this submission)
- [ ] Submit to Edge Add-ons
- [ ] Update website pricing page to flip ToS Scanner tab from "Coming Soon" to active
- [ ] Add Amazon + AliExpress to the extraction-failure-known-issues list in support docs

### Medium term
- [ ] Inline highlighting — mark red flags directly on the ToS page
- [ ] Scan history — locally stored list of previously scanned policies
- [ ] Comparison view — side-by-side comparison of two services' ToS scores
- [ ] Saved alerts — notify when a frequently-visited service updates its ToS

### Long term
- [ ] Firefox version
- [ ] Mobile-friendly web scanner at zurhaartools.com (paste-in-text, no extension)
- [ ] B2B variant: bulk scan ToS across a company's vendor stack

## Distribution

### Chrome Web Store
- Developer account: andreaszurhaar
- Extension name: ToS Scanner
- Category: Productivity
- Status: Ready for submission (this work)

### Edge Add-ons
- Developer account: andreaszurhaar
- Same extension name and listing
- Requires 300×300 logo in addition to Chrome's asset set

### Marketing channels
- Product page on zurhaartools.com (pricing tab flips to active post-approval)
- Reddit: r/privacy, r/legaladvice, r/assholedesign, r/consumeradvice
- LinkedIn posts showing real scan results of well-known services (Spotify, Apple, Meta, Stripe)
- Product Hunt launch
- Chrome Web Store organic search ("terms of service analyzer", "privacy policy reader", "ToS scanner")

## Files & Paths

| Item | Path |
|---|---|
| Extension source | /Users/andreaszurhaar/Projects/zurhaartools-extensions/tos-scanner/ |
| Backend source | /Users/andreaszurhaar/Projects/zurhaartools-api/ |
| Hub website | /Users/andreaszurhaar/Projects/zurhaartools/ |
| Product images | /Users/andreaszurhaar/Projects/media/tos-scanner/ |
| D1 database | zurhaartools-db (Cloudflare, region WEUR) |
| Live API | https://zurhaartools-api.andreaszurhaar.workers.dev |
| Live website | https://zurhaartools.com |
