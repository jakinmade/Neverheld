# Build status — standalone product baseline

NEVERHELD is being developed as a standalone, licensable browser SDK/software product. It must be distributable and usable without EXEVVIA. EXEVVIA is the live reference/demo, not a runtime dependency.

The initial core extraction used EXEVVIA v1.0.29, commit `17d4e4f90857eb63cf528f92567f8bd3322516e0`. Verify code provenance/comments against that precise baseline.

## Implemented in current branch

- Independent TypeScript seal/proof/Control Answer/JCS source.
- One-file browser runtime exposed as `window.Neverheld`.
- Opt-in one-tag install, fail-closed self-test, page request and CSP-blocked-attempt counters.
- Canonical JSON proof and six deterministic Control Answer packs.
- Readable HTML proof and separate QR/ZIP renderer with offline verifier file.
- CLI proof verifier and proof/release cold-check scripts.
- Plain HTML example, Next.js integration notes, documentation and pinned CI.
- Chromium browser test.

## Latest confirmed CI baseline

Pinned-actions workflow: https://github.com/jakinmade/Neverheld/actions/runs/46070302669

TypeScript passed; 10 automated tests passed; Chromium browser checks passed. Runtime: 24,248 bytes minified / 9,216 bytes gzip, under the 15 KB target.

## Known differences / outstanding items against v0.5

- One-tag proofs currently contain no file fingerprints. API callers can supply fingerprints.
- Worker evidence defaults to `not-declared`; a host-set `configured` attribute is a declaration, not an independent worker test. The Control Answer wording references a live worker seal check that is not yet implemented.
- The QR currently points to a hosted verifier URL; the ZIP separately contains an offline verifier HTML file.
- No dedicated NEVERHELD release keypair, populated public key, release manifest/signing workflow, reproducible double-build or trusted RFC 3161 timestamp validation.
- Browser automation is Chromium-only; no real Next.js fixture or Firefox/WebKit coverage yet.
- No production standalone distribution archive or committed lockfile verified yet.
- PDF proof renderer remains optional/outstanding; current outputs are JSON, readable HTML and a QR/ZIP proof pack.
- No independent security audit or US counsel review has been completed.
- Commercial licence/ownership/provenance and third-party dependency review remains to be completed.

## Scope

Do not remove `unsafe-inline` in phase 1; v0.5 intentionally deferred that policy tightening. WAICT compatibility and additional control packs are phase 2. Do not modify EXEVVIA as part of standalone development unless separately requested. Its role is reference demonstration only, not runtime dependency.

See `docs/CLAUDE-HANDOVER.md` and `docs/STANDALONE-SALE-READINESS.md`.
