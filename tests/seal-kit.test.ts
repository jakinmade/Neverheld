import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { gzipSync } from "node:zlib";
import {
  buildProof, canonicalJson, controlAnswers, evidenceFromBody, proofJson, sealPolicy, verifyProof,
  CONTROL_RULESET, PROOF_LIMITS, SEAL_KIT_VERSION, type SealStatus,
} from "../lib/seal-kit";

const status = (change: Partial<SealStatus> = {}): SealStatus => ({
  state: "sealed", sealedAt: 1000, sealedAtEpoch: Date.UTC(2026, 10, 27, 18),
  sealedAtTime: "18:00", policy: sealPolicy(), requests: 0, blocked: 0, log: [],
  workersStartedBeforeSeal: 0, workersStartedAfterSeal: 0, serviceWorker: "none",
  connectionsOpenAtSeal: 0, guardBlocked: 0, connectionAllowlist: "not-checked", ...change,
});
const files = [{ name: "sample.pdf", sha256: "a".repeat(64), source: "host" as const, openedAfterSeal: true }];
const application = { name: "test", version: "0.1.0", commit: "test" };
const release = { id: "test-release", manifestSha256: "b".repeat(64), manifestFiles: 2 };
const workers = { declaration: "none" as const, description: "Worker restrictions declared for test only." };

test("production seal policy permits no network address", () => {
  const policy = sealPolicy();
  const directives = policy.split(";").map((part) => part.trim().split(/\s+/));
  assert.deepEqual(directives.find(([name]) => name === "default-src"), ["default-src", "'none'"]);
  assert.deepEqual(directives.find(([name]) => name === "connect-src"), ["connect-src", "'none'"]);
  assert.deepEqual(directives.find(([name]) => name === "form-action"), ["form-action", "'none'"]);
  for (const [name, ...sources] of directives) {
    assert.ok(!sources.includes("'self'"), name);
    assert.ok(!sources.some((source) => /^https?:|^wss?:|^\*|localhost|127\.0\.0\.1|\[::1\]/i.test(source)), name);
  }
});

test("six Control Answers are deterministic", async () => {
  const proof = await buildProof({ status: status(), files, application, release, workers });
  const evidence = evidenceFromBody({ seal: proof.body.seal, files });
  const first = JSON.stringify(await controlAnswers(evidence));
  for (let i = 0; i < 100; i += 1) assert.equal(JSON.stringify(await controlAnswers(evidence)), first);
  const answers = await controlAnswers(evidence);
  assert.equal(answers.answers.length, 6);
  assert.deepEqual(answers.answers.map((item) => item.pack), CONTROL_RULESET.packs.map((pack) => pack.id));
  assert.ok(answers.answers.every((item) => item.result === "supported"));
});

test("worker evidence not declared fails closed", async () => {
  const proof = await buildProof({
    status: status(), files, application, release,
    workers: { declaration: "not-declared", description: "No worker evidence." },
  });
  assert.ok(proof.body.controlAnswers.answers.every((item) => item.result === "not-supported"));
});

test("proof verifies offline and tampering fails", async () => {
  const proof = await buildProof({ status: status(), files, application, release, workers });
  const parsed = JSON.parse(proofJson(proof));
  assert.equal((await verifyProof(parsed)).valid, true);
  parsed.body.seal.pageRequestsSinceSealing = 1;
  assert.equal((await verifyProof(parsed)).valid, false);
});

test("one observed page request makes Control Answers unsupported", async () => {
  const proof = await buildProof({ status: status({ requests: 1 }), files, application, release, workers });
  assert.ok(proof.body.controlAnswers.answers.every((item) => item.result === "not-supported"));
  assert.equal((await verifyProof(JSON.parse(proofJson(proof)))).checks.some((item) => item.name === "No page request after sealing" && !item.ok), true);
});

test("standalone bundle builds under 15 KB gzip", () => {
  const build = spawnSync(process.execPath, ["scripts/build-kit.mjs"], { encoding: "utf8" });
  assert.equal(build.status, 0, (build.stdout || "") + (build.stderr || ""));
  const bundle = readFileSync("public/neverheld/neverheld.min.js");
  assert.ok(gzipSync(bundle, { level: 9 }).length < 15 * 1024);
  assert.match(bundle.toString(), /NOPE/);
  assert.match(bundle.toString(), /Neverheld/);
});

test("kit version", () => assert.equal(SEAL_KIT_VERSION, "0.3.0"));

// --- Round 2: regression tests for the second independent review (docs/REVIEW-FINDINGS.md) ---

test("R10 wording never claims the browser refused every network route", async () => {
  const proof = await buildProof({ status: status(), files, application, release, workers });
  const text = JSON.stringify(proof.body.controlAnswers);
  assert.doesNotMatch(text, /sent nothing by network connection or resource request/);
  assert.doesNotMatch(text, /network connections and resource requests[^"]*refused by the browser/);
  assert.match(text, /not enforced by the browser/);
  assert.match(text, /WebRTC, DNS lookups and connection hints, which the Content Security Policy does not govern/);
  assert.match(JSON.stringify(PROOF_LIMITS), /Connection-Allowlist/);
  spawnSync(process.execPath, ["scripts/build-kit.mjs"], { encoding: "utf8" });
  assert.doesNotMatch(readFileSync("public/neverheld/neverheld.min.js", "utf8"), /Not one packet escaped/i);
});

test("R11 a connection still open at sealing makes every answer unsupported", async () => {
  const proof = await buildProof({ status: status({ connectionsOpenAtSeal: 1 }), files, application, release, workers });
  assert.ok(proof.body.controlAnswers.answers.every((item) => item.result === "not-supported"));
  assert.match(proof.body.controlAnswers.answers[0].answer, /still open/);
});

test("R12 page-level blocks are reported, and the Connection-Allowlist state is stated", async () => {
  const proof = await buildProof({ status: status({ guardBlocked: 2, connectionAllowlist: "present" }), files, application, release, workers });
  assert.ok(proof.body.controlAnswers.answers.every((item) => item.result === "supported"));
  assert.match(proof.body.controlAnswers.answers[0].answer, /blocked or removed, inside the page, 2 WebRTC/);
  assert.match(proof.body.controlAnswers.answers[0].answer, /Connection-Allowlist header[^.]*; this session did not test that header/);
});

test("R13 a declared-blocked worker gives 'supported-if-declaration-holds', never plain 'supported'", async () => {
  const proof = await buildProof({ status: status(), files, application, release, workers: { declaration: "blocked", description: "declared" } });
  assert.ok(proof.body.controlAnswers.answers.every((item) => item.result === "supported-if-declaration-holds"));
  assert.ok(proof.body.controlAnswers.answers.every((item) => item.answer.endsWith("this session did not test it.")));
  assert.equal((await verifyProof(JSON.parse(proofJson(proof)))).assurance.proofConsistent, true);
  const edited = JSON.parse(proofJson(proof));
  edited.body.controlAnswers.answers[0].result = "supported";
  assert.equal((await verifyProof(edited)).valid, false, "upgrading the result by hand is detected");
});

// --- Regression tests for the Nov 2026 independent review (docs/REVIEW-FINDINGS.md) ---

test("R1 a registered or controlling service worker makes every Control Answer unsupported", async () => {
  for (const serviceWorker of ["registered", "controlling"] as const) {
    const proof = await buildProof({ status: status({ serviceWorker }), files, application, release, workers });
    assert.ok(proof.body.controlAnswers.answers.every((item) => item.result === "not-supported"), serviceWorker);
    assert.match(proof.body.controlAnswers.answers[0].answer, /service worker/);
  }
  const unknown = await buildProof({ status: status({ serviceWorker: undefined }), files, application, release, workers });
  assert.equal(unknown.body.seal.serviceWorker, "registered", "an unknown service-worker state is recorded as the unsafe value");
});

test("R2 a worker seen starting before the seal contradicts a 'no workers' declaration", async () => {
  const none = { declaration: "none" as const, description: "none" };
  const clean = await buildProof({ status: status(), files, application, release, workers: none });
  assert.ok(clean.body.controlAnswers.answers.every((item) => item.result === "supported"));
  const seen = await buildProof({ status: status({ workersStartedBeforeSeal: 1 }), files, application, release, workers: none });
  assert.ok(seen.body.controlAnswers.answers.every((item) => item.result === "not-supported"));
  assert.equal((await verifyProof(JSON.parse(proofJson(seen)))).assurance.proofConsistent, true);
});

test("R3 worker wording never claims a test that did not happen", async () => {
  const text = JSON.stringify(CONTROL_RULESET);
  assert.doesNotMatch(text, /live seal check does/);
  const proof = await buildProof({ status: status(), files, application, release, workers: { declaration: "blocked", description: "declared" } });
  assert.match(proof.body.controlAnswers.answers[0].answer, /declared[^.]*; this session did not test that declaration/);
});

test("R4 no recorded files is stated as unknown, never as '0 files were processed'", async () => {
  const proof = await buildProof({ status: status(), files: [], application, release, workers });
  const answer = proof.body.controlAnswers.answers[0].answer;
  assert.doesNotMatch(answer, /0 file\(s\) were processed/);
  assert.match(answer, /No file fingerprints were recorded, so this proof does not show which files, if any/);
});

test("R5 a file opened before sealing makes the Control Answers unsupported", async () => {
  const early = [{ ...files[0], openedAfterSeal: false }];
  const proof = await buildProof({ status: status(), files: early, application, release, workers });
  assert.ok(proof.body.controlAnswers.answers.every((item) => item.result === "not-supported"));
});

test("R6 verifier reports four separate assurance levels and never claims session attestation", async () => {
  const proof = JSON.parse(proofJson(await buildProof({ status: status(), files, application, release, workers })));
  const result = await verifyProof(proof);
  assert.deepEqual(result.assurance, { proofConsistent: true, release: "not-checked", independentTimestamp: "not-verified", sessionAttestation: "not-provided" });
  proof.body.application.name = "edited";
  assert.equal((await verifyProof(proof)).assurance.proofConsistent, false);
});

test("R7 built verifier page has a well-formed policy that blocks every address", () => {
  spawnSync(process.execPath, ["scripts/build-kit.mjs"], { encoding: "utf8" });
  const html = readFileSync("public/neverheld/verify.html", "utf8");
  const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
  for (const directive of policy.split(";").map((part) => part.trim()).filter(Boolean)) {
    for (const source of directive.split(/\s+/).slice(1)) {
      assert.match(source, /^('none'|'unsafe-inline'|data:)$/, `malformed or permissive source "${source}" in ${directive}`);
    }
  }
  assert.match(policy, /base-uri 'none'/);
  assert.match(policy, /connect-src 'none'/);
});

test("R8 proof limits do not say the named release is signed when no release seal exists", () => {
  const limits = JSON.stringify(PROOF_LIMITS);
  assert.doesNotMatch(limits, /the release it names is signed, and the verifier checks that/);
  assert.match(limits, /does not show that the session took place/);
});

test("optional proof renderer packages QR, readable proof and offline verifier without changing the browser bundle", async () => {
  const proof = await buildProof({ status: status(), files, application, release, workers });
  const dir = mkdtempSync(join(tmpdir(), "neverheld-render-"));
  const input = join(dir, "proof.json");
  const output = join(dir, "proof.zip");
  try {
    writeFileSync(input, proofJson(proof));
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/render-proof.ts", input, "https://example.test/neverheld/verify.html", output], { encoding: "utf8" });
    assert.equal(run.status, 0, (run.stdout || "") + (run.stderr || ""));
    const zip = await JSZip.loadAsync(readFileSync(output));
    for (const name of ["NEVERHELD-proof.json", "NEVERHELD-proof.html", "NEVERHELD-proof-verifier.html", "HOW-TO-CHECK.txt"]) {
      assert.ok(zip.file(name), name);
    }
    const html = await zip.file("NEVERHELD-proof.html")!.async("string");
    assert.match(html, /<svg/);
    assert.match(html, new RegExp(proof.proofHash.value));
    const bundle = readFileSync("public/neverheld/neverheld.min.js");
    assert.ok(gzipSync(bundle, { level: 9 }).length < 15 * 1024, "the optional renderer must not inflate the core script-tag runtime");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const haveColdTools = ["jq", "sha256sum", "openssl"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0);

test("command-line verifier validates a proof and the hash-only cold check detects edits", async (context) => {
  if (!haveColdTools) context.skip("jq, sha256sum or openssl unavailable");
  const proof = await buildProof({ status: status(), files, application, release, workers });
  const dir = mkdtempSync(join(tmpdir(), "neverheld-cli-"));
  const input = join(dir, "proof.json");
  const changed = join(dir, "changed.json");
  try {
    writeFileSync(input, proofJson(proof));
    const verifier = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-proof.mts", input], { encoding: "utf8" });
    assert.equal(verifier.status, 0, (verifier.stdout || "") + (verifier.stderr || ""));
    assert.match(verifier.stdout, /PROOF VALID/);
    const cold = spawnSync("bash", ["scripts/coldcheck-proof.sh", input], { encoding: "utf8" });
    assert.equal(cold.status, 0, cold.stdout + cold.stderr);
    assert.match(cold.stdout, /hash unchanged/);
    const edited = JSON.parse(proofJson(proof));
    edited.body.seal.pageRequestsSinceSealing = 1;
    writeFileSync(changed, JSON.stringify(edited));
    const tampered = spawnSync("bash", ["scripts/coldcheck-proof.sh", changed], { encoding: "utf8" });
    assert.notEqual(tampered.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release cold check validates an Ed25519 signed record and signed release time", { skip: !haveColdTools && "jq, sha256sum or openssl unavailable" }, () => {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const record = {
    seal_format_version: "2",
    key_id: "test-neverheld-key",
    release: { id: "neverheld-test", manifest_sha256: "b".repeat(64), manifest_files: 3 },
  };
  const hash = createHash("sha256").update(canonicalJson(record)).digest("hex");
  const stamp = { type: "self-asserted", content_hash: hash, time: "2026-11-27T21:00:00Z", key_id: record.key_id };
  const seal = {
    seal_format_version: "2",
    canonicalization: "RFC 8785 (JCS)",
    record,
    content_hash: { alg: "SHA-256", value: hash },
    signature: {
      alg: "Ed25519", key_id: record.key_id, signed_message: "content_hash.value (ASCII hex)",
      value_b64: sign(null, Buffer.from(hash, "ascii"), pair.privateKey).toString("base64"),
    },
    timestamps: [{
      ...stamp,
      signature_b64: sign(null, Buffer.from(canonicalJson(stamp)), pair.privateKey).toString("base64"),
    }],
  };
  const dir = mkdtempSync(join(tmpdir(), "neverheld-release-"));
  const file = join(dir, "release-seal.json");
  try {
    writeFileSync(file, JSON.stringify(seal));
    const good = spawnSync("bash", ["scripts/coldcheck-release.sh", file, publicKey], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /release signature\s+: Signature Verified Successfully/);
    const altered = structuredClone(seal);
    altered.record.release.manifest_sha256 = "c".repeat(64);
    writeFileSync(file, JSON.stringify(altered));
    const bad = spawnSync("bash", ["scripts/coldcheck-release.sh", file, publicKey], { encoding: "utf8" });
    assert.notEqual(bad.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
