# NEVERHELD independent review: findings

**Reviewed:** branch `build/phase-1-core-extraction` at `c250ca5` (the code head `1e2440f` plus handover documents), against `NEVERHELD-US-Spec-v0.5` and `docs/CLAUDE-HANDOVER.md`.
**Reviewer:** Claude (Anthropic AI model), 27 Nov 2026, at John Akinmade's request. This is an AI-assisted engineering review, **not an independent security audit**.
**Method:** code reading, then reproduction in a real browser before any change. Each confirmed finding has a regression test; the test IDs (R1 to R9) appear in `tests/seal-kit.test.ts`, `tests/release.test.ts`, `scripts/browser-check.mjs` and `scripts/nextjs-check.mjs`.

Round 1 line numbers refer to `c250ca5`, round 2 to `2a5f411`, round 3 to `87471d1`.

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **Critical** | A service worker can send out data the sealed page gives it, while the NOPE count stays at 0 and every Control Answer says "supported" | Fixed: detected and fails closed (R1) |
| 2 | **High** | A worker started before sealing can send data out with the count at 0; the evidence was a host self-declaration | Fixed: observed and recorded (R2); residual limit documented |
| 3 | **High** | Control Answer wording claims "the release's live seal check" tests workers; no such check exists | Fixed (R3) |
| 4 | **High** | The one-tag path records no files, and the answer then reads "The 0 file(s) were processed inside the browser tab" | Fixed: file inputs and drops are fingerprinted automatically; wording is honest when none are recorded (R4) |
| 5 | **High** | A file opened before sealing would be listed as if it had been protected | Fixed: each file records `openedAfterSeal`; earlier files make answers unsupported (R5) |
| 6 | **High** | The one-tag install seals as soon as the script runs, cutting off resources still loading (images, async chunks) | Fixed: waits for the page `load` event (R9; Next.js check) |
| 7 | Medium | The verifier and proof limits collapse different assurances; the proof limits say the named release "is signed, and the verifier checks that" even when no release seal exists | Fixed: four separate levels in the API, verifier page and CLI (R6, R8) |
| 8 | Medium | The offline verifier's own CSP is malformed: `base-uri 'none` has no closing quote (`build-kit.mjs:30`), so `base-uri` is not enforced | Fixed (R7) |
| 9 | Medium | The QR text says it opens "the verifier"; it opens a hosted URL that needs a connection, and plain `http:` was accepted | Fixed: wording separates the offline and online routes; `http:` only for localhost |
| 10 | Medium | No lockfile; CI ran `npm install`; Chromium only; no Next.js test; `"private": false` allows an accidental public npm publish of an all-rights-reserved package | Fixed: lockfile, `npm ci`, three-browser matrix, real Next.js fixture, `"private": true` |
| 11 | Medium | No release lifecycle: no package, manifest generator, signing script, reproducibility check or TSA validation | Built and tested with an ephemeral key and a local test TSA. **The production key and the choice of TSA remain John's decisions** |
| 12 | Low | Limits omitted real leak routes: new windows or tabs opened by script, browser storage read by a later unsealed visit, data passed to other tabs or frames | Fixed: added to proof limits and Control Answer limits |

## Detail

### 1. Service worker bypass (Critical)
- **Where:** `seal.ts` (no service-worker check anywhere); `control-answers.ts:40-46`.
- **Reproduced (Chromium):** page registers `/sw.js`, the service worker claims the page, the kit seals. `navigator.serviceWorker.controller.postMessage(secret)` then the service worker's `fetch("/exfil?d=secret")` **reached the server**. NOPE count 0, blocked 0, all six answers "supported".
- **Why:** a service worker is a separate context. The page's meta CSP does not apply to it, and `postMessage` is not a network request.
- **Fix:** at sealing, the seal records `serviceWorker` as `none`, `registered`, `controlling` or `not-available`. It re-reads the controller on every status read, because a worker can claim the page later. A failed lookup is recorded as `registered` (the unsafe answer). Ruleset condition: `serviceWorker ∈ {none, not-available}`.
- **Tests:** R1 (unit); browser scenario `/sw`.

### 2. Workers started before sealing (High)
- **Where:** `script-tag.ts:43-44`; `control-answers.ts:45`.
- **Reproduced (Chromium):** `new Worker("/w.js")` before sealing, then `postMessage` after sealing: the worker's fetch **reached the server**, with the count at 0. Blob workers started *after* sealing were refused, which confirms that they inherit the page's policy.
- **Fix:** `observeWorkers()` wraps `Worker` and `SharedWorker` when the kit loads. It only counts and never blocks. The proof records `workers.startedBeforeSeal` and `startedAfterSeal`, plus the owner's declaration (`none`, `blocked` or `not-declared`). Evidence is `declared-none`, `declared-blocked`, `not-declared`, or `contradicted` (declared none, but one was seen).
- **Residual (documented, not fixable in a page):** workers started before NEVERHELD loaded, or started through a reference saved before it loaded, cannot be seen. For those, the proof relies on the owner's declaration, and the wording says it was not tested.
- **John/counsel decision:** `declared-blocked` currently yields "supported", with wording that states the declaration was not tested. If you prefer that only observed evidence can support an answer, change the `workers` condition to `oneOf: ["declared-none"]`.

### 3. False "live seal check" claim (High)
- **Where:** `control-answers.ts:52`. The text "this session did not test them (the release's live seal check does)" described a check that does not exist.
- **Fix:** replaced by per-state wording that states only what was declared or observed. Ruleset bumped to 2.0.0, so the fingerprint changes.

### 4 and 5. File fingerprints (High)
- **Where:** `script-tag.ts:62` (`files: []`); `control-answers.ts:52` ("The {files} file(s) were processed").
- **Fix:** new `files.ts`. The one-tag install fingerprints files chosen in `<input type=file>` or dropped on the page (opt out with `data-observe-files="off"`). Hosts can add their own with `Neverheld.recordFile(blob)` or `recordFingerprint(name, sha256)`. Each entry records `source` and `openedAfterSeal`. With none recorded, the wording reads: "No file fingerprints were recorded, so this proof does not show which files, if any, the page processed." Any file opened before sealing makes the answers unsupported.
- **Limit:** files the app opens by other routes (for example `showOpenFilePicker`, or inputs inside a closed shadow root) are listed only if the host records them. The proof and the docs say so.

### 6. Sealing too early (High)
- **Where:** `script-tag.ts:52,72`: `sealPage` ran immediately.
- **Fix:** the tag waits for `DOMContentLoaded` to show its gate, and for `load` to seal. Test `/late`: a 400 ms image is still loaded before the seal, with the count at 0. The Next.js fixture seals after hydration with zero requests and zero blocked attempts, and the app stays interactive.

### 7. Collapsed "verified" claims (Medium)
- **Where:** `proof.ts:58`; `verifier-page.ts:31-33`; `verify-proof.mts:19`.
- **Fix:** `VerifyResult.assurance = { proofConsistent, release: authentic | not-checked | failed, independentTimestamp: "not-verified", sessionAttestation: "not-provided" }`. The verifier page and the CLI print the four levels separately.

### 8. Verifier CSP typo (Medium)
- **Where:** `build-kit.mjs:30`. Test R7 parses the built page's policy and allows only `'none'`, `'unsafe-inline'` and `data:`.

### 9. QR wording (Medium)
- A QR code cannot hold the verifier (about 25 KB), so a scan can only open a hosted copy. That copy needs a connection to load, then checks in the browser; the hash travels in the URL fragment, which browsers do not send to the server. The spec's "QR opens the offline verifier" is not achievable as written, and the docs now say so plainly. The genuinely offline route is the verifier file in the ZIP or release, which the browser test exercises with the network off.

### 11. Release lifecycle (Medium)
- New: `scripts/package-release.mjs` (archive, manifest, SHA256SUMS, types), `scripts/repro-check.mjs` (two clean builds, byte-identical archive), `scripts/sign-release.mjs` (format 2 seal; refuses a key inside the repo or one that does not match the published key; writes the RFC 3161 request and attaches the reply), and `coldcheck-release.sh` (validates an RFC 3161 token against a supplied TSA CA).
- **Not done, deliberately (per the brief):** no production keypair generated, `release-public-key.json` still empty, no TSA chosen, nothing published.

## Reviewed and not changed
- `'unsafe-inline'` for scripts and styles: phase 2, per v0.5.
- Proof authenticity: a page cannot sign for itself. This is inherent and stated everywhere.
- Self-test probes `fetch` only. Other directives are covered by the strict allowlist check on the policy text (`proof.ts:67-83`), which looked correct.
- `keepLinksInNewTabs` opens link URLs in a new tab. A link URL can carry data; this is covered by the new-window limit.
- Large files are read into memory to hash them. Acceptable for documents; note it for very large media.

---

# Round 2: second independent review (of `2a5f411`)

A second reviewer checked v0.2.0. I verified each of their six findings against the code; all six were valid. Testing them also turned up two more issues, marked ★. Regression tests R10 to R17.

| # | Severity | Finding | Status |
|---|---|---|---|
| 2.1 | **Critical** | CSP does not govern WebRTC, DNS prefetch, preconnect or speculative loading, yet the Control Answers said the page "sent nothing by network connection or resource request" | Measured per browser; page-level blocking added; wording bounded to what was measured (R10, R12, R15). Residual limits documented |
| 2.1★ | **Critical** | A WebSocket (or WebRTC) connection opened before sealing stays open and keeps sending after sealing (reproduced: frame received with the count at 0) | Detected (`connectionsOpenAtSeal`); any open connection makes answers "not supported" (R11, R15) |
| 2.1★ | **High** | The runtime file began with the banner "Not one packet escaped", an unqualified claim the handover forbids | Removed; test asserts its absence (R10) |
| 2.2 | High | `files.ts:28-40`: `openedAfterSeal` was taken when the host called the API, not when the file was opened | `openedAt` is required for host fingerprints and compared with the seal time when the proof is written (R14) |
| 2.3 | High | `control-answers.ts:51-57`: an untested worker declaration gave plain "supported" | New result `supported-if-declaration-holds`, with an explicit sentence; editing it to "supported" fails verification (R13) |
| 2.4 | Medium | `seal.ts:239-251`: counting started after the self-test and service-worker check, so attempts in that window were missed | Counting, guards and the sealing time all start in the same task as the policy (R16) |
| 2.5 | Medium | QR renderer not in the buyer archive | `tools/neverheld-render-proof.cjs`, one bundled file, plus THIRD-PARTY-LICENSES.txt (all MIT, ISC or Zlib; jszip used under MIT). Tested from the unpacked archive with no node_modules (R17) |
| 2.6 | Medium | Handover and sale-readiness documents out of date | Status banners added; historical references labelled; readiness checklist updated |

## 2.1 in detail: what the one-tag model can and cannot do

A script tag cannot set response headers. So it cannot use Chrome's `Connection-Allowlist`, the only browser-enforced control covering WebRTC, DNS prefetch and navigations, and that is Chrome 152+ only. What a page *can* do, all page-level and evadable, now runs at sealing:
- wrap `RTCPeerConnection` (and the `webkit` prefix) and `WebTransport` when NEVERHELD loads, and throw `SecurityError` after sealing;
- remove speculation rules present at sealing, and remove speculation rules and connection hints added after sealing;
- set `x-dns-prefetch-control: off`;
- optionally record whether the page is served with a `Connection-Allowlist` header.

Measured in CI (run linked in the readiness checklist):

| Route after sealing | Chromium | Firefox | WebKit |
|---|---|---|---|
| WebRTC in the page | blocked | blocked | blocked |
| Speculation-rules prefetch | blocked | blocked | blocked (not supported) |
| Preconnect hint | blocked | blocked | **1 TCP connection** |
| WebRTC via an iframe's own copy | **leaks** | **leaks** | **leaks** |
| Open pre-seal WebSocket | detected → not supported | detected | detected |
| DNS prefetch | not measured | not measured | not measured |

**Residual limits:**
- WebRTC through a frame's copy cannot be closed by page code. Frames can be reached through `window[0]`, which no wrapper can intercept, and `frame-src 'none'` does not stop `about:blank` frames.
- WebKit preconnects synchronously on insertion.
- These are stated in the proof limits, the Control Answer wording, `LIMITATIONS.md` and `SECURITY-BOUNDARIES.md`. The claim is now: *browser-enforced CSP for the listed routes, plus page-level blocking for WebRTC and hints with stated gaps*.

**Decision for John (recorded in the readiness checklist):** whether a Chrome host must serve `Connection-Allowlist` before answers can be "supported". At present it is recorded only.

---

# Round 3: final review (of `87471d1`)

All four technical findings were valid. Regression tests R18 to R21.

| # | Severity | Finding | Status |
|---|---|---|---|
| 3.1 | High | `declared-none` still gave plain "supported", although workers started before NEVERHELD loaded cannot be seen | Every declaration gives `supported-if-declaration-holds`; no unconditional "supported" exists in ruleset 3.1.0 (R18) |
| 3.2 | High | fetch and XHR already in progress at sealing were not assessed, and the policy does not cancel them | fetch and XHR tracked from load; any in progress at sealing makes answers "not supported"; quiescence requirement documented for requests started before NEVERHELD loaded (R20; browser scenario `/inflight`) |
| 3.3 | Medium | The Connection-Allowlist HEAD check was worded as if the protection were active | Reworded as an unverified indication; it does not confirm the document response, the value or enforcement (R19) |
| 3.4 | Medium | Only speculation rules and prerender hints were removed at sealing | All existing hints are removed at sealing (preconnect, dns-prefetch, preload, modulepreload, prefetch, prerender, speculation rules); it is documented that a hint that already ran may have opened a connection (R21) |
| 3.5 | Housekeeping | Findings and PR description out of date | Round 3 recorded here; PR description updated at merge |

Final position: this is an engineering release candidate with honest, bounded evidence. It is not an audited security product.
