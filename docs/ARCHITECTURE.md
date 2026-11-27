# Architecture

- `seal.ts`: restrictive browser CSP, self-test, page request counter and status subscriptions.
- `proof.ts`: canonical proof, evidence extraction and offline proof/release verification.
- `control-answers.ts`: deterministic six-pack ruleset and fingerprint.
- `jcs.ts`: RFC 8785 canonicalisation, SHA-256 and Ed25519 verification.
- `files.ts`: file fingerprints from file inputs, drops and host calls; records whether each was opened after sealing.
- `script-tag.ts`: browser global and opt-in automatic one-tag install.
- `verifier-page.ts`: source for the self-contained offline verifier.
- `scripts/build-kit.mjs`: builds the minified browser runtime, verifier and example page.

The automatic one-tag profile starts watching workers and file inputs when it loads, waits for the page `load` event, then seals. Workers started before it loaded cannot be seen, so worker evidence also needs the owner's declaration (`data-workers-network`), which is recorded as a declaration and never as a test. The integrated profile must load all required assets and workers before calling `sealPage(prepare)`, and separately enforce/test each worker's network policy.

Release tooling: `scripts/package-release.mjs` (archive, manifest, SHA256SUMS, types), `scripts/repro-check.mjs`, `scripts/sign-release.mjs` (format 2 release seal plus an RFC 3161 request and attachment) and `scripts/coldcheck-release.sh` (offline check, including the TSA token against a supplied CA).
