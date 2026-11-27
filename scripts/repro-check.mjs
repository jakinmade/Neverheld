// Build and package the same commit twice from clean outputs; the archives must be byte-identical.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const hashes = [];
for (const run of [1, 2]) {
  const out = mkdtempSync(join(tmpdir(), `neverheld-repro-${run}-`));
  rmSync("public/neverheld/neverheld.min.js", { force: true });
  execFileSync(process.execPath, ["scripts/build-kit.mjs"], { stdio: "ignore" });
  execFileSync(process.execPath, ["scripts/package-release.mjs", out], { stdio: "ignore" });
  hashes.push({ archive: createHash("sha256").update(readFileSync(join(out, `neverheld-${version}.tar.gz`))).digest("hex"), sums: readFileSync(join(out, `neverheld-${version}`, "SHA256SUMS"), "utf8") });
  rmSync(out, { recursive: true, force: true });
}
if (hashes[0].sums !== hashes[1].sums || hashes[0].archive !== hashes[1].archive) {
  console.error("NOT REPRODUCIBLE", hashes);
  process.exit(1);
}
console.log(`reproducible: two clean builds gave archive sha256 ${hashes[0].archive}`);
