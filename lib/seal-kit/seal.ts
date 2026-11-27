/**
 * Seal kit: the browser seal. Locks a web page so the browser itself refuses to let it send
 * data, and reports what has happened since.
 *
 * How it works
 * 1. Everything the page will need is loaded first (the caller's `prepare` step).
 * 2. A Content Security Policy is added to the page. The browser then refuses every fetch,
 *    upload, beacon, WebSocket and form post the page might attempt, whoever wrote the code.
 *    A policy can only ever be tightened, never removed, so the seal lasts until the tab closes.
 * 3. The seal tests itself: it makes one request that must be refused. If the browser lets it
 *    through, the seal reports "failed" and the caller must not open any file.
 * 4. From then on it counts every network request the page makes and every attempt the
 *    browser blocks, so the user can see the numbers stay at zero (the zero count).
 *
 * What it does not cover (browsers offer no policy for these): moving the whole tab to another
 * address, by a link or by a script, and browser extensions, which run outside the page's policy.
 * Requests made inside workers and service workers are not visible to the page's counter and are
 * not refused by the page's rule. The seal therefore records whether a service worker is
 * registered or in control, and how many workers the page started before and after sealing
 * (workers started after sealing can only come from blob: and take the page's rule). Workers
 * started before NEVERHELD loaded, or through a reference saved before it loaded, cannot be seen.
 *
 * No dependencies and nothing specific to one product. Moved here unchanged in behaviour from
 * EXEVVIA's lib/browser-seal.ts (v1.0.21), which now loads it from this kit.
 */

export type SealOptions = {
  /**
   * Development servers alone need eval and a hot-reload socket. Never set this in production:
   * it relaxes the seal.
   */
  development?: boolean;
};

/** The exact rule the browser is asked to enforce. */
export function sealPolicy(options: SealOptions = {}): string {
  const development = Boolean(options.development);
  // Everything the page needs is loaded before the seal goes on, so the seal allows no address
  // at all, not even the page's own server: an image, script, style, font, prefetch or worker
  // request to it could otherwise carry data out in its address (independent review, 27 Nov
  // 2026). Only content already in memory (data:, blob:) and inline code may still be used.
  // Development servers alone keep 'self' for scripts, because hot reload loads new code.
  return [
    "default-src 'none'",
    `script-src${development ? " 'self' 'unsafe-eval'" : ""} 'unsafe-inline' 'wasm-unsafe-eval'`,
    "style-src 'unsafe-inline'",
    "font-src data: blob:",
    "img-src data: blob:",
    "worker-src blob:",
    development ? "connect-src ws:" : "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export type SealState = "open" | "sealing" | "sealed" | "failed";
export type ServiceWorkerState = "none" | "registered" | "controlling" | "not-available";

export type SealStatus = {
  state: SealState;
  /** performance.now() at the moment the seal took effect. */
  sealedAt?: number;
  /** Wall-clock time the seal took effect, for display. */
  sealedAtTime?: string;
  /** Wall-clock time the seal took effect, in milliseconds since 1970 (for tests and logs). */
  sealedAtEpoch?: number;
  /** The exact policy text placed in the page. */
  policy?: string;
  /** Network requests made by this page since sealing (should stay 0). */
  requests: number;
  /** Attempts the browser blocked since sealing. */
  blocked: number;
  /** Addresses of requests and blocked attempts, for the "check it yourself" panel. */
  log: string[];
  /** Workers (dedicated or shared) the page started after NEVERHELD loaded, before sealing. */
  workersStartedBeforeSeal: number;
  /** Workers started after sealing (blob: only, which take the page's rule). */
  workersStartedAfterSeal: number;
  /** Service worker state at sealing, kept at its worst value seen since. */
  serviceWorker?: ServiceWorkerState;
  /** WebSocket, EventSource, WebRTC or WebTransport connections opened since NEVERHELD loaded and still open when the seal took effect. */
  connectionsOpenAtSeal: number;
  /** Attempts NEVERHELD blocked inside the page after sealing (WebRTC, WebTransport, speculative or connection hints). Page-level, not browser-enforced. */
  guardBlocked: number;
  /** Whether the page was served with a Connection-Allowlist header (checked only on request). */
  connectionAllowlist: "present" | "absent" | "not-checked";
  error?: string;
};

const PROBE_PATH = "/seal-self-test";

let status: SealStatus = { state: "open", requests: 0, blocked: 0, log: [], workersStartedBeforeSeal: 0, workersStartedAfterSeal: 0, connectionsOpenAtSeal: 0, guardBlocked: 0, connectionAllowlist: "not-checked" };
/** True from the moment the policy is placed in the page (the enforcement boundary). */
let enforcing = false;
const listeners = new Set<(value: SealStatus) => void>();
let sealing: Promise<void> | undefined;

function update(change: Partial<SealStatus>) {
  status = { ...status, ...change };
  for (const listener of listeners) listener(status);
}

const SERVICE_WORKER_RANK: ServiceWorkerState[] = ["not-available", "none", "registered", "controlling"];
function worse(a: ServiceWorkerState | undefined, b: ServiceWorkerState): ServiceWorkerState {
  return a && SERVICE_WORKER_RANK.indexOf(a) > SERVICE_WORKER_RANK.indexOf(b) ? a : b;
}

/** A service worker can claim the page after sealing, so the state is re-read on every call. */
export function getSealStatus(): SealStatus {
  if (status.serviceWorker && typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
    status = { ...status, serviceWorker: "controlling" };
  }
  return status;
}

async function serviceWorkerState(): Promise<ServiceWorkerState> {
  const container = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!container) return "not-available";
  if (container.controller) return "controlling";
  try {
    return (await container.getRegistrations()).length > 0 ? "registered" : "none";
  } catch {
    return "registered"; // unknown is treated as the unsafe answer
  }
}

function guardBlock(what: string) {
  update({ guardBlocked: status.guardBlocked + 1, log: [...status.log, `Blocked in page: ${what}`].slice(-20) });
}

const tracked: Array<() => boolean> = [];
let observingConnections = false;
/**
 * Track long-lived connections the page opens from now on, and block in the page, once sealed,
 * the connection kinds the browser's policy does not govern (WebRTC) or may not govern
 * (WebTransport). This is page-level blocking: code holding a reference saved before NEVERHELD
 * loaded, or using another frame's copy, is not stopped by it. A connection opened before
 * sealing and still open at sealing is recorded, because the policy does not close it.
 */
export function observeConnections() {
  if (observingConnections || typeof window === "undefined") return;
  observingConnections = true;
  const target = window as unknown as Record<string, unknown>;
  const wrap = (name: string, blockAfterSeal: boolean, isOpen: (item: any) => boolean) => {
    const Original = target[name];
    if (typeof Original !== "function") return;
    target[name] = new Proxy(Original, {
      construct(original, args, newTarget) {
        if (blockAfterSeal && enforcing) {
          guardBlock(name);
          throw new DOMException(`${name} is blocked on this sealed page by NEVERHELD.`, "SecurityError");
        }
        const item = Reflect.construct(original as new (...a: unknown[]) => object, args, newTarget);
        const closed = (item as { closed?: Promise<unknown> }).closed;
        if (closed?.then) closed.then(() => { (item as Record<string, unknown>).__neverheldClosed = true; }, () => { (item as Record<string, unknown>).__neverheldClosed = true; });
        tracked.push(() => isOpen(item));
        return item;
      },
    });
  };
  wrap("WebSocket", false, (socket) => socket.readyState < 2);
  wrap("EventSource", false, (source) => source.readyState < 2);
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) wrap(name, true, (peer) => peer.signalingState !== "closed");
  wrap("WebTransport", true, (transport) => !transport.__neverheldClosed);
  // fetch and XHR already in progress at sealing are not cancelled by the policy: track them too.
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      let done = false;
      tracked.push(() => !done);
      const result = originalFetch.apply(this, args);
      result.then(() => { done = true; }, () => { done = true; });
      return result;
    } as typeof fetch;
  }
  const xhr = typeof XMLHttpRequest === "function" ? XMLHttpRequest.prototype : undefined;
  if (xhr) {
    const send = xhr.send;
    xhr.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>) {
      let done = false;
      tracked.push(() => !done);
      this.addEventListener("loadend", () => { done = true; });
      return send.apply(this, args);
    };
  }
}

/** Connection and speculation hints that can reach the network outside the page's policy. */
const HINT = /\b(preconnect|dns-prefetch|prerender|prefetch|preload|modulepreload)\b/i;
function isNetworkHint(node: Node): node is Element {
  if (!(node instanceof Element)) return false;
  if (node.tagName === "LINK") return HINT.test(node.getAttribute("rel") || "");
  return node.tagName === "SCRIPT" && (node.getAttribute("type") || "").trim().toLowerCase() === "speculationrules";
}
/** Remove speculation rules and connection hints now and whenever they are added. */
function guardHints() {
  // Every hint already in the page is removed at sealing: rules can start prefetches later (for
  // example on hover). Removing a hint that already ran does not close a connection it opened.
  for (const node of document.querySelectorAll('script[type="speculationrules" i], link[rel]')) if (isNetworkHint(node)) node.remove();
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (isNetworkHint(node)) { node.remove(); guardBlock(node.tagName === "SCRIPT" ? "speculation rules" : `link rel=${node.getAttribute("rel")}`); }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

/** Read the page's own Connection-Allowlist response header (one request, before sealing). */
export async function checkConnectionAllowlist(): Promise<"present" | "absent"> {
  try {
    const response = await fetch(location.href, { method: "HEAD", cache: "no-store", credentials: "same-origin" });
    const value = response.headers.get("connection-allowlist") ? "present" : "absent";
    update({ connectionAllowlist: value });
    return value;
  } catch {
    update({ connectionAllowlist: "absent" });
    return "absent";
  }
}

let observingWorkers = false;
/**
 * Count the workers the page starts from now on. Called when NEVERHELD loads, so that workers
 * started between loading and sealing are seen. It only counts; it never blocks a worker.
 */
export function observeWorkers() {
  if (observingWorkers || typeof window === "undefined") return;
  observingWorkers = true;
  const target = window as unknown as Record<string, unknown>;
  for (const name of ["Worker", "SharedWorker"]) {
    const Original = target[name];
    if (typeof Original !== "function") continue;
    target[name] = new Proxy(Original, {
      construct(original, args, newTarget) {
        if (status.state === "sealed") update({ workersStartedAfterSeal: status.workersStartedAfterSeal + 1 });
        else update({ workersStartedBeforeSeal: status.workersStartedBeforeSeal + 1 });
        return Reflect.construct(original as new (...a: unknown[]) => object, args, newTarget);
      },
    });
  }
}

export function subscribeToSeal(listener: (value: SealStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

function isLocalAddress(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("about:");
}

/**
 * Load every font the page's stylesheets declare, before sealing. A browser fetches a font only
 * when text first needs it, and once sealed it could not. A font that fails is skipped: the
 * browser then uses a fallback font, which changes only the look of the text.
 */
async function loadDeclaredFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([...document.fonts].map((font) => font.load().catch(() => undefined)));
}

/** One request that a sealed page must refuse. Resolves true only if the browser blocked it. */
async function selfTest(): Promise<boolean> {
  const probe = `${PROBE_PATH}?t=${Date.now()}`;
  let reported = false;
  const onViolation = (event: SecurityPolicyViolationEvent) => {
    if (event.blockedURI.includes(PROBE_PATH)) reported = true;
  };
  document.addEventListener("securitypolicyviolation", onViolation);
  let blocked = false;
  try {
    await fetch(probe, { cache: "no-store" });
  } catch {
    blocked = true;
  }
  // The violation event is queued as a task; give it a moment to arrive.
  await new Promise((resolve) => setTimeout(resolve, 50));
  document.removeEventListener("securitypolicyviolation", onViolation);
  return blocked && reported;
}

/**
 * Once sealed, a link on the page opens in a new tab instead of replacing this one, so the
 * sealed page never navigates away and no work is lost. A link to a section of this same page
 * (#…) scrolls to it without navigating. Downloads (blob: links) are left alone.
 */
function keepLinksInNewTabs() {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, location.href);
    if (url.protocol === "blob:" || url.protocol === "data:") return;
    event.stopPropagation();
    event.preventDefault();
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash) {
      // Same page, different section: scroll to it without navigating (a navigation, even
      // within the page, can make the browser fetch the site icon again).
      document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    window.open(url.href, "_blank", "noopener,noreferrer");
  }, true);
}

function startCounting(sealedAt: number) {
  const seen = new Set<PerformanceEntry>();
  const record = (entry: PerformanceEntry) => {
    if (seen.has(entry) || entry.startTime < sealedAt || isLocalAddress(entry.name)) return;
    seen.add(entry);
    update({ requests: status.requests + 1, log: [...status.log, `Request: ${entry.name}`].slice(-20) });
  };
  if (typeof PerformanceObserver !== "undefined") {
    new PerformanceObserver((list) => list.getEntries().forEach(record)).observe({ type: "resource", buffered: true });
  }
  document.addEventListener("securitypolicyviolation", (event) => {
    if (event.blockedURI.includes(PROBE_PATH)) return;
    update({ blocked: status.blocked + 1, log: [...status.log, `Blocked: ${event.blockedURI || event.violatedDirective}`].slice(-20) });
  });
}

/**
 * Seal the page. Safe to call many times: the first call does the work, later calls wait for it.
 * Rejects if preparation fails or the browser does not enforce the seal; the caller must then
 * not read any user file.
 */
export function sealPage(prepare: () => Promise<void> = async () => {}, options: SealOptions = {}): Promise<void> {
  if (sealing) return sealing;
  observeWorkers();
  observeConnections();
  sealing = (async () => {
    update({ state: "sealing", error: undefined });
    try {
      await prepare();
      await loadDeclaredFonts();
      const policy = sealPolicy(options);
      const prefetchOff = document.createElement("meta");
      prefetchOff.httpEquiv = "x-dns-prefetch-control";
      prefetchOff.content = "off";
      document.head.appendChild(prefetchOff);
      const meta = document.createElement("meta");
      meta.httpEquiv = "Content-Security-Policy";
      meta.content = policy;
      meta.setAttribute("data-browser-seal", "");
      // The enforcement boundary: counting and guards start in the same task the policy goes in.
      const sealedAt = performance.now();
      const sealedAtEpoch = Date.now();
      startCounting(sealedAt);
      document.head.appendChild(meta);
      enforcing = true;
      update({ connectionsOpenAtSeal: tracked.filter((isOpen) => isOpen()).length });
      guardHints();
      if (!(await selfTest())) {
        throw new Error("This browser did not apply the seal, so no file has been opened. Please use an up-to-date Chrome, Edge, Firefox or Safari.");
      }
      const serviceWorker = worse(status.serviceWorker, await serviceWorkerState());
      keepLinksInNewTabs();
      update({ state: "sealed", sealedAt, policy, serviceWorker, sealedAtEpoch, sealedAtTime: new Date(sealedAtEpoch).toLocaleTimeString("en-GB") });
    } catch (error) {
      update({ state: "failed", error: error instanceof Error ? error.message : "The page could not be sealed." });
      throw error;
    }
  })();
  return sealing;
}

/**
 * After a failure, allow another attempt (for example once the connection is back for the
 * preparation step). A seal that took effect can never be undone, so this only helps when the
 * failure happened before sealing.
 */
export function canRetrySeal(): boolean {
  return status.state === "failed" && !document.head.querySelector("meta[data-browser-seal]");
}

export function resetFailedSeal() {
  if (!canRetrySeal()) return;
  sealing = undefined;
  update({ state: "open", error: undefined });
}
