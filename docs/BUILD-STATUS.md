# Build status — initial extraction

Date: 27 November 2026. Working branch: `build/phase-1-core-extraction`.

Source baseline: EXEVVIA `main`, commit `17d4e4f90857eb63cf528f92567f8bd3322516e0` (v1.0.29). The core seal, proof, Control Answers, JCS and verifier modules are extracted into this independent repository. EXEVVIA is not changed.

## In this phase
- Independent TypeScript package and build.
- Dependency-free browser bundle.
- Opt-in `data-auto-seal` script-tag installation with a status/NOPE display.
- Self-contained offline proof verifier and plain HTML example.
- Tests for restrictive policy, deterministic six-pack answers, worker evidence fail-closed behaviour, proof tamper detection and bundle size.
- Explicit security boundary documentation.

## Not yet complete
- One-tag mode cannot inspect or test application workers, service workers, existing frames or other contexts; worker evidence defaults to not declared.
- One-tag mode has no file fingerprints unless the host uses the API.
- PDF/QR output is not part of the small browser runtime; current output is JSON and readable HTML. A separate proof-rendering adapter remains to be added.
- The public-key file is a placeholder. No NEVERHELD signing key exists yet. Do not make a signed-release claim until a dedicated keypair is created and the private key is stored as a GitHub Actions secret.
- Browser verifier does not validate an RFC 3161 trust chain.
- No independent security audit or US counsel wording review has been completed.
- Not merged, deployed or integrated back into EXEVVIA.

## Release gates
1. Typecheck, tests and reproducible build pass; gzip below 15 KB.
2. Real-browser tests on supported browsers, including offline and worker workflows.
3. Independent security review with no unresolved high/critical findings.
4. Dedicated signing key, public key publication and key-rotation procedure.
5. Counsel review of US Control Answers wording.
6. Pinned integration into EXEVVIA with regression tests.
