# zurhaartools-extensions

Two Manifest V3 Chrome extensions, live on the Chrome Web Store, built and shipped solo as part of
[Zurhaar Tools](https://zurhaartools.com).

| Extension | What it does |
|---|---|
| **ToS Scanner** | Reads a Terms of Service or Privacy Policy in the page and surfaces the clauses that are unfavourable to the user, alongside the ones that are genuinely user-friendly, with a plain-language summary and a fairness score |
| **Job Red Flag Detector** | Reads a job posting and surfaces warning signs and positive signals |

Both run the analysis through Claude Haiku and render results in a side panel next to the document
being read, so the source text and the analysis stay on screen together.

## Why these two

They are the same problem twice: a long document written by one party, read under time pressure by
another party who is not equipped to spot what matters in it. The interesting work is not calling a
model — it is deciding what counts as a finding, keeping the output stable enough that the same document
does not score differently on two runs, and failing honestly when the page does not contain what the
extension expected.

## Engineering notes

**Shared core, separate products.** The extensions share a `shared/` layer — side-panel state machine,
licence handling, API client, result rendering — with per-product configuration. Adding a third product
is a config file and a prompt, not a fork.

**Explicit UI states.** The side panel is a small state machine: welcome (no licence), initial, loading,
results, error. Every state is a real rendered state rather than a spinner over a blank panel, because
"nothing happened" is the failure mode users report as a bug.

**Credits are metered server-side.** The extension never holds a secret. It sends a licence key; the
[backend](https://github.com/andreaszurhaar/zurhaartools-api) deducts atomically and refunds the credit
if the model errors or returns unusable content. Nothing about the client is trusted.

**Manifest V3 constraints are the design.** No persistent background page, no remote code, a service
worker that can be killed at any moment — so state that matters lives in storage or on the server, never
in memory.

## Layout

```
tos-scanner/                ToS Scanner — manifest, side panel, content script, PRODUCT.md spec
job-red-flag-detector/      Job Red Flag Detector — same shape
shared/                     side-panel state machine, licence + API client, renderers
PLAYBOOK.md                 the checklist for shipping a new extension end to end
TESTER.md                   manual test script run before each store submission
```

`PRODUCT.md` in each extension folder is the actual product specification, including the pricing and
unit economics — a 50-scan pack sells for €1.99 at roughly €0.04 per scan.
