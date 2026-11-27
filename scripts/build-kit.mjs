import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "public", "neverheld");
const out = (name) => join(outDir, name);
mkdirSync(outDir, { recursive: true });

const common = {
  bundle: true, write: false, minify: true, format: "iife",
  platform: "browser", target: "es2020", legalComments: "none",
  charset: "utf8", logLevel: "silent",
};
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const kit = await build({ ...common, entryPoints: [join(root, "lib/seal-kit/script-tag.ts")] });
const code = `/*! NEVERHELD ${pkg.version} | Not one packet escaped */\n${kit.outputFiles[0].text}`;
writeFileSync(out("neverheld.min.js"), code);

const key = JSON.parse(readFileSync(join(root, "release/release-public-key.json"), "utf8"));
const verifier = await build({
  ...common,
  entryPoints: [join(root, "lib/seal-kit/verifier-page.ts")],
  define: { RELEASE_PUBLIC_KEY: JSON.stringify({ key_id: key.key_id, public_key_b64: key.public_key_b64 || "" }) },
});
// Prevent an embedded script terminator from closing the HTML script element.
const verifierJs = verifier.outputFiles[0].text.replaceAll("</script", "<" + String.fromCharCode(92) + "/script");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; img-src data:">
<title>NEVERHELD offline verifier</title>
<style>body{font:15px/1.55 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1d2433}h1{font-size:1.6rem}.note,.meta,.limits,small{color:#5b6478;font-size:.85rem}.checks{list-style:none;padding:0}.checks li{padding:.35rem 0;border-bottom:1px solid #e5e8ef}.ok span,.verdict.ok{color:#11734b}.bad span,.verdict.bad{color:#b42318}.unverified span{color:#9a6700}.answer{border:1px solid #e5e8ef;border-radius:10px;padding:.6rem .9rem;margin:.6rem 0}</style></head>
<body><h1>NEVERHELD proof verifier</h1>
<p>This page verifies proofs locally and sends no network requests. A session proof is written by the page itself and is not a signed record of the session.</p>
<p id="expected" class="note"></p><label>1. Proof JSON <input id="proof" type="file" accept=".json,application/json"></label>
<p><label>2. Optional signed release seal <input id="release" type="file" accept=".json,application/json"></label></p>
<div id="result" aria-live="polite"></div><h2>Checks</h2>
<p class="note">Proof hash, deterministic Control Answers, seal state and post-seal request count. A signed release file and the published key additionally authenticate the release, not the session.</p>
<p class="note">Release key: <code id="key"></code></p><script>${verifierJs}</script></body></html>`;
writeFileSync(out("verify.html"), html);

const example = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEVERHELD example</title></head>
<body><h1>NEVERHELD one-tag example</h1><p>Place this tag after required application scripts and before protected data is opened.</p>
<script src="./neverheld.min.js" data-auto-seal data-application="NEVERHELD example"></script></body></html>`;
writeFileSync(out("example.html"), example);

const compressed = gzipSync(Buffer.from(code), { level: 9 }).length;
console.log(`NEVERHELD kit: ${Buffer.byteLength(code)} bytes; gzip: ${compressed} bytes`);
if (compressed >= 15 * 1024) process.exitCode = 1;
