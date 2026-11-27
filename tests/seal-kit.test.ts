import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { gzipSync } from "node:zlib";
import {
  buildProof, controlAnswers, evidenceFromBody, proofJson, sealPolicy, verifyProof,
  CONTROL_RULESET, SEAL_KIT_VERSION, type SealStatus,
} from "../lib/seal-kit";

const status = (change: Partial<SealStatus> = {}): SealStatus => ({
  state: "sealed", sealedAt: 1000, sealedAtEpoch: Date.UTC(2026, 10, 27, 18),
  sealedAtTime: "18:00", policy: sealPolicy(), requests: 0, blocked: 0, log: [], ...change,
});
const files = [{ name: "sample.pdf", sha256: "a".repeat(64) }];
const application = { name: "test", version: "0.1.0", commit: "test" };
const release = { id: "test-release", manifestSha256: "b".repeat(64), manifestFiles: 2 };
const workers = { network: "configured" as const, description: "Worker restrictions declared for test only." };

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
    workers: { network: "not-declared", description: "No worker evidence." },
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

test("initial extraction version", () => assert.equal(SEAL_KIT_VERSION, "0.1.0"));

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
