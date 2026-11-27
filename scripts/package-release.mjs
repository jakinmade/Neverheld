// Build the buyer distribution: dist/neverheld-<version>/ and a byte-reproducible
// dist/neverheld-<version>.tar.gz. Buyers need no build step: the archive carries the prebuilt
// one-file runtime, verifier, types, examples, docs, licence, a release manifest and SHA256SUMS.
// Usage: node scripts/package-release.mjs [outDir]   (run `npm run build` first)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outRoot = resolve(process.argv[2] || join(root, "dist"));
const name = `neverheld-${pkg.version}`;
const dir = join(outRoot, name);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const copy = (from, to = from) => cpSync(join(root, from), join(dir, to), { recursive: true });
copy("public/neverheld/neverheld.min.js", "neverheld.min.js");
copy("public/neverheld/verify.html", "verify.html");
copy("public/neverheld/example.html", "examples/plain-html/example.html");
copy("examples/nextjs/README.md", "examples/nextjs/README.md");
for (const file of ["app/layout.tsx", "app/page.tsx", "package.json"]) copy(`examples/nextjs-app/${file}`, `examples/nextjs-app/${file}`);
copy("README.md"); copy("LICENSE"); copy("release/release-public-key.json", "release-public-key.json");
for (const doc of ["ARCHITECTURE.md", "INSTALL.md", "API.md", "PROOF-FORMAT.md", "SECURITY-BOUNDARIES.md", "LIMITATIONS.md"]) copy(`docs/${doc}`, `docs/${doc}`);
for (const script of ["coldcheck-proof.sh", "coldcheck-release.sh"]) copy(`scripts/${script}`, `tools/${script}`);
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.release.json"), "--outDir", join(dir, "types")], { stdio: "inherit" });

const files = [];
const walk = (folder) => {
  for (const entry of readdirSync(folder).sort()) {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) walk(path);
    else files.push({ path: relative(dir, path).split("\\").join("/"), sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), bytes: statSync(path).size });
  }
};
walk(dir);
const releaseId = `neverheld-${pkg.version}`;
// Canonical form (keys sorted, no whitespace), so the manifest hash is the same everywhere.
const manifest = JSON.stringify({ files: files.map(({ bytes, path, sha256 }) => ({ bytes, path, sha256 })), release: releaseId });
writeFileSync(join(dir, "release-manifest.json"), manifest);
const sums = [...files, { path: "release-manifest.json", sha256: createHash("sha256").update(manifest).digest("hex") }]
  .map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n";
writeFileSync(join(dir, "SHA256SUMS"), sums);

// Reproducible archive: fixed order, owner and time; gzip without name or time.
const archive = join(outRoot, `${name}.tar.gz`);
execFileSync("bash", ["-c", `set -o pipefail; tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --mode=u+rw,go+r,go-w --format=gnu -C "${outRoot}" -cf - "${name}" | gzip -9 -n > "${archive}"`]);
const archiveHash = createHash("sha256").update(readFileSync(archive)).digest("hex");
console.log(`release ${releaseId}: ${files.length} files; manifest sha256 ${sums.split("\n").at(-2).split(" ")[0]}; archive sha256 ${archiveHash}`);
