# Release-readiness checklist

Status at 27 Nov 2026 (branch `build/phase-1-core-extraction`). ✅ done and tested · ⏳ waiting on CI · 🔒 John's decision · ⚖️ counsel or auditor

## Engineering
| Item | Status |
|---|---|
| Independent code review with severity-ranked findings | ✅ `docs/REVIEW-FINDINGS.md` |
| Service worker and pre-seal worker gaps detected, failing closed | ✅ R1, R2 |
| File fingerprints in the one-tag path; honest wording when none | ✅ R4, R5 |
| One-tag waits for `load`; Next.js integration with no other code change | ✅ Chromium locally; ⏳ Firefox and WebKit in CI |
| Plain HTML scenarios in Chromium, Firefox and WebKit | ✅ Chromium; ⏳ Firefox and WebKit in CI |
| Verifier separates four assurance levels | ✅ R6 |
| Verifier CSP well-formed | ✅ R7 |
| QR versus offline wording honest; hosted verifier must be HTTPS | ✅ |
| Runtime under 15 KB gzip, no runtime dependencies | ✅ about 11 KB |
| Lockfile, `npm ci`, pinned actions | ✅ |
| Release archive, manifest, SHA256SUMS, types, docs; no build step for buyers | ✅ `npm run package` |
| Two clean builds give a byte-identical archive | ✅ `npm run repro:check` |
| Release signing and RFC 3161 mechanics (ephemeral key, local test TSA) | ✅ `tests/release.test.ts` |
| Self-contained demo host | ✅ `examples/nextjs-app` plus the plain HTML example |

## Before the first signed release
| Item | Status |
|---|---|
| Generate the dedicated NEVERHELD Ed25519 key offline; store it outside GitHub; publish the public key in `release/release-public-key.json`; agree rotation | 🔒 |
| Choose an independent TSA (for example a commercial TSA, or FreeTSA for a pilot) and keep its CA certificate with the release | 🔒 |
| Decide whether `declared-blocked` workers may yield "supported" (currently yes, with untested wording) | 🔒 ⚖️ |
| Name, domain and trademark check for "NEVERHELD" | 🔒 |
| Merge PR #1 | 🔒 (not done by Claude) |

## Commercial and legal
| Item | Status |
|---|---|
| `LICENSE` is "all rights reserved", granting no use: replace with a pilot or evaluation licence and an embedding licence | ⚖️ |
| Source provenance: EXEVVIA v1.0.29 extraction (`17d4e4f`) is John's own code; confirm no third-party code in the runtime (none found: the runtime bundles only repo source) | 🔒 confirm |
| Third-party licences: dev and build tools only (esbuild, TypeScript, tsx, Playwright: Apache-2.0 or MIT; jszip: MIT or GPL-3.0 dual, used only in the optional Node renderer; qrcode-generator: MIT). None ship in `neverheld.min.js` | ✅ reviewed from `package.json` (run a licence scanner before sale) |
| AI-assisted development disclosure | ✅ `docs/AI-DEVELOPMENT-DISCLOSURE.md` |
| US privacy counsel review of the six Control Answer wordings (ruleset 2.0.0) | ⚖️ |
| Independent security testing quote | ⚖️ |
| Pilot fee agreed before outreach | 🔒 |
