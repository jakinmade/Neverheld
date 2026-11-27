/**
 * Seal kit: canonical JSON (RFC 8785, JCS), SHA-256 and Ed25519 checks.
 *
 * Plain browser features only (Web Crypto), so the same code runs in the sealed page, in the
 * offline verifier page and in Node (version 20 or later). No dependencies.
 *
 * Canonical form: object keys sorted by UTF-16 code units, no whitespace, strings and numbers
 * written as ECMAScript JSON.stringify writes them (which is what RFC 8785 specifies). Only
 * whole numbers are allowed in sealed data, so standard tools (jq -cjS) give the same bytes.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Sealed data may contain whole numbers only.");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error(`Value of type ${typeof value} cannot be sealed.`);
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("This browser does not offer Web Crypto, which the seal kit needs.");
  return api;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const byte of view) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return toHex(await subtle().digest("SHA-256", copy));
}

export async function canonicalHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** Ed25519 check using Web Crypto. `publicKeyB64` is the raw 32-byte key in base64. */
export async function ed25519Verify(publicKeyB64: string, signatureB64: string, message: string | Uint8Array): Promise<boolean> {
  const decoded = base64ToBytes(publicKeyB64);
  if (decoded.length !== 32) return false;
  const raw = new Uint8Array(new ArrayBuffer(32)); raw.set(decoded);
  let key: CryptoKey;
  try {
    key = await subtle().importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
  } catch {
    throw new Error("This browser cannot check Ed25519 signatures. Use an up-to-date Chrome, Edge, Firefox or Safari, or the command-line check.");
  }
  const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const signature = base64ToBytes(signatureB64);
  const messageCopy = new Uint8Array(bytes.byteLength); messageCopy.set(bytes);
  const signatureCopy = new Uint8Array(signature.byteLength); signatureCopy.set(signature);
  return subtle().verify({ name: "Ed25519" }, key, signatureCopy, messageCopy);
}
