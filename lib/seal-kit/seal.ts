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
 * Requests made inside workers are not visible to the page's counter, which is why workers
 * must be started before sealing and served with their own policy that blocks network access.
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
  error?: string;
};

const PROBE_PATH = "/seal-self-test";

let status: SealStatus = { state: "open", requests: 0, blocked: 0, log: [] };
const listeners = new Set<(value: SealStatus) => void>();
let sealing: Promise<void> | undefined;

function update(change: Partial<SealStatus>) {
  status = { ...status, ...change };
  for (const listener of listeners) listener(status);
}

export function getSealStatus(): SealStatus {
  return status;
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
  sealing = (async () => {
    update({ state: "sealing", error: undefined });
    try {
      await prepare();
      await loadDeclaredFonts();
      const policy = sealPolicy(options);
      const meta = document.createElement("meta");
      meta.httpEquiv = "Content-Security-Policy";
      meta.content = policy;
      meta.setAttribute("data-browser-seal", "");
      document.head.appendChild(meta);
      if (!(await selfTest())) {
        throw new Error("This browser did not apply the seal, so no file has been opened. Please use an up-to-date Chrome, Edge, Firefox or Safari.");
      }
      const sealedAt = performance.now();
      startCounting(sealedAt);
      keepLinksInNewTabs();
      update({ state: "sealed", sealedAt, policy, sealedAtEpoch: Date.now(), sealedAtTime: new Date().toLocaleTimeString("en-GB") });
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
