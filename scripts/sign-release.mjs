// Sign a packaged release with the NEVERHELD release key (format 2 record seal: RFC 8785, SHA-256,
// Ed25519) and attach timestamps. The private key never enters the repository: pass its path in
// NEVERHELD_RELEASE_PRIVATE_KEY_FILE (PEM, PKCS#8). A path inside the repository is refused.
//
// Usage:
//   node scripts/sign-release.mjs dist/neverheld-X/release-manifest.json            -> writes release-seal.json
//   node scripts/sign-release.mjs <manifest> --tsa-query out.tsq                     -> also writes an RFC 3161 request
//   node scripts/sign-release.mjs <manifest> --tsr token.tsr --tsa "TSA name"        -> attaches the TSA reply
// The RFC 3161 request covers SHA-256 of the ASCII content hash (the signed message).
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { canonicalJson } from "../lib/seal-kit/jcs.ts";

const args = process.argv.slice(2);
const manifestPath = resolve(args[0] || "");
const option = (flag) => { const index = args.indexOf(flag); return index > 0 ? args[index + 1] : undefined; };
if (!args[0] || !existsSync(manifestPath)) { console.error("Usage: sign-release.mjs <release-manifest.json> [--tsa-query out.tsq] [--tsr token.tsr --tsa name]"); process.exit(2); }
const sealPath = join(dirname(manifestPath), "release-seal.json");
const published = JSON.parse(readFileSync(process.env.NEVERHELD_RELEASE_PUBLIC_KEY_FILE || "release/release-public-key.json", "utf8"));
const manifestText = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);

if (option("--tsr")) {
  const seal = JSON.parse(readFileSync(sealPath, "utf8"));
  seal.timestamps = seal.timestamps.filter((entry) => entry.type !== "rfc3161");
  seal.timestamps.push({ type: "rfc3161", tsa: option("--tsa") || "unnamed TSA", content_hash: seal.content_hash.value, token_b64: readFileSync(option("--tsr")).toString("base64") });
  writeFileSync(sealPath, JSON.stringify(seal, null, 2) + "\n");
  console.log(`attached RFC 3161 token to ${sealPath}`);
  process.exit(0);
}

const keyFile = process.env.NEVERHELD_RELEASE_PRIVATE_KEY_FILE;
if (!keyFile) { console.error("Set NEVERHELD_RELEASE_PRIVATE_KEY_FILE to the release private key (kept outside the repository)."); process.exit(2); }
const repo = realpathSync(process.cwd()) + sep;
if (realpathSync(resolve(keyFile)).startsWith(repo)) { console.error("Refusing: the private key file is inside the repository."); process.exit(2); }
const privateKey = createPrivateKey(readFileSync(keyFile));
const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
if (publicKey !== published.public_key_b64) { console.error("Refusing: this private key does not match release/release-public-key.json."); process.exit(2); }

const record = {
  seal_format_version: "2",
  key_id: published.key_id,
  release: { id: manifest.release, manifest_sha256: createHash("sha256").update(manifestText).digest("hex"), manifest_files: manifest.files.length },
};
const hash = createHash("sha256").update(canonicalJson(record)).digest("hex");
const stamp = { type: "self-asserted", content_hash: hash, time: new Date().toISOString().replace(/\.\d+Z$/, "Z"), key_id: record.key_id };
const seal = {
  seal_format_version: "2",
  canonicalization: "RFC 8785 (JCS)",
  record,
  content_hash: { alg: "SHA-256", value: hash },
  signature: { alg: "Ed25519", key_id: record.key_id, signed_message: "content_hash.value (ASCII hex)", value_b64: sign(null, Buffer.from(hash, "ascii"), privateKey).toString("base64") },
  timestamps: [{ ...stamp, signature_b64: sign(null, Buffer.from(canonicalJson(stamp)), privateKey).toString("base64") }],
};
writeFileSync(sealPath, JSON.stringify(seal, null, 2) + "\n");
console.log(`signed ${record.release.id}: content hash ${hash} -> ${sealPath}`);
const query = option("--tsa-query");
if (query) {
  const message = join(dirname(manifestPath), ".tsa-message");
  writeFileSync(message, hash);
  execFileSync("openssl", ["ts", "-query", "-data", message, "-sha256", "-cert", "-out", resolve(query)]);
  console.log(`RFC 3161 request written to ${query}; send it to the chosen TSA, then attach the reply with --tsr.`);
}
