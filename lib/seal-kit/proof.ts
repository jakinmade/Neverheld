/**
 * Seal kit: the proof.
 *
 * A proof is written by the sealed page when the user downloads their output (or chooses
 * "Download proof"). It records what the page observed while it held the user's files, which
 * release of the application was running, the files' SHA-256 fingerprints (never their
 * content), the Control Answers worked out from that evidence, and the limits.
 *
 * Format (documented in docs/SEAL-PROOF-FORMAT.md):
 *   { "format": "seal-kit-proof/1", "body": { ... }, "proofHash": { "alg": "SHA-256", "value": hex } }
 * proofHash is SHA-256 over the RFC 8785 canonical bytes of `body`. Changing any field of the
 * body, or adding a field outside it, makes the proof fail. The hash shows the proof is intact;
 * it is not a signature (a page cannot hold a secret key), so its strength comes from the
 * signed public release it names, which the verifier checks with the published key.
 */
import { canonicalHash, canonicalJson, ed25519Verify, sha256Hex } from "./jcs";
import { controlAnswers, rulesetFingerprint, type ControlAnswers, type Evidence, type WorkerEvidence } from "./control-answers";
import type { SealStatus, ServiceWorkerState } from "./seal";
import type { FileRecord } from "./files";

/** Format 2: worker, service worker and file evidence are recorded separately (Nov 2026). */
export const PROOF_FORMAT = "seal-kit-proof/2";

/** What the application owner says about its background workers. Never tested by the session. */
export type WorkerDeclaration = "none" | "blocked" | "not-declared";

export type ReleaseInfo = {
  /** e.g. "neverheld-1.0.22+0123456789ab" */
  id: string;
  /** SHA-256 of the release file list served by the site, or null if the site did not serve one. */
  manifestSha256: string | null;
  manifestFiles: number | null;
};

export type ProofBody = {
  format: string;
  nature: string;
  application: { name: string; version: string; commit: string };
  release: ReleaseInfo;
  seal: {
    state: "sealed";
    sealedAt: string;
    selfTest: "refused";
    policy: string;
    pageRequestsSinceSealing: number;
    blockedAttemptsSinceSealing: number;
    workers: { declaration: WorkerDeclaration; description: string; startedBeforeSeal: number; startedAfterSeal: number };
    serviceWorker: ServiceWorkerState;
  };
  /** How files came to be listed: observed inputs and drops, and/or the host's own records. */
  filesRecording: "observed-and-host" | "host-only";
  files: FileRecord[];
  controlAnswers: ControlAnswers;
  limits: string[];
  createdAt: string;
};

export type Proof = { format: string; body: ProofBody; proofHash: { alg: "SHA-256"; value: string } };

export const PROOF_LIMITS = [
  "Written by the page itself: evidence of what the page observed, not an independent audit.",
  "Browser extensions run outside any page's rules and are not covered.",
  "Moving the whole tab to another address is not covered by browser policy; the sealed page's links open in a new tab instead.",
  "Anything done in another browser tab is not covered.",
  "The proof hash shows only that the proof matches itself. Anyone can edit a proof and recompute the hash; compare it with a copy kept separately. It is not a signature.",
  "The proof does not show that the session took place. A signed release seal, when one is supplied, authenticates the released code it names, not the session.",
  "Workers started before NEVERHELD loaded cannot be seen by the page; for those the proof relies on the application owner's declaration, which the session does not test.",
  "Only files chosen in a file input, dropped on the page or recorded by the application are listed.",
  "The Control Answers are evidence for counsel, auditors and reviewers. They are not legal, audit or compliance opinions.",
];

/**
 * The only source expressions a sealed policy may contain. Anything else, a host of any form
 * (localhost, localhost:8080, an internal name, [::1], //host), a scheme or a wildcard, could
 * let the page reach an address. An allowlist, not a denylist: an unforeseen form fails.
 */
const SEALED_SOURCES = new Set(["'none'", "'unsafe-inline'", "'wasm-unsafe-eval'", "data:", "blob:"]);
/** Directives whose values are addresses, not sources: any value would send reports out. */
const ADDRESS_DIRECTIVES = new Set(["report-uri", "report-to"]);

function policyRefusesEveryAddress(policy: string): boolean {
  const directives = policy.split(";").map((part) => part.trim().split(/\s+/).filter(Boolean)).filter((parts) => parts.length > 0);
  const names = directives.map(([name]) => name.toLowerCase());
  if (new Set(names).size !== names.length) return false;
  const required = new Map([["default-src", "'none'"], ["connect-src", "'none'"], ["form-action", "'none'"]]);
  for (const [name, value] of required) {
    const directive = directives.find(([directiveName]) => directiveName.toLowerCase() === name);
    if (!directive || directive.length !== 2 || directive[1] !== value) return false;
  }
  return directives.every(([name, ...sources]) => !ADDRESS_DIRECTIVES.has(name.toLowerCase())
    && sources.every((source) => SEALED_SOURCES.has(source.toLowerCase()))
    && (!sources.some((source) => source === "'none'") || sources.length === 1));
}

/** The facts the Control Answers rest on, worked out from the proof body alone. */
export function workerEvidence(workers: ProofBody["seal"]["workers"]): WorkerEvidence {
  if (workers.declaration === "not-declared") return "not-declared";
  if (workers.declaration === "none" && workers.startedBeforeSeal > 0) return "contradicted";
  return workers.declaration === "none" ? "declared-none" : "declared-blocked";
}

export function evidenceFromBody(body: Pick<ProofBody, "seal" | "files">): Evidence {
  return {
    sealed: body.seal.state === "sealed",
    selfTestRefused: body.seal.selfTest === "refused",
    // Blocking fetches is not enough: a rule that still lets the page load an image or script
    // from any address, its own server included, does not block all connections.
    policyBlocksAllConnections: typeof body.seal.policy === "string" && policyRefusesEveryAddress(body.seal.policy),
    pageRequestsSinceSealing: body.seal.pageRequestsSinceSealing,
    blockedAttemptsSinceSealing: body.seal.blockedAttemptsSinceSealing,
    workers: workerEvidence(body.seal.workers),
    serviceWorker: body.seal.serviceWorker,
    filesFingerprinted: body.files.filter((file) => file.openedAfterSeal).length,
    filesOpenedBeforeSeal: body.files.filter((file) => !file.openedAfterSeal).length,
  };
}

export type BuildProofInput = {
  status: SealStatus;
  /** Files recorded by the kit (recordedFiles()) and/or the host. */
  files: FileRecord[];
  /** True when the kit was observing file inputs and drops. */
  observedFiles?: boolean;
  application: { name: string; version: string; commit: string };
  release: ReleaseInfo;
  workers: { declaration: WorkerDeclaration; description: string };
  createdAt?: Date;
};

/** Build the proof. Throws if the page is not sealed. */
export async function buildProof(input: BuildProofInput): Promise<Proof> {
  const { status } = input;
  if (status.state !== "sealed" || !status.sealedAtEpoch || !status.policy) throw new Error("The page is not sealed, so no proof can be written.");
  const seal: ProofBody["seal"] = {
    state: "sealed",
    sealedAt: new Date(status.sealedAtEpoch).toISOString(),
    selfTest: "refused",
    policy: status.policy,
    pageRequestsSinceSealing: status.requests,
    blockedAttemptsSinceSealing: status.blocked,
    workers: { declaration: input.workers.declaration, description: input.workers.description, startedBeforeSeal: status.workersStartedBeforeSeal, startedAfterSeal: status.workersStartedAfterSeal },
    serviceWorker: status.serviceWorker ?? "registered",
  };
  const files = input.files.map((file) => ({ name: file.name, sha256: file.sha256, source: file.source, openedAfterSeal: file.openedAfterSeal }));
  const body: ProofBody = {
    format: PROOF_FORMAT,
    nature: "Proof written by the sealed page. Check it with the offline verifier; it needs no contact with the vendor.",
    application: { ...input.application },
    release: { ...input.release },
    seal,
    filesRecording: input.observedFiles ? "observed-and-host" : "host-only",
    files,
    controlAnswers: await controlAnswers(evidenceFromBody({ seal, files })),
    limits: [...PROOF_LIMITS],
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
  return { format: PROOF_FORMAT, body, proofHash: { alg: "SHA-256", value: await canonicalHash(body) } };
}

/** The proof as written to file: canonical JSON, so the file's bytes are the same everywhere. */
export function proofJson(proof: Proof): string {
  return canonicalJson(proof);
}

// ---------------------------------------------------------------------------------------------
// Release seal (record seal format 2, as in CLEARANCE's assurance_kit/seal.py)
// ---------------------------------------------------------------------------------------------

export type ReleaseSeal = {
  seal_format_version: string;
  canonicalization: string;
  record: Record<string, unknown> & { key_id: string; release?: { id: string; manifest_sha256: string; manifest_files: number } };
  content_hash: { alg: string; value: string };
  signature: { alg: string; key_id: string; signed_message: string; value_b64: string };
  timestamps: Array<Record<string, string>>;
};

/** `unverified`: present but not checked by this verifier; shown as such, never as passed. */
export type Check = { name: string; ok: boolean; detail: string; unverified?: boolean };

/** Check a format-2 release seal. The public key must come from the published location, never the file. */
export async function verifyReleaseSeal(seal: ReleaseSeal, publicKeyB64: string): Promise<{ valid: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail = "") => { checks.push({ name, ok, detail }); return ok; };
  try {
    if (!add("Release seal is format 2", seal?.seal_format_version === "2" && seal.record?.seal_format_version === "2")) return { valid: false, checks };
    if (!add("Release seal uses RFC 8785 (JCS), SHA-256 and Ed25519", seal.canonicalization === "RFC 8785 (JCS)" && seal.content_hash?.alg === "SHA-256" && seal.signature?.alg === "Ed25519" && seal.signature?.signed_message === "content_hash.value (ASCII hex)",
      `${seal.canonicalization} / ${seal.content_hash?.alg} / ${seal.signature?.alg}`)) return { valid: false, checks };
    const recomputed = await canonicalHash(seal.record);
    if (!add("Release record is unchanged (content hash matches)", recomputed === seal.content_hash?.value, recomputed)) return { valid: false, checks };
    if (!add("Signature names the record's key", seal.signature?.key_id === seal.record.key_id, String(seal.record.key_id))) return { valid: false, checks };
    if (!add("Release signature is valid for the published key", await ed25519Verify(publicKeyB64, seal.signature.value_b64, seal.content_hash.value))) return { valid: false, checks };
    let timestampOk = false;
    for (const entry of seal.timestamps ?? []) {
      if (entry.content_hash !== seal.content_hash.value) { add(`Timestamp (${entry.type})`, false, "names a different hash"); continue; }
      if (entry.type === "self-asserted") {
        const message = canonicalJson({ content_hash: entry.content_hash, key_id: entry.key_id, time: entry.time, type: entry.type });
        const ok = entry.key_id === seal.record.key_id && await ed25519Verify(publicKeyB64, entry.signature_b64, message);
        add(`Signed release time ${entry.time}`, ok);
        timestampOk ||= ok;
      } else {
        checks.push({ name: `Independent timestamp (${entry.type}${entry.tsa ? `, ${entry.tsa}` : ""}): present, not verified here`, ok: true, unverified: true, detail: "this verifier does not check the token; check it with tools/coldcheck-release.sh and the TSA's CA certificate (see docs/PROOF-FORMAT.md)" });
      }
    }
    if (!add("Release has a valid signed time", timestampOk)) return { valid: false, checks };
    return { valid: true, checks };
  } catch (error) {
    add("Release seal could be read", false, error instanceof Error ? error.message : String(error));
    return { valid: false, checks };
  }
}

export type VerifyOptions = {
  /** The signed release seal published with the release (optional). */
  releaseSeal?: ReleaseSeal;
  /** The published release public key (raw Ed25519, base64). Required with releaseSeal. */
  publicKeyB64?: string;
  /** The release file list as served or published (optional). */
  manifestText?: string;
};

/**
 * Four separate questions, never collapsed into one "verified":
 * proof self-consistency, signed release authenticity, independent timestamp, session attestation.
 */
export type Assurance = {
  proofConsistent: boolean;
  release: "authentic" | "not-checked" | "failed";
  independentTimestamp: "not-verified";
  sessionAttestation: "not-provided";
};

export type VerifyResult = { valid: boolean; releaseChecked: boolean; checks: Check[]; assurance: Assurance };

/** Check a proof offline. Returns every check made, in order; `valid` only if all passed. */
export async function verifyProof(input: unknown, options: VerifyOptions = {}): Promise<VerifyResult> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail = "") => { checks.push({ name, ok, detail }); return ok; };
  let release: Assurance["release"] = "not-checked";
  let consistentUpTo = Infinity;
  const done = (releaseChecked = false): VerifyResult => ({
    valid: checks.every((check) => check.ok),
    releaseChecked,
    checks,
    assurance: {
      proofConsistent: checks.slice(0, consistentUpTo).every((check) => check.ok) && consistentUpTo !== Infinity,
      release,
      independentTimestamp: "not-verified",
      sessionAttestation: "not-provided",
    },
  });
  const proof = input as Proof;
  try {
    const keys = proof && typeof proof === "object" ? Object.keys(proof).sort().join(",") : "";
    if (!add("Proof has only the format, body and proof hash", keys === "body,format,proofHash", keys)) return done();
    if (!add(`Proof format is ${PROOF_FORMAT}`, proof.format === PROOF_FORMAT && proof.body?.format === PROOF_FORMAT, String(proof.format))) return done();
    const recomputed = await canonicalHash(proof.body);
    if (!add("Proof is unchanged (proof hash matches)", proof.proofHash?.alg === "SHA-256" && recomputed === proof.proofHash.value, recomputed)) return done();
    const ownFingerprint = await rulesetFingerprint();
    if (!add("Control Answers ruleset is one this verifier knows", proof.body.controlAnswers?.rulesetFingerprint === ownFingerprint, `${proof.body.controlAnswers?.rulesetVersion} ${proof.body.controlAnswers?.rulesetFingerprint}`)) return done();
    const expected = await controlAnswers(evidenceFromBody(proof.body));
    add("Control Answers are exactly what the rules give for this evidence", canonicalJson(expected) === canonicalJson(proof.body.controlAnswers));
    const seal = proof.body.seal;
    add("Page was sealed and the self-test was refused", seal.state === "sealed" && seal.selfTest === "refused");
    consistentUpTo = checks.length;
    add("No page request after sealing", seal.pageRequestsSinceSealing === 0, `requests ${seal.pageRequestsSinceSealing}, blocked ${seal.blockedAttemptsSinceSealing}`);
    if (options.manifestText !== undefined) {
      const manifestHash = await sha256Hex(options.manifestText);
      add("Release file list matches the one the page recorded", manifestHash === proof.body.release.manifestSha256, manifestHash);
    }
    if (options.releaseSeal) {
      if (!options.publicKeyB64) { add("Published release key supplied", false); return done(); }
      const releaseResult = await verifyReleaseSeal(options.releaseSeal, options.publicKeyB64);
      checks.push(...releaseResult.checks);
      release = "failed";
      if (releaseResult.valid) {
        const signed = options.releaseSeal.record.release;
        const named = add("Proof names this signed release", signed?.id === proof.body.release.id, `${proof.body.release.id} / ${signed?.id}`);
        const listed = add("Proof's release file list is the signed one", Boolean(proof.body.release.manifestSha256) && signed?.manifest_sha256 === proof.body.release.manifestSha256, String(proof.body.release.manifestSha256));
        if (named && listed) release = "authentic";
      }
      return done(true);
    }
    return done(false);
  } catch (error) {
    add("Proof could be read", false, error instanceof Error ? error.message : String(error));
    return done();
  }
}

/** Fetch the release file list the site serves (call before sealing). */
export async function fetchReleaseInfo(url: string, id: string): Promise<ReleaseInfo> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { id, manifestSha256: null, manifestFiles: null };
    const text = await response.text();
    const parsed = JSON.parse(text) as { release?: string; files?: unknown[] };
    return { id: parsed.release ?? id, manifestSha256: await sha256Hex(text), manifestFiles: Array.isArray(parsed.files) ? parsed.files.length : null };
  } catch {
    return { id, manifestSha256: null, manifestFiles: null };
  }
}
