// Offline command-line check. Release authenticity is checked only when a separate release seal is supplied.
import { readFileSync } from "node:fs";
import { verifyProof, type ReleaseSeal } from "../lib/seal-kit/proof";

const [proofPath, sealPath, manifestPath] = process.argv.slice(2);
if (!proofPath) {
  console.error("Usage: npm run verify:proof -- <proof.json> [release-seal.json] [release-manifest.json]");
  process.exit(2);
}
const keyFile = process.env.NEVERHELD_RELEASE_PUBLIC_KEY_FILE ?? new URL("../release/release-public-key.json", import.meta.url);
const published = JSON.parse(readFileSync(keyFile, "utf8")) as { key_id: string; public_key_b64: string };
const result = await verifyProof(JSON.parse(readFileSync(proofPath, "utf8")), {
  ...(sealPath ? { releaseSeal: JSON.parse(readFileSync(sealPath, "utf8")) as ReleaseSeal, publicKeyB64: published.public_key_b64 } : {}),
  ...(manifestPath ? { manifestText: readFileSync(manifestPath, "utf8") } : {}),
});
for (const check of result.checks) {
  console.log(`${check.unverified ? "????" : check.ok ? "OK  " : "FAIL"} ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
}
console.log(result.valid
  ? `PROOF VALID${result.releaseChecked ? " (release checked)" : " (release authenticity not checked)"}`
  : "PROOF NOT VALID");
process.exit(result.valid ? 0 : 1);
