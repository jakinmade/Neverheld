# Architecture

- `seal.ts`: restrictive browser CSP, self-test, page request counter and status subscriptions.
- `proof.ts`: canonical proof, evidence extraction and offline proof/release verification.
- `control-answers.ts`: deterministic six-pack ruleset and fingerprint.
- `jcs.ts`: RFC 8785 canonicalisation, SHA-256 and Ed25519 verification.
- `script-tag.ts`: browser global and opt-in automatic one-tag install.
- `verifier-page.ts`: source for the self-contained offline verifier.
- `scripts/build-kit.mjs`: builds the minified browser runtime, verifier and example page.

The automatic one-tag profile seals immediately and cannot prepare or inspect application workers. It therefore defaults worker evidence to `not-declared`. The integrated profile must load all required assets and workers before calling `sealPage(prepare)`, and separately enforce/test each worker's network policy.
