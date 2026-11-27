import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = process.cwd();
const kitPath = join(root, "public/neverheld/neverheld.min.js");
const verifierPath = join(root, "public/neverheld/verify.html");
const kit = readFileSync(kitPath);
const verifier = readFileSync(verifierPath);
const html = (fail = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NEVERHELD browser test</title></head><body>
<h1>Browser test app</h1><button id="protected-action">Protected action</button>
${fail ? '<script>window.fetch = () => Promise.resolve({ ok: true });</script>' : ""}
<script src="/neverheld.min.js" data-auto-seal data-application="Browser test app"></script>
</body></html>`;

const server = createServer((request, response) => {
  if (request.url === "/neverheld.min.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(kit);
    return;
  }
  if (request.url === "/verify.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(verifier);
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html(request.url === "/fail"));
});

const temp = mkdtempSync(join(tmpdir(), "neverheld-browser-"));
let browser;
try {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the browser-test server.");
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  await page.goto(base);
  await page.waitForFunction(() => globalThis.Neverheld?.getSealStatus().state === "sealed");
  await page.waitForSelector("text=NEVERHELD");
  const initial = await page.evaluate(() => ({
    state: globalThis.Neverheld.getSealStatus().state,
    requests: globalThis.Neverheld.getSealStatus().requests,
    policy: document.querySelector('meta[data-browser-seal]')?.getAttribute("content") || "",
  }));
  assert.equal(initial.state, "sealed");
  assert.equal(initial.requests, 0);
  assert.match(initial.policy, /connect-src 'none'/);
  assert.match(initial.policy, /default-src 'none'/);

  const beforeBlocked = await page.evaluate(() => globalThis.Neverheld.getSealStatus().blocked);
  const attempt = await page.evaluate(async () => {
    try { await fetch("https://neverheld-test.invalid/post-seal-probe"); return "unexpectedly-resolved"; }
    catch { return "refused"; }
  });
  assert.equal(attempt, "refused");
  await page.waitForFunction((previous) => globalThis.Neverheld.getSealStatus().blocked > previous, beforeBlocked);
  const after = await page.evaluate(() => ({
    requests: globalThis.Neverheld.getSealStatus().requests,
    blocked: globalThis.Neverheld.getSealStatus().blocked,
  }));
  assert.equal(after.requests, 0, "a refused fetch must not count as a successful page request");
  assert.ok(after.blocked > beforeBlocked, "the refusal must be visible in the blocked-attempt counter");

  await page.getByRole("button", { name: "Proof and checks" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON proof" }).click();
  const download = await downloadPromise;
  const proofPath = join(temp, "NEVERHELD-proof.json");
  await download.saveAs(proofPath);
  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  assert.equal(proof.body.seal.state, "sealed");
  assert.equal(proof.body.seal.pageRequestsSinceSealing, 0);
  assert.ok(proof.body.seal.blockedAttemptsSinceSealing > 0);
  assert.equal(proof.body.seal.workersNetwork, "not-declared");

  // Open the local verifier with the browser network disabled, then check the downloaded proof.
  const offline = await browser.newContext();
  await offline.setOffline(true);
  const verifyPage = await offline.newPage();
  await verifyPage.goto(pathToFileURL(resolve(verifierPath)).href);
  await verifyPage.locator("#proof").setInputFiles(proofPath);
  await verifyPage.waitForFunction(() => document.querySelector(".verdict")?.textContent?.includes("proof checks out"));
  const verdict = await verifyPage.locator(".verdict").textContent();
  assert.match(verdict || "", /proof checks out/i);

  const tamperedPath = join(temp, "tampered-proof.json");
  proof.body.seal.pageRequestsSinceSealing = 1;
  writeFileSync(tamperedPath, JSON.stringify(proof));
  await verifyPage.locator("#proof").setInputFiles(tamperedPath);
  await verifyPage.waitForFunction(() => document.querySelector(".verdict")?.textContent?.includes("does not check out"));
  assert.match((await verifyPage.locator(".verdict").textContent()) || "", /does not check out/i);

  // A fake successful fetch means the self-test cannot observe a browser refusal. The dialog must stay open.
  const failPage = await context.newPage();
  await failPage.goto(`${base}/fail`);
  await failPage.waitForFunction(() => globalThis.Neverheld?.getSealStatus().state === "failed");
  assert.equal(await failPage.locator("dialog").evaluate((dialog) => dialog.open), true);
  assert.match(await failPage.locator("dialog").textContent() || "", /could not seal this page/i);

  await offline.close();
  await context.close();
  console.log("NEVERHELD real-browser checks: passed (seal, blocked fetch, proof download, offline verifier, tamper rejection, fail-closed self-test).");
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(temp, { recursive: true, force: true });
}
