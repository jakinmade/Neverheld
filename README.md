# NEVERHELD

**Proof your app never held the data. Not one packet escaped.**

NEVERHELD is a browser-side enforcement and evidence kit. It applies a restrictive Content Security Policy, tests that the browser refuses a connection before protected work begins, records per-session observations, derives deterministic Control Answers and provides an offline verifier.

## One-script installation

With Node.js 22, run `npm install` and `npm run build`. Serve `public/neverheld/neverheld.min.js` from your application, then place this tag after the application's required scripts and before protected customer data is opened:

```html
<script src="/neverheld/neverheld.min.js" data-auto-seal></script>
```

The browser page seals automatically, runs its self-test and displays a NOPE/request counter. A failed self-test leaves the page blocked. Runtime has no package dependencies.

Optional data attributes: `data-application`, `data-version`, `data-commit`, `data-release-id`, `data-release-manifest-url`. Worker evidence defaults to not declared. A `data-workers-network="configured"` declaration is supplied by the host application and is not an independent worker test.

The API is exposed as `window.Neverheld` for app-specific preparation, worker evidence and file fingerprints.

## Important
The proof is written by the page and is not a signed session record. Its hash and recomputed Control Answers show internal consistency, not that a session happened. A signed release authenticates released files, not session events. See `docs/SECURITY-BOUNDARIES.md` and `docs/PROOF-FORMAT.md`.

Run `npm run check` for typecheck, tests and build-size validation. Never reuse EXEVVIA's release signing key; the public-key file is a placeholder pending a separate NEVERHELD keypair.
