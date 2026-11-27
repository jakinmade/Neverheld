# NEVERHELD

**Browser-side enforcement and evidence for sensitive-data workflows.**

NEVERHELD is being developed as a standalone, licensable browser SDK/software kit. A buyer embeds the prebuilt one-file runtime in its own web application. NEVERHELD does not depend on EXEVVIA at runtime; EXEVVIA may be used as a live reference/demo.

## One-script installation

The delivered browser file is built and published as `public/neverheld/neverheld.min.js`. Add it after required application resources have loaded and before protected customer data is opened:

```html
<script src="/neverheld/neverheld.min.js" data-auto-seal></script>
```

The browser page applies its policy, runs a self-test and displays a NOPE/request counter. If the browser does not confirm enforcement, the page remains blocked. The delivered browser runtime has no runtime package dependencies; the buyer should not need to build this repository to install the released file.

Optional data attributes include `data-application`, `data-version`, `data-commit`, `data-release-id` and `data-release-manifest-url`. Worker evidence defaults to not declared. A host declaration is not an independent worker test.

## Proof and verification

The runtime downloads JSON and readable HTML. The separate Node-side renderer packages the JSON proof, readable HTML with QR and an offline verifier into a ZIP:

```sh
npm run render:proof -- proof.json https://your-host/neverheld/verify.html NEVERHELD-proof.zip
```

The QR currently opens a hosted verifier URL with the proof hash pre-filled; the ZIP also includes the verifier HTML for a fully offline, manual file-selection check. Use `npm run verify:proof -- proof.json` for the CLI proof check and `npm run coldcheck:proof -- proof.json` for the hash-only cold check.

## Security boundary

The proof is written by the page and is not a signed session attestation. Its hash and recomputed Control Answers show internal consistency, not that a session happened. A signed release authenticates released files, not session events. The seal is page-level browser enforcement after it takes effect; it does not automatically govern workers, existing frames, extensions, other tabs, whole-tab navigation or activity before sealing.

See `docs/SECURITY-BOUNDARIES.md`, `docs/PROOF-FORMAT.md`, `docs/CLAUDE-HANDOVER.md` and `docs/STANDALONE-SALE-READINESS.md`.

## Development

Run `npm run check` for TypeScript, unit, Chromium browser, build and compressed-size checks. Latest verified runtime size: 9,216 bytes gzip, under the 15 KB target.

The published public-key file is still a placeholder pending a dedicated NEVERHELD release keypair. Never reuse another product's signing key.
