import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import * as playwright from "playwright";
import { createSocket } from "node:dgram";
import { createServer as createTcpServer } from "node:net";

// BROWSERS=chromium,firefox,webkit (default chromium). CHROMIUM_PATH points at a local Chromium
// when the matching Playwright download is unavailable.
const browsers = (process.env.BROWSERS || "chromium").split(",").map((name) => name.trim()).filter(Boolean);

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
const tag = '<script src="/neverheld.min.js" data-auto-seal data-workers-network="none"></script>';
const scenarios = {
  // Service worker registered and in control before the seal: outside the page's rule.
  // Registered on a setup page first, so the sealed page opens already controlled (no self-reload).
  "/sw-setup": `<script>window.ready=navigator.serviceWorker?navigator.serviceWorker.register("/sw.js").then(()=>navigator.serviceWorker.ready).then(()=>true):Promise.resolve(false)</script>`,
  "/sw": `${tag}`,
  // A worker started from an address after NEVERHELD loads but before the seal.
  "/worker": `${tag}<script>window.w=new Worker("/w.js")</script>`,
  // A slow image still loading when the tag runs: the seal must wait for the load event.
  "/late": `${tag}<img id="late" src="/slow.svg">`,
  // File input.
  "/files": `${tag}<input id="file" type="file">`,
  // R15: a WebSocket opened before sealing and still open when the seal takes effect.
  "/socket": `${tag}<script>window.ws=new WebSocket("ws://"+location.host+"/ws")</script>`,
  // R16: an attempt made the instant the policy goes in (inside the self-test window) must be counted.
  "/boundary": `<script>new MutationObserver(()=>{if(document.querySelector("meta[data-browser-seal]")&&!window.fired){window.fired=true;fetch("https://boundary.invalid/x").catch(()=>{})}}).observe(document.head,{childList:true})</script>${tag}`,
  "/egress": `${tag}`,
};

const exfil = [];
const upgraded = new Set();
// A fresh UDP listener per scenario, so late retransmissions from one browser cannot be
// counted against another.
const udpListener = async () => {
  const hits = [];
  const socket = createSocket("udp4");
  socket.on("message", () => hits.push(Date.now()));
  await new Promise((ok) => socket.bind(0, "127.0.0.1", ok));
  return { hits, port: socket.address().port, close: () => socket.close() };
};
const sideHits = [];
const side = createTcpServer((socket) => { sideHits.push(Date.now()); socket.on("error", () => {}); socket.destroy(); });
await new Promise((ok) => side.listen(0, "127.0.0.1", ok));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const server = createServer((request, response) => {
  const js = (body) => { response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); response.end(body); };
  if (request.url.startsWith("/exfil")) { exfil.push(request.url); response.end("ok"); return; }
  if (request.url === "/sw.js") return js('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(clients.claim()));self.onmessage=e=>fetch("/exfil-sw?d="+e.data);');
  if (request.url === "/w.js") return js('onmessage=e=>fetch("/exfil-worker?d="+e.data)');
  if (request.url === "/slow.svg") { setTimeout(() => { response.writeHead(200, { "content-type": "image/svg+xml" }); response.end(svg); }, 400); return; }
  if (scenarios[request.url]) { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body>${scenarios[request.url]}</body></html>`); return; }
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
  server.on("upgrade", (request, socket) => {
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("error", () => {});
  upgraded.add(socket);
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the browser-test server.");
  const base = `http://127.0.0.1:${address.port}`;
  for (const name of browsers) {
  const launch = name === "chromium" && process.env.CHROMIUM_PATH ? { headless: true, executablePath: process.env.CHROMIUM_PATH } : { headless: true };
  browser = await playwright[name].launch(launch);
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
  const proofPath = join(temp, `${name}-NEVERHELD-proof.json`);
  await download.saveAs(proofPath);
  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  assert.equal(proof.body.seal.state, "sealed");
  assert.equal(proof.body.seal.pageRequestsSinceSealing, 0);
  assert.ok(proof.body.seal.blockedAttemptsSinceSealing > 0);
  assert.equal(proof.body.seal.workers.declaration, "not-declared");
  assert.ok(proof.body.controlAnswers.answers.every((answer) => answer.result === "not-supported"), "undeclared workers fail closed");

  // Open the local verifier with the browser network disabled, then check the downloaded proof.
  // Open the local file first, then cut the network before checking: WebKit cannot open file://
  // pages in a context that is already offline. Loading a local file uses no network either way.
  const offline = await browser.newContext();
  const verifyPage = await offline.newPage();
  await verifyPage.goto(pathToFileURL(resolve(verifierPath)).href);
  // Playwright's WebKit offline emulation also fails local file reads ("I/O read operation
  // failed"), so WebKit runs this step with the verifier's own no-network policy only. A manual
  // offline check in real Safari is listed in docs/RELEASE-READINESS.md.
  if (name !== "webkit") await offline.setOffline(true);
  await verifyPage.locator("#proof").setInputFiles(proofPath);
  await verifyPage.waitForFunction(() => document.querySelector(".verdict"));
  console.log(`  ${name}: verifier (file://, isSecureContext=${await verifyPage.evaluate(() => isSecureContext)}, subtle=${await verifyPage.evaluate(() => Boolean(crypto.subtle))}): ${await verifyPage.locator(".verdict").textContent()}`);
  const verdict = await verifyPage.locator(".verdict").textContent();
  assert.match(verdict || "", /proof checks out/i);

  const tamperedPath = join(temp, `${name}-tampered-proof.json`);
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

  const proofFrom = async (target) => {
    await target.getByRole("button", { name: "Proof and checks" }).click();
    const pending = target.waitForEvent("download");
    await target.getByRole("button", { name: "Download JSON proof" }).click();
    return JSON.parse(readFileSync(await (await pending).path(), "utf8"));
  };
  const sealedPage = async (path) => {
    const fresh = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await fresh.goto(base + path);
    await fresh.waitForFunction(() => globalThis.Neverheld?.getSealStatus().state === "sealed", undefined, { timeout: 15000 });
    return fresh;
  };

  // R1: a controlling service worker can send data the page posts to it, with the count at 0.
  const swPage = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await swPage.goto(`${base}/sw-setup`);
  const hasServiceWorker = await swPage.evaluate(() => window.ready);
  if (hasServiceWorker) {
    await swPage.goto(`${base}/sw`);
    await swPage.waitForFunction(() => globalThis.Neverheld?.getSealStatus().state === "sealed" && navigator.serviceWorker.controller, undefined, { timeout: 15000 });
    const swProof = await proofFrom(swPage);
    assert.ok(["registered", "controlling"].includes(swProof.body.seal.serviceWorker), `service worker recorded (${swProof.body.seal.serviceWorker})`);
    assert.ok(swProof.body.controlAnswers.answers.every((answer) => answer.result === "not-supported"), "service worker makes answers unsupported");
  } else console.log(`  ${name}: service workers not available here; R1 browser scenario skipped`);
  await swPage.context().close();

  // R2: a worker started from an address before sealing is seen and contradicts "none".
  const workerPage = await sealedPage("/worker");
  const workerProof = await proofFrom(workerPage);
  assert.equal(workerProof.body.seal.workers.startedBeforeSeal, 1);
  assert.ok(workerProof.body.controlAnswers.answers.every((answer) => answer.result === "not-supported"));
  // Blob workers started after sealing take the page's rule: their fetch must be refused.
  const before = exfil.length;
  await workerPage.evaluate(() => { new Worker(URL.createObjectURL(new Blob([`fetch("${location.origin}/exfil-blob?d=x")`]))); });
  await workerPage.waitForTimeout(800);
  assert.equal(exfil.filter((url) => url.startsWith("/exfil-blob")).length, 0, "a blob worker started after sealing must not reach the network");
  assert.ok(exfil.length >= before);
  assert.equal(await workerPage.evaluate(() => globalThis.Neverheld.getSealStatus().workersStartedAfterSeal), 1);
  await workerPage.context().close();

  // R9: the seal waits for the load event, so a resource still loading is not cut off.
  const latePage = await sealedPage("/late");
  assert.equal(await latePage.evaluate(() => document.getElementById("late").complete && document.getElementById("late").naturalWidth > 0), true, "slow image finished loading before the seal");
  assert.equal(await latePage.evaluate(() => globalThis.Neverheld.getSealStatus().requests), 0);
  await latePage.context().close();

  // R4: a file chosen after sealing is fingerprinted automatically.
  const filePage = await sealedPage("/files");
  const content = Buffer.from(`NEVERHELD sample ${name}`);
  await filePage.locator("#file").setInputFiles({ name: "sample.txt", mimeType: "text/plain", buffer: content });
  const fileProof = await proofFrom(filePage);
  assert.deepEqual(fileProof.body.files, [{ name: "sample.txt", openedAfterSeal: true, sha256: createHash("sha256").update(content).digest("hex"), source: "file-input" }]);
  assert.equal(fileProof.body.filesRecording, "observed-and-host");
  assert.ok(fileProof.body.controlAnswers.answers.every((answer) => answer.result === "supported"), "clean declared session with a file is supported");
  await filePage.context().close();

  // R15: a connection still open at sealing is recorded and fails closed.
  const socketPage = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await socketPage.goto(`${base}/socket`);
  await socketPage.waitForFunction(() => globalThis.Neverheld?.getSealStatus().state === "sealed", undefined, { timeout: 15000 });
  const socketProof = await proofFrom(socketPage);
  assert.equal(socketProof.body.seal.connectionsOpenAtSeal, 1);
  assert.ok(socketProof.body.controlAnswers.answers.every((answer) => answer.result === "not-supported"));
  await socketPage.context().close();

  // R15: WebRTC and speculation rules after sealing are blocked in the page and counted.
  const egress = await sealedPage("/egress");
  const mainUdp = await udpListener(), frameUdp = await udpListener();
  const udpPort = mainUdp.port, sidePort = side.address().port;
  sideHits.length = 0;
  const rtc = await egress.evaluate(async (port) => {
    if (typeof RTCPeerConnection !== "function") return "unavailable";
    try { const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${port}` }] }); peer.createDataChannel("x"); await peer.setLocalDescription(await peer.createOffer()); return "created"; }
    catch (error) { return error.name; }
  }, udpPort);
  await egress.evaluate((port) => { const rules = document.createElement("script"); rules.type = "speculationrules"; rules.textContent = JSON.stringify({ prefetch: [{ source: "list", urls: [`http://127.0.0.1:${port}/spec?d=SECRET`] }] }); document.body.append(rules); }, sidePort);
  await egress.waitForTimeout(1500);
  const speculativeConnections = sideHits.length;
  await egress.evaluate((port) => { const hint = document.createElement("link"); hint.rel = "preconnect"; hint.href = `http://127.0.0.1:${port}/`; document.head.append(hint); }, sidePort);
  await egress.waitForTimeout(1500);
  const preconnectConnections = sideHits.length - speculativeConnections;
  console.log(`  ${name}: after sealing, speculation-rules connections: ${speculativeConnections}; preconnect connections: ${preconnectConnections}`);
  const guarded = await egress.evaluate(() => globalThis.Neverheld.getSealStatus());
  console.log(`  ${name}: WebRTC after sealing: ${rtc}; packets: ${mainUdp.hits.length}`);
  if (rtc !== "unavailable") assert.equal(rtc, "SecurityError", "WebRTC is blocked in the page after sealing");
  assert.equal(mainUdp.hits.length, 0, "no WebRTC packet left the page");
  assert.equal(speculativeConnections, 0, "no speculation-rules connection left the page");
  // WebKit opens a preconnect connection as the link is inserted, before any page script can
  // remove it. That is a documented limit (docs/LIMITATIONS.md), not a claim; elsewhere it must be 0.
  if (name !== "webkit") assert.equal(preconnectConnections, 0, "no preconnect connection left the page");
  assert.ok(guarded.guardBlocked >= 2, `page-level blocks counted (${guarded.guardBlocked})`);
  assert.equal(guarded.requests, 0);
  // Documented limit, not a claim: WebRTC from another frame's copy is not reached by the page guard.
  const frameRtc = await egress.evaluate(async (port) => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const Peer = frame.contentWindow && frame.contentWindow.RTCPeerConnection;
    if (typeof Peer !== "function") return "no frame WebRTC";
    try { const peer = new Peer({ iceServers: [{ urls: `stun:127.0.0.1:${port}` }] }); peer.createDataChannel("x"); await peer.setLocalDescription(await peer.createOffer()); return "created"; } catch (error) { return error.name; }
  }, frameUdp.port);
  await egress.waitForTimeout(1500);
  console.log(`  ${name}: known limit, WebRTC through a frame's copy: ${frameRtc}; packets reaching the network: ${frameUdp.hits.length}`);
  mainUdp.close(); frameUdp.close();
  await egress.context().close();

  // R16: counting starts with enforcement, so an attempt inside the self-test window is counted.
  const boundary = await sealedPage("/boundary");
  await boundary.waitForTimeout(300);
  const counted = await boundary.evaluate(() => ({ fired: window.fired, log: globalThis.Neverheld.getSealStatus().log }));
  assert.equal(counted.fired, true);
  assert.ok(counted.log.some((line) => line.includes("boundary.invalid")), `boundary attempt counted: ${JSON.stringify(counted.log)}`);
  await boundary.context().close();

  await context.close();
  await browser.close();
  browser = undefined;
  console.log(`NEVERHELD real-browser checks (${name}): passed (seal, blocked fetch, proof download, offline verifier, tamper rejection, fail-closed self-test, service worker, workers, load wait, file fingerprints, open connections, WebRTC and hint blocking, enforcement boundary).`);
  }
} finally {
  if (browser) await browser.close();
  for (const socket of upgraded) socket.destroy();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  side.close();
  rmSync(temp, { recursive: true, force: true });
}
