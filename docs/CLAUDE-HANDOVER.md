# NEVERHELD — Claude handover brief

**Purpose:** independent technical review and completion of NEVERHELD as a standalone, licensable browser SDK/software product.

**Repository:** `jakinmade/Neverheld`  
**Working branch:** `build/phase-1-core-extraction`  
**Pull request:** https://github.com/jakinmade/Neverheld/pull/1  
**Default branch:** `main`  
**Source extraction baseline:** EXEVVIA v1.0.29, commit `17d4e4f90857eb63cf528f92567f8bd3322516e0`  
**Last fully verified code/CI head before this handover document:** `1e2440f8cc02de478c4ae7ef77c3f5e00eb3a3c3`

## 1. Product objective

NEVERHELD is to be sold and licensed as a standalone software product: a small, embeddable browser-side enforcement and evidence kit. A buyer must be able to install, use, test, build and maintain it without access to EXEVVIA or any EXEVVIA service.

The intended offer is not a hosted SaaS dependency. It is a distributable SDK/browser kit with a one-script-tag install, direct API, canonical proof, named Control Answers, and offline verification. Commercial routes in the product spec include a paid pilot, an embedding licence/white-label deal, or an outright IP sale.

**EXEVVIA is a useful live reference/demo and provenance source, not a runtime dependency or a condition of NEVERHELD being independently saleable.** Do not change EXEVVIA as part of this review unless John separately asks for that work.

The source-of-truth product specification is `NEVERHELD-US-Spec-v0.5(1).docx`, supplied in this conversation. Review against that document, not just the current README.

## 2. Current implementation and verified state

The initial extraction branch currently contains:

- Independent TypeScript seal/proof/Control Answer/JCS source.
- One-file browser build exposed as `window.Neverheld`.
- Opt-in `data-auto-seal` installation and fail-closed self-test modal.
- Page request and CSP-blocked-attempt counters.
- Canonical JSON proof and readable HTML proof.
- Six deterministic Control Answer packs: HIPAA business associate, Washington MHMDA, SOC 2 Confidentiality, SIG/CAIQ-style vendor data access, ABA Model Rule 1.6 / Formal Opinion 512, and FTC Section 5.
- Self-contained offline verifier source.
- Optional QR/readable/offline-verifier ZIP renderer.
- CLI proof verifier and proof/release cold-check scripts.
- Plain HTML example and a Next.js integration note.
- Pinned GitHub Actions checks and a Chromium Playwright test.

Latest confirmed workflow on the pinned-actions code head:

https://github.com/jakinmade/Neverheld/actions/runs/46070302669

Verified there: TypeScript passed; 10 unit/CLI/package tests passed; Chromium end-to-end checks passed; browser bundle 24,248 bytes minified / 9,216 bytes gzip, under the 15 KB gzip limit.

This is a **working extraction baseline**, not a production security certification or a completed commercial release.

## 3. High-priority review findings to investigate

These are questions/findings for independent validation. Confirm them from code and add tests before changing implementation.

### A. Worker evidence is not independently established

- The generic one-tag installation sets worker evidence to `not-declared`.
- The Control Answer ruleset requires `workersNetwork === "configured"`; without it, all six answers become `not-supported`.
- The host can supply `data-workers-network="configured"`, but that is a host declaration, not a test.
- Current Control Answer wording says the release's live seal check tests workers, but a NEVERHELD release/live-check workflow has not yet been implemented.

Decide how the product distinguishes: no workers used, workers independently configured/tested, and worker coverage unknown. Do not convert a self-declaration into verified evidence. Remove or qualify any assertion that a live check has tested workers until that check exists.

### B. File fingerprints are absent from the one-tag path

- The one-tag `buildProof` call currently supplies `files: []`.
- The host can supply fingerprints through the API, but the generic install does not obtain them.
- The session evidence template says the supplied number of files “were processed inside the browser tab”; with an empty list this can read as “0 files were processed” even when the app may have processed files.

Do not claim that every processed file is fingerprinted unless the kit can establish that. Decide whether v1 requires a host callback/API, a safe supported file-input observation mechanism, or an explicitly limited proof. Make unsupported/missing evidence clear in Control Answers.

### C. QR versus genuinely offline verification

- The QR renderer currently encodes a hosted verifier URL with the proof hash pre-filled.
- The ZIP separately includes an offline verifier HTML file and JSON proof.
- Therefore the QR scan itself requires the hosted verifier to be reachable; the ZIP is what enables a fully disconnected local check.

The spec describes a QR that opens the offline verifier. Resolve this honestly in the UX and docs. Test both the connected QR flow and disconnected file-based verifier flow; do not label a hosted URL as offline.

### D. Release Seal is not yet a production release chain

- `release/release-public-key.json` contains an empty public key.
- No NEVERHELD-specific keypair exists; never reuse EXEVVIA's private key.
- A complete release manifest generator, reproducible double-build check, Ed25519 release-signing workflow, key storage/rotation and public timestamp publication are not yet present.
- Current cold-check tests use an ephemeral test key. That validates the script mechanics, not a published product identity.
- Current cold check validates the signed self-asserted release timestamp; it does not validate an independent RFC 3161 TSA trust chain.

Implement and test the full release lifecycle before marketing signed release verification as available.

### E. Browser/framework coverage is too narrow

- CI currently exercises Chromium.
- The plain HTML browser test does not prove a real Next.js app integration.
- The spec requires plain HTML and Next.js integration, and describes portability across modern browsers.

Add a genuine minimal Next.js fixture and test Chromium, Firefox and WebKit where supported. Exercise fetch, XHR, beacon, WebSocket, forms, images/scripts/styles/fonts, worker creation, dynamic imports, navigation, existing CSP headers and the disconnected workflow. Separate what is enforceable by page CSP from what needs a worker's own policy. Test unsupported browsers fail closed.

### F. One-tag lifecycle and application compatibility

Review exact placement requirements. The script must be installed after all required resources are loaded and before protected customer data is opened. Verify behaviour if the app has an existing CSP, a restrictive Next.js nonce setup, a base path, no `document.body` at installation, or if an application tries to load network assets after sealing. Keep the v0.5 decision not to remove `unsafe-inline` in phase 1; policy tightening is a phase-2 decision unless the review proves a separate critical issue.

### G. Proof authenticity wording

The proof is written by the page and is not a signed session attestation. A hash stored inside the proof can be recomputed after editing. A signed release authenticates the released files, not that a particular browser session took place.

Ensure the offline verifier clearly distinguishes:
1. proof self-consistency,
2. signed release authenticity,
3. trusted timestamp validation,
4. actual session attestation (not currently provided).

No UI, README, Control Answer or sales language may collapse these into one “verified” claim.

### H. Product packaging and reproducibility

The current repository has a build and CI, but not yet a finished buyer-ready distribution. Check:

- A lockfile and clean `npm ci` reproducibility.
- A versioned distribution archive containing the prebuilt one-file runtime, API/types, verifier, examples, docs, checksums and licence.
- The buyer must not need a build step or external runtime dependency to add the delivered one-script file.
- Build the same commit twice and compare the file manifests byte-for-byte.
- Confirm the npm/package metadata, package entry points, published file list and third-party dependency licences.
- Run the release package from a clean environment without EXEVVIA.

### I. Legal/commercial readiness

- The current `LICENSE` says all rights reserved and grants no use rights; this is not yet a buyer-ready commercial licence.
- Confirm source-code provenance and ownership, including the extracted EXEVVIA code and third-party components.
- Retain a written AI-assisted development/checking disclosure for due diligence.
- Prepare pilot/licence/IP-sale alternatives, support window, maintenance and handover terms.
- NEVERHELD name/domain/trademark checks are still a John decision.
- Obtain a US privacy lawyer review of the six Control Answer wordings before outreach.
- Obtain an independent security audit quote; no independent audit has been completed.

## 4. Required review approach

1. Start by reading this brief and the v0.5 specification in full.
2. Inspect the repository at the current PR head; do not assume the summary above proves every implementation detail.
3. Produce an independent findings report first: severity, exact file/line, impact, reproducible test and proposed fix.
4. Do not weaken or delete existing acceptance tests to get a green build.
5. Fix confirmed issues in small commits on `build/phase-1-core-extraction`; add regression tests for every correction.
6. Keep the browser runtime under 15 KB gzip and free of runtime dependencies.
7. Run all unit, CLI, renderer, cold-check, plain HTML, Next.js and browser-matrix tests from a clean install.
8. Preserve a clear distinction between page-level CSP evidence, worker evidence, file fingerprints, release authenticity and session authenticity.
9. Keep phase-2 work out of scope: do not remove `unsafe-inline` or add WAICT features unless specifically requested.
10. Do not merge the PR, deploy, generate/commit a release private key, or change EXEVVIA. Report what is complete and what remains for John to decide.

## 5. Deliverables expected from Claude

- Independent code/security review with severity-ranked findings.
- Corrected source and automated regression tests for confirmed findings.
- Fresh clean-install CI results and a reproducible build report.
- A standalone distribution archive suitable for independent review.
- A simple self-contained demo host application; EXEVVIA may remain the live reference demo but is not a runtime dependency.
- Updated architecture, installation, API, proof-format and limitations documentation.
- A release-readiness checklist distinguishing completed, blocked and counsel/audit-owned tasks.

**Do not describe NEVERHELD as production-ready, independently audited, HIPAA compliant, or as proving that no packet ever left every browser context. The claim must remain limited to what the tested enforcement and evidence actually establish.**
