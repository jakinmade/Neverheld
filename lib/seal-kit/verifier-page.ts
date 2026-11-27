/**
 * The offline verifier page (built into one self-contained HTML file by
 * scripts/build-seal-kit.mjs). It makes no network request: open it from the output pack, from
 * the QR code, or from the site, then choose the proof file. Adding the release seal published
 * with the GitHub release also checks that the proof names a genuine, signed release.
 */
import { verifyProof, type Proof, type ReleaseSeal, type VerifyResult } from "./proof";

declare const RELEASE_PUBLIC_KEY: { key_id: string; public_key_b64: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

async function readJson(input: HTMLInputElement): Promise<{ text: string; value: unknown } | undefined> {
  const file = input.files?.[0];
  if (!file) return undefined;
  const text = await file.text();
  return { text, value: JSON.parse(text) };
}

function render(result: VerifyResult, proof: Proof | undefined, expectedHash: string) {
  const rows = result.checks.map((check) => `<li class="${check.unverified ? "unverified" : check.ok ? "ok" : "bad"}"><span>${check.unverified ? "?" : check.ok ? "✓" : "✗"}</span> ${escapeHtml(check.name)}${check.detail ? `<small>${escapeHtml(check.detail)}</small>` : ""}</li>`);
  if (expectedHash && proof) {
    const same = proof.proofHash?.value === expectedHash;
    rows.unshift(`<li class="${same ? "ok" : "bad"}"><span>${same ? "✓" : "✗"}</span> Proof is the one the QR code names<small>${escapeHtml(expectedHash)}</small></li>`);
    if (!same) result = { ...result, valid: false };
  }
  const verdict = result.valid
    ? `<p class="verdict ok">The proof checks out${result.releaseChecked ? ", and it names a genuine signed release." : ". Add the release seal to check the release too."}${result.checks.some((check) => check.unverified) ? " Items marked ? are present but not checked by this page; see each one." : ""}</p><p class="limits">This shows the proof is consistent and, if its proof hash was kept separately, unchanged. The proof is not signed, so it does not prove that the session took place; the signature covers the release it names, not the session.</p>`
    : `<p class="verdict bad">The proof does not check out. Do not rely on it.</p>`;
  const answers = result.valid && proof ? `<h2>Control Answers</h2>${proof.body.controlAnswers.answers.map((answer) => `<div class="answer"><h3>${escapeHtml(answer.name)}</h3><p class="q">${escapeHtml(answer.question)}</p><p>${escapeHtml(answer.answer)}</p><p class="limits">${escapeHtml(answer.limits)}</p></div>`).join("")}
    <p class="limits">Ruleset ${escapeHtml(proof.body.controlAnswers.rulesetVersion)}, fingerprint ${escapeHtml(proof.body.controlAnswers.rulesetFingerprint)}</p>` : "";
  const summary = proof?.body ? `<p class="meta">${escapeHtml(proof.body.application?.name ?? "")} ${escapeHtml(proof.body.application?.version ?? "")} · release ${escapeHtml(proof.body.release?.id ?? "")} · sealed ${escapeHtml(proof.body.seal?.sealedAt ?? "")} · ${proof.body.files?.length ?? 0} file(s)</p>` : "";
  $("result").innerHTML = `${verdict}${summary}<ul class="checks">${rows.join("")}</ul>${answers}`;
}

async function run() {
  const expectedHash = new URLSearchParams(location.hash.slice(1)).get("p") ?? "";
  if (expectedHash) $("expected").textContent = `The QR code names proof ${expectedHash}. Choose that proof file below.`;
  const go = async () => {
    try {
      const proof = await readJson($<HTMLInputElement>("proof"));
      if (!proof) { $("result").innerHTML = ""; return; }
      const release = await readJson($<HTMLInputElement>("release"));
      const result = await verifyProof(proof.value, release ? { releaseSeal: release.value as ReleaseSeal, publicKeyB64: RELEASE_PUBLIC_KEY.public_key_b64 } : {});
      render(result, proof.value as Proof, expectedHash);
    } catch (error) {
      $("result").innerHTML = `<p class="verdict bad">The file could not be read: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    }
  };
  $("proof").addEventListener("change", go);
  $("release").addEventListener("change", go);
  $("key").textContent = `${RELEASE_PUBLIC_KEY.key_id}: ${RELEASE_PUBLIC_KEY.public_key_b64}`;
}

run();
