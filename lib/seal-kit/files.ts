/**
 * Seal kit: file fingerprints.
 *
 * A proof lists the SHA-256 fingerprint of each file it knows the page opened, never the
 * content. The kit knows a file in two ways only:
 * 1. the host application tells it, with recordFile() (any file the application opens itself);
 * 2. observeFileInputs() sees the user choose a file in an <input type="file"> or drop one on
 *    the page (in the main document; inputs inside a closed shadow root are not seen).
 * Files opened in any other way are not listed, and the proof says so.
 *
 * Each file records when it was opened (performance.now()) and is compared with the moment the
 * seal took effect when the proof is written. For observed inputs and drops, that is the time of
 * the user's action. A host must pass the time it actually opened the file, because hashing is
 * asynchronous and may finish long after. A file opened before sealing was held by an unsealed
 * page, so the Control Answers treat it as unsupported.
 */
import { sha256Hex } from "./jcs";
import { getSealStatus } from "./seal";

export type FileSource = "file-input" | "drop" | "host";
export type FileRecord = { name: string; sha256: string; source: FileSource; openedAfterSeal: boolean };

type Pending = { name: string; source: FileSource; openedAt: number; hash: Promise<string> };
const pending: Pending[] = [];

function checkTime(openedAt: number): number {
  if (typeof openedAt !== "number" || !Number.isFinite(openedAt)) throw new Error("openedAt must be the performance.now() time at which the file was opened.");
  return openedAt;
}

/**
 * Record a file the page opened. `openedAt` is the performance.now() time the application
 * opened it; omit it only when calling at the moment of opening. Hashing runs in the browser.
 */
export function recordFile(file: Blob & { name?: string }, options: { openedAt?: number; source?: FileSource } = {}): void {
  pending.push({
    name: file.name || "unnamed file",
    source: options.source ?? "host",
    openedAt: options.openedAt === undefined ? performance.now() : checkTime(options.openedAt),
    hash: file.arrayBuffer().then((bytes) => sha256Hex(bytes)),
  });
}

/** Record a fingerprint the host computed itself. `openedAt` (performance.now() at opening) is required. */
export function recordFingerprint(name: string, sha256: string, options: { openedAt: number }): void {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("A fingerprint must be 64 lower-case hex characters (SHA-256).");
  pending.push({ name, source: "host", openedAt: checkTime(options?.openedAt), hash: Promise.resolve(sha256) });
}

let observing = false;
/** Watch file inputs and drops in this document. Safe to call more than once. */
export function observeFileInputs(): void {
  if (observing || typeof document === "undefined") return;
  observing = true;
  document.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (input?.tagName === "INPUT" && input.type === "file" && input.files) for (const file of input.files) recordFile(file, { source: "file-input", openedAt: event.timeStamp || performance.now() });
  }, true);
  document.addEventListener("drop", (event) => {
    for (const file of event.dataTransfer?.files ?? []) recordFile(file, { source: "drop", openedAt: event.timeStamp || performance.now() });
  }, true);
}

/** All files recorded so far, with fingerprints. The same file chosen twice is listed once. */
export async function recordedFiles(): Promise<FileRecord[]> {
  const out: FileRecord[] = [];
  const seen = new Set<string>();
  const { sealedAt } = getSealStatus();
  for (const item of [...pending]) {
    const sha256 = await item.hash;
    const openedAfterSeal = sealedAt !== undefined && item.openedAt >= sealedAt;
    const key = `${item.name}\n${sha256}\n${openedAfterSeal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: item.name, sha256, source: item.source, openedAfterSeal });
  }
  return out;
}
