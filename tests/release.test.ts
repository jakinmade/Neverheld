// Release lifecycle: package -> manifest -> Ed25519 release seal -> RFC 3161 timestamp -> verify.
// Uses an ephemeral key and a throwaway local TSA: this tests the mechanics, not a published identity.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProof, proofJson, sealPolicy, verifyProof, type ReleaseSeal } from "../lib/seal-kit";

const run = (command: string, args: string[], env: Record<string, string> = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result.stdout;
};
const haveTools = ["jq", "openssl", "sha256sum", "tar"].every((tool) => spawnSync("which", [tool]).status === 0);

test("full release lifecycle: package, sign, independent timestamp, cold check, proof names the signed release", { skip: !haveTools && "jq/openssl/sha256sum/tar unavailable" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "neverheld-lifecycle-"));
  try {
    const pair = generateKeyPairSync("ed25519");
    const keyFile = join(dir, "release-private.pem");
    writeFileSync(keyFile, pair.privateKey.export({ format: "pem", type: "pkcs8" }));
    const publicB64 = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
    const pubFile = join(dir, "release-public-key.json");
    writeFileSync(pubFile, JSON.stringify({ key_id: "test-ephemeral", public_key_b64: publicB64 }));
    const env = { NEVERHELD_RELEASE_PRIVATE_KEY_FILE: keyFile, NEVERHELD_RELEASE_PUBLIC_KEY_FILE: pubFile };

    run(process.execPath, ["scripts/build-kit.mjs"]);
    run(process.execPath, ["scripts/package-release.mjs", dir]);
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    const releaseDir = join(dir, `neverheld-${version}`);
    const manifest = join(releaseDir, "release-manifest.json");
    run("bash", ["-c", `cd "${releaseDir}" && sha256sum --quiet -c SHA256SUMS`]);

    // A key inside the repository is refused.
    const inside = spawnSync("npx", ["tsx", "scripts/sign-release.mjs", manifest], { encoding: "utf8", env: { ...process.env, ...env, NEVERHELD_RELEASE_PRIVATE_KEY_FILE: "package.json" } });
    assert.notEqual(inside.status, 0);

    run("npx", ["tsx", "scripts/sign-release.mjs", manifest, "--tsa-query", join(dir, "q.tsq")], env);

    // Throwaway local TSA standing in for an independent one.
    const conf = join(dir, "tsa.cnf");
    writeFileSync(conf, `[ tsa ]\ndefault_tsa = t\n[ t ]\ndir = ${dir}\nserial = ${dir}/serial\nsigner_cert = ${dir}/tsa.pem\nsigner_key = ${dir}/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4\ndigests = sha256\naccuracy = secs:1\ness_cert_id_alg = sha256\n[ ext ]\nextendedKeyUsage = critical,timeStamping\nbasicConstraints = CA:FALSE\n`);
    writeFileSync(join(dir, "serial"), "01\n");
    run("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", join(dir, "ca.key"), "-out", join(dir, "ca.pem"), "-subj", "/CN=Test TSA CA", "-days", "2"]);
    run("openssl", ["req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", join(dir, "tsa.key"), "-out", join(dir, "tsa.csr"), "-subj", "/CN=Test TSA"]);
    run("openssl", ["x509", "-req", "-in", join(dir, "tsa.csr"), "-CA", join(dir, "ca.pem"), "-CAkey", join(dir, "ca.key"), "-CAcreateserial", "-out", join(dir, "tsa.pem"), "-days", "2", "-extfile", conf, "-extensions", "ext"]);
    run("openssl", ["ts", "-reply", "-config", conf, "-queryfile", join(dir, "q.tsq"), "-out", join(dir, "r.tsr")]);
    run("npx", ["tsx", "scripts/sign-release.mjs", manifest, "--tsr", join(dir, "r.tsr"), "--tsa", "Test TSA"], env);

    const sealFile = join(releaseDir, "release-seal.json");
    const cold = run("bash", ["scripts/coldcheck-release.sh", sealFile, publicB64, join(dir, "ca.pem")]);
    assert.match(cold, /release signature\s+: Signature Verified Successfully/);
    assert.match(cold, /RFC 3161 token\s+: Verification: OK/);
    const noCa = run("bash", ["scripts/coldcheck-release.sh", sealFile, publicB64]);
    assert.match(noCa, /present, NOT validated/);

    // A token from another CA must fail.
    run("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", join(dir, "o.key"), "-out", join(dir, "other.pem"), "-subj", "/CN=Other", "-days", "2"]);
    assert.notEqual(spawnSync("bash", ["scripts/coldcheck-release.sh", sealFile, publicB64, join(dir, "other.pem")]).status, 0);

    // A proof naming this release verifies as authentic; a different file list does not.
    const seal = JSON.parse(readFileSync(sealFile, "utf8")) as ReleaseSeal;
    const manifestText = readFileSync(manifest, "utf8");
    const status = { state: "sealed" as const, sealedAt: 1, sealedAtEpoch: Date.UTC(2026, 10, 27), policy: sealPolicy(), requests: 0, blocked: 0, log: [], workersStartedBeforeSeal: 0, workersStartedAfterSeal: 0, serviceWorker: "none" as const };
    const proof = JSON.parse(proofJson(await buildProof({
      status, files: [], application: { name: "t", version: "t", commit: "t" },
      release: { id: seal.record.release!.id, manifestSha256: createHash("sha256").update(manifestText).digest("hex"), manifestFiles: seal.record.release!.manifest_files },
      workers: { declaration: "none", description: "none" },
    })));
    const good = await verifyProof(proof, { releaseSeal: seal, publicKeyB64: publicB64, manifestText });
    assert.equal(good.valid, true, JSON.stringify(good.checks));
    assert.equal(good.assurance.release, "authentic");
    assert.equal(good.assurance.independentTimestamp, "not-verified", "the browser verifier does not claim to check TSA tokens");
    const altered = await verifyProof(proof, { releaseSeal: seal, publicKeyB64: publicB64, manifestText: manifestText.replace(/"bytes":\d/, '"bytes":9') });
    assert.equal(altered.valid, false);
    const forged = structuredClone(seal); forged.record.release!.manifest_sha256 = "c".repeat(64);
    assert.equal((await verifyProof(proof, { releaseSeal: forged, publicKeyB64: publicB64 })).assurance.release, "failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two clean builds give a byte-identical release archive", { skip: !haveTools && "tar unavailable" }, () => {
  assert.match(run(process.execPath, ["scripts/repro-check.mjs"]), /reproducible: two clean builds/);
});
