import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import qrcode from "qrcode-generator";
import { proofJson, verifyProof, type Proof } from "../lib/seal-kit/index";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] as string);
}

function readableHtml(proof: Proof, verifierUrl: string): string {
  const body = proof.body;
  const qr = qrcode(0, "M");
  qr.addData(verifierUrl);
  qr.make();
  const qrSvg = qr.createSvgTag(5, 2);
  const answers = body.controlAnswers.answers.map((answer) => `
    <section class="answer">
      <h2>${escapeHtml(answer.name)}</h2>
      <p class="question">${escapeHtml(answer.question)}</p>
      <p><strong>${escapeHtml(answer.result.toUpperCase())}</strong></p>
      <p>${escapeHtml(answer.answer)}</p>
      <p class="muted">${escapeHtml(answer.limits)}</p>
    </section>`).join("");
  const files = body.files.length
    ? body.files.map((file) => `<li>${escapeHtml(file.name)}<br><code>${escapeHtml(file.sha256)}</code></li>`).join("")
    : "<li>No file fingerprints were supplied to this session proof.</li>";
  const limits = body.limits.map((limit) => `<li>${escapeHtml(limit)}</li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEVERHELD session proof</title>
<style>
body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:850px;margin:32px auto;padding:0 20px;color:#18212c}
h1{font-size:26px}h2{font-size:18px}.notice{padding:14px;background:#f1f4f7;border-radius:8px}
.meta,.muted{color:#5b6478;font-size:13px}.answer{border-top:1px solid #d9dee5;padding:12px 0}
.question{font-style:italic}code{overflow-wrap:anywhere}.qr{width:210px;height:210px}.qr svg{width:100%;height:100%}
</style></head>
<body>
<h1>NEVERHELD session proof</h1>
<p class="notice">This proof is written by the browser page. It records what the page observed after sealing. It is not a signed record that the session occurred and is not an independent security audit.</p>
<p><strong>Application:</strong> ${escapeHtml(body.application.name)} ${escapeHtml(body.application.version)}<br>
<strong>Release:</strong> ${escapeHtml(body.release.id)}<br>
<strong>Sealed at:</strong> ${escapeHtml(body.seal.sealedAt)} UTC</p>
<p><strong>NOPE count (page requests observed):</strong> ${body.seal.pageRequestsSinceSealing}<br>
<strong>Blocked attempts:</strong> ${body.seal.blockedAttemptsSinceSealing}<br>
<strong>Self-test:</strong> ${escapeHtml(body.seal.selfTest)}</p>
<h2>Files (fingerprints only)</h2><ul>${files}</ul>
<h2>Control Answers</h2>${answers}
<h2>Limits</h2><ul>${limits}</ul>
<h2>Check this proof</h2>
<p>Scan this code to open the NEVERHELD verifier with the proof hash pre-filled. The verifier checks the file locally; it does not send proof data to a server. The verifier file is also included in this ZIP for fully offline use.</p>
<div class="qr">${qrSvg}</div>
<p><strong>Proof hash (SHA-256):</strong><br><code>${escapeHtml(proof.proofHash.value)}</code></p>
<p class="muted">The proof hash detects changes only when compared with a separately retained copy. A person can edit the proof and recompute its hash. A signed release authenticates the released code, not the individual session.</p>
</body></html>`;
}

async function main() {
  const [, , proofArg, verifierUrlArg, outputArg, releaseArg] = process.argv;
  if (!proofArg || !verifierUrlArg || !outputArg) {
    console.error("Usage: npm run render:proof -- <proof.json> <https://host/neverheld/verify.html> <output.zip> [release-seal.json]");
    process.exitCode = 2;
    return;
  }
  const proofPath = resolve(proofArg);
  const outputPath = resolve(outputArg);
  const verifierUrl = new URL(verifierUrlArg);
  if (verifierUrl.protocol !== "https:" && verifierUrl.protocol !== "http:") {
    throw new Error("Verifier URL must use HTTP or HTTPS.");
  }
  const proof = JSON.parse(readFileSync(proofPath, "utf8")) as Proof;
  const verified = await verifyProof(proof);
  if (!verified.valid) {
    throw new Error("Proof consistency check failed; refusing to package an invalid proof.");
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const verifierPath = resolve(here, "../public/neverheld/verify.html");
  const verifierHtml = readFileSync(verifierPath, "utf8");
  const target = new URL(verifierUrl.toString());
  target.hash = `p=${proof.proofHash.value}`;

  const zip = new JSZip();
  zip.file("NEVERHELD-proof.json", proofJson(proof));
  zip.file("NEVERHELD-proof.html", readableHtml(proof, target.toString()));
  zip.file("NEVERHELD-proof-verifier.html", verifierHtml);
  zip.file("HOW-TO-CHECK.txt", [
    "NEVERHELD proof package",
    "",
    "For a fully offline check, open NEVERHELD-proof-verifier.html in a modern browser and select NEVERHELD-proof.json.",
    "For the QR route, scan the code in NEVERHELD-proof.html. It opens the hosted verifier with the expected proof hash.",
    "The proof is written by the page and is not signed. Successful checking establishes internal consistency, not that the session happened.",
    "A signed release file can be added separately to check release authenticity.",
    "",
  ].join("\n"));
  if (releaseArg) zip.file("NEVERHELD-release-seal.json", readFileSync(resolve(releaseArg)));
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  writeFileSync(outputPath, bytes);
  console.log(`Proof package created: ${outputPath} (${bytes.byteLength} bytes)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
