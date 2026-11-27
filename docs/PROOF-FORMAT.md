# NEVERHELD proof format (`seal-kit-proof/3`)

```
{ "format": "seal-kit-proof/3", "body": { ... }, "proofHash": { "alg": "SHA-256", "value": hex } }
```
`proofHash` is SHA-256 over the RFC 8785 (JCS) bytes of `body`. Only whole numbers are allowed, so `jq -cjS .body | sha256sum` gives the same hash.

## Body
| Field | Meaning |
|---|---|
| `application` | name, version, commit (from the host) |
| `release` | `id`, `manifestSha256` (hash of the manifest bytes served before sealing, or null), `manifestFiles` |
| `seal.state`, `seal.sealedAt`, `seal.selfTest` | always `sealed` / ISO time / `refused` (no proof can be built otherwise) |
| `seal.policy` | exact CSP text enforced |
| `seal.pageRequestsSinceSealing` | the NOPE count |
| `seal.blockedAttemptsSinceSealing` | attempts the browser refused |
| `seal.serviceWorker` | `none`, `registered`, `controlling` or `not-available` |
| `seal.workers` | `{ declaration: none / blocked / not-declared, description, startedBeforeSeal, startedAfterSeal }` |
| `seal.connectionsOpenAtSeal` | WebSocket, EventSource, WebRTC or WebTransport connections opened after NEVERHELD loaded and still open at sealing |
| `seal.pageGuardBlockedSinceSealing` | WebRTC, WebTransport, speculation or connection-hint attempts blocked or removed by the page (page-level, not browser-enforced) |
| `seal.connectionAllowlist` | `present`, `absent` or `not-checked` (header presence only; never tested) |
| `filesRecording` | `observed-and-host` (inputs and drops watched) or `host-only` |
| `files[]` | `{ name, sha256, source: file-input / drop / host, openedAfterSeal }` |
| `controlAnswers` | ruleset id, version 3.0.0, fingerprint, six answers; each `result` is `supported`, `supported-if-declaration-holds` or `not-supported` |
| `limits[]`, `createdAt`, `format`, `nature` | |

Changes from `/2`: the three `seal.connection…` and `seal.pageGuardBlockedSinceSealing` fields; the sealing time is now the moment the policy goes in (the enforcement boundary); `openedAfterSeal` compares the file's opening time with it; and the third result value was added.

Changes from `/1`: `seal.workersNetwork` was replaced by `seal.workers` (an object) plus `seal.serviceWorker`; `filesRecording` was added, and each file gains `source` and `openedAfterSeal`.

## Control Answer conditions (all must hold for "supported")
sealed; self-test refused; policy refuses every address; NOPE count 0; no service worker registered or in control; workers declared `none` (and none seen starting before the seal) or declared `blocked`; no file opened before sealing; no connection still open at sealing. If all hold and workers were declared `blocked` (untested), the result is `supported-if-declaration-holds`.

## Four assurance levels: never collapse them
1. **Proof self-consistency.** The hash matches, and the Control Answers follow from the evidence. A deliberate editor can recompute both.
2. **Signed release.** With `release-seal.json` and the published key: the release named is genuine, and its file list is the signed one.
3. **Independent timestamp.** An RFC 3161 token, validated only by `tools/coldcheck-release.sh <seal> <key> <tsa-ca.pem>`. The browser verifier reports it as "not verified".
4. **Session attestation.** Not provided.

## Tools
- `node tools/neverheld-render-proof.cjs proof.json https://host/verify.html out.zip`: in the release archive, makes the ZIP with the JSON, a readable page with a QR code, the offline verifier and instructions. It needs no npm install.
- `npm run verify:proof -- proof.json [release-seal.json] [release-manifest.json]`: full check, prints the four levels.
- `scripts/coldcheck-proof.sh proof.json`: hash only (jq and sha256sum).
- `scripts/coldcheck-release.sh release-seal.json [public_key_b64] [tsa-ca.pem]`: signature, signed time, optional RFC 3161 (jq, sha256sum, openssl).
