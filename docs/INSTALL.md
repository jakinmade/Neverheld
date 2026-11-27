# Installing NEVERHELD

You need no build step and no package install. Copy two files from the release archive into your site:

- `neverheld.min.js`: the one-file runtime (about 11 KB gzip, no dependencies)
- `verify.html`: the self-contained offline verifier (optional on your site; customers can use their own copy)

Check the archive first: `sha256sum -c SHA256SUMS`, and, once releases are signed, `tools/coldcheck-release.sh release-seal.json`.

## One tag

```html
<script src="/neverheld/neverheld.min.js" data-auto-seal
        data-application="Your app" data-version="1.4.2" data-commit="abc123"
        data-workers-network="none"></script>
```

Put it at the end of `<body>`. The tag:
1. shows a blocking dialog straight away ("do not open customer data yet");
2. waits for the page's `load` event, so everything the page asked for while loading arrives first;
3. seals, runs the self-test, and records whether a service worker is present;
4. removes the dialog and shows the NOPE counter and "Proof and checks". If the browser does not enforce the seal, the dialog stays and the page remains blocked.

| Attribute | Meaning |
|---|---|
| `data-auto-seal` | Required for the automatic install |
| `data-application`, `data-version`, `data-commit` | Written into the proof |
| `data-release-id`, `data-release-manifest-url` | Release identity; the manifest is fetched before sealing |
| `data-workers-network` | Your declaration: `none` (this page starts no workers) or `blocked` (your workers are served with their own CSP refusing network access). Omitted means `not-declared`, and every Control Answer is "not supported" |
| `data-workers-description` | Free text explaining your declaration |
| `data-observe-files="off"` | Stop fingerprinting files from file inputs and drops |

## Things that must be true for a clean proof
- Everything the app needs is loaded by the `load` event. Lazy chunks, late fonts and analytics loaded afterwards are refused (they show as "blocked attempts").
- No service worker is registered for the page's scope. If your app uses one, the answers will be "not supported", by design.
- Workers are either not used, or started from `blob:` after sealing, or served with their own blocking policy and declared as `blocked`.

## Next.js
Add the tag at the end of `<body>` in `app/layout.tsx`, as shown in `examples/nextjs-app/app/layout.tsx`. No other change is needed. This is tested in CI in Chromium, Firefox and WebKit. Do not use `next/script` with `lazyOnload`: the tag must be in the server-rendered HTML.

## Plain HTML
See `examples/plain-html/example.html`.
