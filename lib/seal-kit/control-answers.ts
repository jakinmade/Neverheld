/**
 * Seal kit: Control Answers.
 *
 * A deterministic rules engine. It reads the evidence in a proof (what the sealed page
 * observed) and writes a short, fixed answer to questions that security reviewers, auditors
 * and counsel ask. Same evidence in, same answers out, every time: no model, no randomness,
 * no clock. The ruleset below is data; its SHA-256 fingerprint (over its RFC 8785 form) is
 * written into every proof, so a verifier can tell exactly which wording produced an answer.
 *
 * Wording rule: an answer states what the evidence supports for one session and what it does
 * not decide. It never gives a legal, audit or compliance opinion.
 */
import { canonicalHash } from "./jcs";

export type Evidence = {
  sealed: boolean;
  selfTestRefused: boolean;
  policyBlocksAllConnections: boolean;
  pageRequestsSinceSealing: number;
  blockedAttemptsSinceSealing: number;
  /** declared-none / declared-blocked come from the application owner and are not tested by the session. */
  workers: WorkerEvidence;
  /** A service worker runs outside the page's policy and can send whatever the page posts to it. */
  serviceWorker: "none" | "registered" | "controlling" | "not-available";
  filesFingerprinted: number;
  filesOpenedBeforeSeal: number;
  /** Long-lived connections opened before sealing and still open when it took effect. */
  connectionsOpenAtSeal: number;
  /** Attempts blocked inside the page (page-level, not browser-enforced). */
  guardBlocked: number;
  connectionAllowlist: "present" | "absent" | "not-checked";
};

export type WorkerEvidence = "declared-none" | "declared-blocked" | "not-declared" | "contradicted";

type Condition = { id: keyof Evidence; oneOf: Array<boolean | number | string>; failure: string };

type Pack = {
  id: string;
  name: string;
  question: string;
  supported: string;
  notSupported: string;
  limits: string;
};

/** The ruleset. Changing any character changes its fingerprint; bump `version` when you do. */
export const CONTROL_RULESET = {
  id: "seal-kit-control-answers",
  version: "3.1.0",
  conditions: [
    { id: "sealed", oneOf: [true], failure: "the page was not sealed" },
    { id: "selfTestRefused", oneOf: [true], failure: "the seal self-test was not refused by the browser" },
    { id: "policyBlocksAllConnections", oneOf: [true], failure: "the policy in force did not block all connections" },
    { id: "pageRequestsSinceSealing", oneOf: [0], failure: "the page made network requests after sealing" },
    { id: "serviceWorker", oneOf: ["none", "not-available"], failure: "a service worker was registered for or controlling the page, and a service worker is outside the page's rule" },
    { id: "workers", oneOf: ["declared-none", "declared-blocked"], failure: "background workers were not accounted for: the application owner did not declare them, or a worker was seen starting before the seal although none was declared" },
    { id: "filesOpenedBeforeSeal", oneOf: [0], failure: "a file was opened before the page was sealed" },
    { id: "connectionsOpenAtSeal", oneOf: [0], failure: "a request or connection (fetch, XHR, WebSocket, server-sent event, WebRTC or WebTransport) started before sealing was still in progress, and the page's rule does not stop it" },
  ] as Condition[],
  workerNote: {
    "declared-none": "The application owner declared that the page starts no background workers, and none was seen starting before the seal after NEVERHELD loaded; workers started before NEVERHELD loaded cannot be seen by the page.",
    "declared-blocked": "The application owner declared that the page's background workers are served with their own rule refusing network access; this session did not test that declaration.",
  } as Record<string, string>,
  guardNote: {
    zero: "NEVERHELD also blocks, inside the page, WebRTC and WebTransport connections started after sealing and removes speculative and connection hints added after sealing; none was attempted. That blocking is done by the page, not enforced by the browser: code written to get round it could do so, and Safari (WebKit) opens a preconnect connection before the hint can be removed.",
    nonZero: "NEVERHELD also blocked or removed, inside the page, {guardBlocked} WebRTC, WebTransport, speculative or connection-hint attempt(s) after sealing. That blocking is done by the page, not enforced by the browser: code written to get round it could do so, and Safari (WebKit) opens a preconnect connection before the hint can be removed.",
  },
  allowlistNote: {
    present: "A request to the page's own address, made before sealing, returned a Connection-Allowlist header. That is an unverified indication only: it does not confirm that the original page response carried the header, that its value is restrictive, or that the browser enforced it.",
    absent: "The page was not served with a Connection-Allowlist header, so routes outside the Content Security Policy rely on NEVERHELD's page-level blocking.",
    "not-checked": "Whether the page was served with a Connection-Allowlist header was not checked.",
  } as Record<string, string>,
  declarationNote: "This answer holds only if the application owner's declaration about its background workers is true; this session did not test it, and workers started before NEVERHELD loaded cannot be seen.",
  filesNote: {
    zero: "No file fingerprints were recorded, so this proof does not show which files, if any, the page processed.",
    nonZero: "{files} file fingerprint(s) were recorded for files opened after sealing; this proof records only their SHA-256 fingerprints, never their content. Files the application opened by other means are not listed.",
  },
  blockedNote: {
    zero: "No attempt to connect was made after sealing.",
    nonZero: "The browser refused {blocked} attempt(s) to connect after sealing; none was sent.",
  },
  sessionEvidence:
    "For this session, the browser enforced a Content Security Policy refusing the page's fetch, upload, beacon, WebSocket, server-sent event and form post connections and its image, script, style, font, frame and worker loads from any address; the seal self-test was refused, and the page made {requests} such requests after sealing. {blockedNote} {guardNote} {allowlistNote} No fetch, XHR or long-lived connection started after NEVERHELD loaded was still in progress when the seal took effect; requests started before NEVERHELD loaded cannot be seen. No service worker was registered for or controlling the page. {workerNote} {filesNote}",
  notSupportedLead: "The evidence does not support this for this session, because {reason}. Treat the session as one in which data may have left the page.",
  commonLimits:
    "Not covered: WebRTC, DNS lookups and connection hints, which the Content Security Policy does not govern, except as far as NEVERHELD's page-level blocking reaches (it does not reach code using another frame's copy of WebRTC or a reference saved before NEVERHELD loaded); connections opened before NEVERHELD loaded; the whole tab being moved to another address, or a new window or tab being opened, by a link or by a script, which browsers offer no rule to stop and which could carry data in the address; data the page keeps in browser storage, which a later unsealed visit could send; data passed to other tabs or frames; browser extensions; and activity before sealing. The page wrote this evidence itself; it is not an independent audit.",
  packs: [
    {
      id: "hipaa-business-associate",
      name: "HIPAA business associate",
      question: "Did the vendor create, receive, maintain or transmit protected health information (PHI) through this page?",
      supported: "{sessionEvidence} This supports a position that the vendor received no file content from this page by those routes in this session, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Whether a vendor is a HIPAA business associate is a legal decision for counsel. This answer is evidence for that decision, not the decision.",
    },
    {
      id: "washington-mhmda-sharing",
      name: "Washington My Health My Data Act",
      question: "Was consumer health data shared with a third party from the sealed page?",
      supported: "{sessionEvidence} This is evidence that the sealed page sent nothing by the routes listed above, to a third party or to the vendor, in this session, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Covers transmission from the sealed page only. It does not cover collection, consent or sharing by other systems, and it is not a compliance opinion.",
    },
    {
      id: "soc2-confidentiality",
      name: "SOC 2 Confidentiality",
      question: "Is confidential customer data protected from disclosure by this page?",
      supported: "{sessionEvidence} This supports scoping this page's handling of confidential files as browser-local, with the routes listed above refused, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Supports scoping and evidence requests. It is not a SOC 2 report or an auditor's opinion.",
    },
    {
      id: "vendor-questionnaire-data-access",
      name: "Vendor questionnaire: data access (SIG / CAIQ style)",
      question: "Does the vendor access, store or process customer data?",
      supported: "{sessionEvidence} The page sent nothing to the vendor by the routes listed above in this session, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Per-session evidence for this page, not a statement of the vendor's policies, staff access or other services.",
    },
    {
      id: "aba-rule-1-6-opinion-512",
      name: "ABA Model Rule 1.6 / Formal Opinion 512",
      question: "Was client information exposed to a third party or an AI service through this page?",
      supported: "{sessionEvidence} The routes listed above, to a third party, an AI service or the vendor, were refused in this session, so file content was not sent from the page by those routes. The limits below are outside this evidence.",
      notSupported: "{notSupportedLead}",
      limits: "Evidence for the lawyer's own judgement on confidentiality. It is not an ethics opinion and does not decide privilege.",
    },
    {
      id: "ftc-section-5-privacy-claim",
      name: "FTC Section 5 privacy claim",
      question: "Is the claim \"we never see your data\" true for this session?",
      supported: "{sessionEvidence} This is evidence that the claim held for the routes listed above in this session, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Evidence for one session only. It does not show the claim holds for other sessions, pages or services.",
    },
  ] as Pack[],
};

export type ControlAnswer = {
  pack: string;
  name: string;
  question: string;
  /** supported-if-declaration-holds: every observed condition held, but the answer also rests on the owner's untested worker declaration. */
  result: "supported" | "supported-if-declaration-holds" | "not-supported";
  answer: string;
  evidence: string[];
  limits: string;
};

export type ControlAnswers = {
  ruleset: string;
  rulesetVersion: string;
  rulesetFingerprint: string;
  answers: ControlAnswer[];
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}

export async function rulesetFingerprint(): Promise<string> {
  return canonicalHash(CONTROL_RULESET);
}

/** Answers for the given evidence. Pure and deterministic apart from hashing the ruleset. */
export async function controlAnswers(evidence: Evidence): Promise<ControlAnswers> {
  const rules = CONTROL_RULESET;
  const failed = rules.conditions.find((condition) => !condition.oneOf.includes(evidence[condition.id]));
  const blockedNote = fill(evidence.blockedAttemptsSinceSealing === 0 ? rules.blockedNote.zero : rules.blockedNote.nonZero, { blocked: String(evidence.blockedAttemptsSinceSealing) });
  const sessionEvidence = fill(rules.sessionEvidence, {
    requests: String(evidence.pageRequestsSinceSealing),
    blockedNote,
    workerNote: rules.workerNote[evidence.workers] ?? "",
    guardNote: fill(evidence.guardBlocked === 0 ? rules.guardNote.zero : rules.guardNote.nonZero, { guardBlocked: String(evidence.guardBlocked) }),
    allowlistNote: rules.allowlistNote[evidence.connectionAllowlist] ?? "",
    filesNote: fill(evidence.filesFingerprinted === 0 ? rules.filesNote.zero : rules.filesNote.nonZero, { files: String(evidence.filesFingerprinted) }),
  });
  const notSupportedLead = fill(rules.notSupportedLead, { reason: failed?.failure ?? "" });
  const evidenceLines = rules.conditions.map((condition) => `${condition.id}=${String(evidence[condition.id])}`)
    .concat([`blockedAttemptsSinceSealing=${evidence.blockedAttemptsSinceSealing}`, `guardBlocked=${evidence.guardBlocked}`, `connectionAllowlist=${evidence.connectionAllowlist}`, `filesFingerprinted=${evidence.filesFingerprinted}`]);
  // Any worker declaration (none or blocked) is the owner's and untested, so no answer is unconditional.
  const onDeclaration = !failed && (evidence.workers === "declared-blocked" || evidence.workers === "declared-none");
  return {
    ruleset: rules.id,
    rulesetVersion: rules.version,
    rulesetFingerprint: await rulesetFingerprint(),
    answers: rules.packs.map((pack) => ({
      pack: pack.id,
      name: pack.name,
      question: pack.question,
      result: failed ? "not-supported" : onDeclaration ? "supported-if-declaration-holds" : "supported",
      answer: fill(failed ? pack.notSupported : pack.supported, { sessionEvidence, notSupportedLead }) + (onDeclaration ? ` ${rules.declarationNote}` : ""),
      evidence: evidenceLines,
      limits: `${pack.limits} ${rules.commonLimits}`,
    })),
  };
}
