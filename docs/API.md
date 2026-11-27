# NEVERHELD API (`window.Neverheld`)

Types ship in `types/` in the release archive.

## Sealing
- `sealPage(prepare?, options?)`: loads what `prepare` needs, seals, self-tests. Rejects if the browser does not enforce it; do not open data then.
- `getSealStatus()`: `{ state, requests, blocked, log, workersStartedBeforeSeal, workersStartedAfterSeal, serviceWorker, policy, sealedAtEpoch, ... }`
- `subscribeToSeal(listener)`: returns an unsubscribe function.
- `observeWorkers()`: count workers started from now on (the one-tag install calls this when it loads).
- `observeConnections()`: track WebSocket, EventSource, WebRTC and WebTransport connections from now on, and block WebRTC and WebTransport in the page once sealed (page-level).
- `checkConnectionAllowlist()`: one request before sealing; records whether the page is served with a `Connection-Allowlist` header.
- `canRetrySeal()`, `resetFailedSeal()`
- `sealPolicy(options)`: the exact CSP text.

## Files
- `observeFileInputs()`: fingerprint files chosen in `<input type=file>` or dropped on the page.
- `recordFile(blob, { openedAt?, source? })`: record a file your app opened by other means. `openedAt` is the `performance.now()` time you opened it; omit it only when calling at that moment.
- `recordFingerprint(name, sha256hex, { openedAt })`: record a fingerprint you computed. `openedAt` is required, because hashing can finish long after opening.
- `openedAfterSeal` is worked out when the proof is written, by comparing `openedAt` with the moment the seal took effect.
- `recordedFiles()`: `Promise<FileRecord[]>`, each `{ name, sha256, source, openedAfterSeal }`.

## Proofs
- `buildProof({ status, files, observedFiles, application, release, workers: { declaration, description } })`
- `proofJson(proof)`: canonical bytes.
- `verifyProof(proof, { releaseSeal?, publicKeyB64?, manifestText? })`: returns `{ valid, checks, assurance }`.
  `assurance` keeps four questions apart: `proofConsistent`, `release` (`authentic` | `not-checked` | `failed`), `independentTimestamp` (`not-verified` in the browser; use the cold check) and `sessionAttestation` (always `not-provided`).
- Each Control Answer's `result` is `supported`, `supported-if-declaration-holds` (all observed conditions held, but the answer also rests on the owner's untested worker declaration) or `not-supported`.
- `controlAnswers(evidence)`, `CONTROL_RULESET`, `rulesetFingerprint()`

## Integrated profile (without `data-auto-seal`)
```js
Neverheld.observeWorkers(); Neverheld.observeFileInputs();
await Neverheld.sealPage(async () => { /* load everything the session needs */ });
const proof = await Neverheld.buildProof({ status: Neverheld.getSealStatus(), files: await Neverheld.recordedFiles(),
  observedFiles: true, application, release, workers: { declaration: "none", description: "No workers" } });
```
