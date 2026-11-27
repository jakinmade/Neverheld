// Acceptance test 7 (Next.js half): NEVERHELD added by one script tag to a real Next.js app,
// with no other code change. Requires `npm ci && npm run build` in examples/nextjs-app first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as playwright from "playwright";

const browsers = (process.env.BROWSERS || "chromium").split(",").map((name) => name.trim()).filter(Boolean);
const base = "http://127.0.0.1:3311";
const app = spawn("npm", ["start"], { cwd: "examples/nextjs-app", stdio: "ignore", detached: true });
let browser;
try {
  for (let i = 0; ; i += 1) {
    try { if ((await fetch(base)).ok) break; } catch { /* starting */ }
    if (i > 60) throw new Error("Next.js fixture did not start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  for (const name of browsers) {
    const launch = name === "chromium" && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
    browser = await playwright[name].launch({ headless: true, ...launch });
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await page.goto(base);
    await page.waitForFunction(() => globalThis.Neverheld?.getSealStatus().state === "sealed", undefined, { timeout: 20000 });
    await page.locator("#hydrated").click();
    await page.waitForSelector("text=clicked 1");
    const content = Buffer.from("next fixture file");
    await page.locator("#file").setInputFiles({ name: "n.txt", mimeType: "text/plain", buffer: content });
    await page.getByRole("button", { name: "Proof and checks" }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download JSON proof" }).click();
    const proof = JSON.parse(readFileSync(await (await pending).path(), "utf8"));
    assert.equal(proof.body.seal.pageRequestsSinceSealing, 0, "Next.js made no request after sealing");
    assert.equal(proof.body.seal.blockedAttemptsSinceSealing, 0, "Next.js attempted nothing after sealing");
    assert.equal(proof.body.files[0].sha256, createHash("sha256").update(content).digest("hex"));
    assert.ok(proof.body.controlAnswers.answers.every((answer) => answer.result === "supported-if-declaration-holds"));
    await browser.close();
    browser = undefined;
    console.log(`NEVERHELD Next.js checks (${name}): passed (seal after hydration, app still interactive, zero requests and blocked attempts, file fingerprint).`);
  }
} finally {
  if (browser) await browser.close();
  try { process.kill(-app.pid); } catch { /* already stopped */ }
}
