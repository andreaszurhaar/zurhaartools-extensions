# Extensions Playbook

> Living document — updated after each extension launch. Last updated: May 7, 2026.

---

## 1. Create a New Extension

### Scaffold

```bash
# Replace "tos-scanner" with your extension name
EXT=tos-scanner

mkdir -p $EXT/src $EXT/icons
ln -s ../shared $EXT/shared

# Copy templates from job-red-flag-detector
cp job-red-flag-detector/manifest.json $EXT/
cp job-red-flag-detector/src/config.js $EXT/src/
cp job-red-flag-detector/src/sidepanel.html $EXT/src/
cp job-red-flag-detector/src/sidepanel.css $EXT/src/
cp job-red-flag-detector/src/sidepanel.js $EXT/src/

# Create a blank content.js — extraction logic is always extension-specific
touch $EXT/src/content.js

# Copy placeholder icons (replace with real ones before submission)
cp job-red-flag-detector/icons/* $EXT/icons/
```

### What to customize

| File | Action |
|---|---|
| `manifest.json` | Change name, description, version. Set `"service_worker": "shared/background.js"`. Update `content_scripts.matches` for target sites. |
| `src/config.js` | Set `PRICING_URL` for the new product. `API_URL` stays the same. |
| `src/content.js` | Write extraction logic for the new scan type. Use the message listener pattern from job-red-flag-detector. |
| `src/sidepanel.js` | Change scan type in `performScan()` call. Write product-specific results rendering. Wire up product-specific UI elements. |
| `src/sidepanel.html` | Update product name, welcome copy, feature list, button labels. Keep the shared HTML structure (states, license input, credits display, footer). |
| `src/sidepanel.css` | Usually no changes needed — shared dark theme works across extensions. |
| `icons/` | Replace with product-specific icons (16x16, 48x48, 128x128 PNG). |

### What stays shared (don't touch)

- `shared/background.js` — service worker
- `shared/license.js` — license key storage
- `shared/ui.js` — state management, credits display
- `shared/api.js` — `performScan()` with credit/license error handling
- `shared/activation.js` — license activation, init flow, shared event listeners
- Script tag order in `sidepanel.html`: config.js → license.js → ui.js → api.js → activation.js → sidepanel.js

### manifest.json setup

```json
{
  "background": {
    "service_worker": "shared/background.js"
  },
  "permissions": ["activeTab", "scripting", "sidePanel", "storage"],
  "optional_host_permissions": ["<all_urls>"],
  "content_scripts": [{
    "matches": ["*://*.example.com/*"],
    "js": ["src/content.js"]
  }]
}
```

Never use `host_permissions` or `tabs` permission. See CLAUDE.md for full policy.

### Cross-agent coordination

A new extension isn't just code in this repo. You also need:

- **Backend agent**: add scan type in `PRODUCT_FOR_TYPE`, add AI prompt in `PROMPTS`, create Stripe products/prices/payment links, add price mapping in `STRIPE_PRICES`
- **Website agent**: add product to pricing page, update success page if needed

See `~/Projects/ZURHAARTOOLS.md` → "How to Add New Products" for the full cross-project checklist.

---

## 2. Develop

### How shared/ works

- Each extension has a symlink: `my-extension/shared/ → ../shared/`
- `sidepanel.html` loads shared files via `<script src="../shared/license.js">` etc.
- All scripts share the same global scope — no ES modules, no bundler, no imports
- Edit `shared/` once, all extensions see the change immediately during development

### What belongs where

| shared/ | Extension-specific |
|---|---|
| License key get/save/clear | Content extraction logic |
| UI state management (show/hide states) | Results rendering |
| Credits display | Scan function (scan type, response parsing) |
| License activation + init flow | "Scan This Page" permission flow |
| API call with error handling | Product-specific UI copy |
| Service worker | Site-specific selectors and markers |

### Rule: shared/ changes affect all extensions

If you modify any file in `shared/`, you must test every extension (step 3) and rebuild all (step 5) before submitting.

---

## 3. Test (Manual)

Run this checklist before every submission. Load unpacked from `chrome://extensions`.

- [ ] Extension loads without errors (check service worker status on extensions page)
- [ ] License activation: enter key → validates → shows credits in header
- [ ] Scan works on 3+ listed sites (vary between site-specific selectors)
- [ ] Scan works on unlisted site via "Allow & Scan" (grants permission, injects, scans)
- [ ] Revoking permission → scanning unlisted site → shows no-job state (not infinite loading)
- [ ] No credits: shows "You've used all your scans" with buy link
- [ ] Error state: disconnect network → scan → shows error with retry button
- [ ] Change key: click "Use a different license key" → returns to welcome state
- [ ] Privacy policy link in footer opens zurhaartools.com/privacy
- [ ] No console errors during any of the above (check DevTools for the side panel)

---

## 4. Test (Automated — future)

Not yet implemented. Planned approach:

- Playwright E2E tests with Chrome extension loading
- Per-extension test specs in a `tests/` directory
- CI runs on every `shared/` change to catch regressions across all extensions
- Will be set up alongside the next extension launch

---

## 5. Build

```bash
# Single extension
./scripts/build.sh job-red-flag-detector

# All extensions
./scripts/build.sh all
```

The script removes the symlink, copies real `shared/` files into the extension, zips to `dist/`, then restores the symlink.

### Verify the zip

```bash
unzip -l dist/job-red-flag-detector.zip
```

Confirm:
- `shared/` directory contains physical files (license.js, ui.js, api.js, activation.js, background.js)
- No symlinks in the zip
- No `.env`, `PRODUCT.md`, dotfiles, or secrets

### If shared/ changed: build ALL extensions

Every extension ships its own copy of `shared/` in the zip. If shared code changed, all zips need rebuilding and resubmitting.

---

## 6. Pre-Submission Audit

See **CLAUDE.md → Chrome Web Store policy compliance** for the full checklist. Additional checks:

- [ ] Version bumped in `manifest.json`
- [ ] No `console.log` or debug logging in any file
- [ ] No `.env`, credentials, or secrets in the zip
- [ ] `unzip -l` shows only expected files
- [ ] Description has no keyword spam (no specific site names)
- [ ] Privacy policy at zurhaartools.com/privacy is up to date

---

## 7. Publish

### Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Upload `dist/<extension>.zip`
3. Fill in / verify listing details, screenshots, privacy practices
4. Submit for review

### Edge Add-ons

1. Go to [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge)
2. Upload the same `dist/<extension>.zip`
3. Submit for review

### Review times

- Updates: typically 1-3 days
- Initial submissions: can take longer (up to a week)

### After approval

Coordinate with other agents:
- **Website**: update "Get the Extension" links on success page, pricing page, email template
- **Backend**: verify scan type and Stripe products are set up
- Update `~/Projects/STATUS.md`

---

## 8. Update Existing Extensions

### shared/ changed

1. Test ALL extensions (step 3)
2. Build ALL extensions (step 5)
3. Bump version in ALL manifest.json files
4. Submit ALL extensions (step 7)

### Extension-specific code changed

1. Test only that extension (step 3)
2. Build only that extension (step 5)
3. Bump version in that extension's manifest.json
4. Submit only that extension (step 7)

---

## 9. Lessons Learned

_Updated after each extension launch._

- **2026-05-07**: `chrome.scripting.executeScript()` can hang indefinitely when host permissions are revoked — always wrap in `Promise.race` with a timeout (same pattern used for `chrome.tabs.sendMessage`). Discovered during shared/ refactor testing when scanning unlisted sites after revoking `<all_urls>` permission caused infinite loading.
