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
 * Each file records whether the page was already sealed when it was opened. A file opened
 * before sealing was held by an unsealed page, so the Control Answers treat it as unsupported.
 */
import { sha256Hex } from "./jcs";
import { getSealStatus } from "./seal";

export type FileSource = "file-input" | "drop" | "host";
export type FileRecord = { name: string; sha256: string; source: FileSource; openedAfterSeal: boolean };

type Pending = { name: string; source: FileSource; openedAfterSeal: boolean; hash: Promise<string> };
const pending: Pending[] = [];

function isSealed(): boolean {
  return getSealStatus().state === "sealed";
}

/** Record a file the page opened. Hashing starts now and runs inside the browser. */
export function recordFile(file: Blob & { name?: string }, source: FileSource = "host"): void {
  pending.push({
    name: file.name || "unnamed file",
    source,
    openedAfterSeal: isSealed(),
    hash: file.arrayBuffer().then((bytes) => sha256Hex(bytes)),
  });
}

/** Record a fingerprint the host computed itself. */
export function recordFingerprint(name: string, sha256: string): void {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("A fingerprint must be 64 lower-case hex characters (SHA-256).");
  pending.push({ name, source: "host", openedAfterSeal: isSealed(), hash: Promise.resolve(sha256) });
}

let observing = false;
/** Watch file inputs and drops in this document. Safe to call more than once. */
export function observeFileInputs(): void {
  if (observing || typeof document === "undefined") return;
  observing = true;
  document.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (input?.tagName === "INPUT" && input.type === "file" && input.files) for (const file of input.files) recordFile(file, "file-input");
  }, true);
  document.addEventListener("drop", (event) => {
    for (const file of event.dataTransfer?.files ?? []) recordFile(file, "drop");
  }, true);
}

/** All files recorded so far, with fingerprints. The same file chosen twice is listed once. */
export async function recordedFiles(): Promise<FileRecord[]> {
  const out: FileRecord[] = [];
  const seen = new Set<string>();
  for (const item of [...pending]) {
    const sha256 = await item.hash;
    const key = `${item.name}\n${sha256}\n${item.openedAfterSeal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: item.name, sha256, source: item.source, openedAfterSeal: item.openedAfterSeal });
  }
  return out;
}
