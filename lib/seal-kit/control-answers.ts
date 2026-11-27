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
  workersNetwork: "configured" | "not-declared";
  filesFingerprinted: number;
};

type Condition = { id: keyof Evidence; equals: boolean | number | string; failure: string };

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
  version: "1.1.0",
  conditions: [
    { id: "sealed", equals: true, failure: "the page was not sealed" },
    { id: "selfTestRefused", equals: true, failure: "the seal self-test was not refused by the browser" },
    { id: "policyBlocksAllConnections", equals: true, failure: "the policy in force did not block all connections" },
    { id: "pageRequestsSinceSealing", equals: 0, failure: "the page made network requests after sealing" },
    { id: "workersNetwork", equals: "configured", failure: "background workers were not configured to be blocked from the network" },
  ] as Condition[],
  blockedNote: {
    zero: "No attempt to connect was made after sealing.",
    nonZero: "The browser refused {blocked} attempt(s) to connect after sealing; none was sent.",
  },
  sessionEvidence:
    "For this session, the browser enforced a rule refusing the page's network connections and resource requests (fetch, upload, beacon, socket, form post, and image, script, style, font and worker loads from any address), the seal self-test was refused, and the page made {requests} network requests after sealing. {blockedNote} The background workers were configured, by the rule they are served with, to be refused network access; this session did not test them (the release's live seal check does). The {files} file(s) were processed inside the browser tab; this proof records only their SHA-256 fingerprints, never their content.",
  notSupportedLead: "The evidence does not support this for this session, because {reason}. Treat the session as one in which data may have left the page.",
  commonLimits:
    "Not covered: the whole tab being moved to another address, by a link or by a script, which browsers offer no rule to stop and which could carry data in the address; browser extensions; and other browser tabs. The page wrote this evidence itself; it is not an independent audit.",
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
      supported: "{sessionEvidence} This is evidence that the sealed page sent nothing by network connection or resource request, to a third party or to the vendor, in this session, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Covers transmission from the sealed page only. It does not cover collection, consent or sharing by other systems, and it is not a compliance opinion.",
    },
    {
      id: "soc2-confidentiality",
      name: "SOC 2 Confidentiality",
      question: "Is confidential customer data protected from disclosure by this page?",
      supported: "{sessionEvidence} This supports scoping this page's handling of confidential files as browser-local, with network connections and resource requests from the page refused by the browser, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Supports scoping and evidence requests. It is not a SOC 2 report or an auditor's opinion.",
    },
    {
      id: "vendor-questionnaire-data-access",
      name: "Vendor questionnaire: data access (SIG / CAIQ style)",
      question: "Does the vendor access, store or process customer data?",
      supported: "{sessionEvidence} The files were processed in the user's browser, and the page sent nothing to the vendor by network connection or resource request, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Per-session evidence for this page, not a statement of the vendor's policies, staff access or other services.",
    },
    {
      id: "aba-rule-1-6-opinion-512",
      name: "ABA Model Rule 1.6 / Formal Opinion 512",
      question: "Was client information exposed to a third party or an AI service through this page?",
      supported: "{sessionEvidence} The page's network connections and resource requests, to a third party, an AI service or the vendor, were refused by the browser in this session, so file content was not sent from the page by those routes. The limits below are outside this evidence.",
      notSupported: "{notSupportedLead}",
      limits: "Evidence for the lawyer's own judgement on confidentiality. It is not an ethics opinion and does not decide privilege.",
    },
    {
      id: "ftc-section-5-privacy-claim",
      name: "FTC Section 5 privacy claim",
      question: "Is the claim \"we never see your data\" true for this session?",
      supported: "{sessionEvidence} This is evidence that the claim held for this page's network connections and resource requests in this session, subject to the limits below.",
      notSupported: "{notSupportedLead}",
      limits: "Evidence for one session only. It does not show the claim holds for other sessions, pages or services.",
    },
  ] as Pack[],
};

export type ControlAnswer = {
  pack: string;
  name: string;
  question: string;
  result: "supported" | "not-supported";
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
  const failed = rules.conditions.find((condition) => evidence[condition.id] !== condition.equals);
  const blockedNote = fill(evidence.blockedAttemptsSinceSealing === 0 ? rules.blockedNote.zero : rules.blockedNote.nonZero, { blocked: String(evidence.blockedAttemptsSinceSealing) });
  const sessionEvidence = fill(rules.sessionEvidence, {
    requests: String(evidence.pageRequestsSinceSealing),
    blockedNote,
    files: String(evidence.filesFingerprinted),
  });
  const notSupportedLead = fill(rules.notSupportedLead, { reason: failed?.failure ?? "" });
  const evidenceLines = rules.conditions.map((condition) => `${condition.id}=${String(evidence[condition.id])}`)
    .concat([`blockedAttemptsSinceSealing=${evidence.blockedAttemptsSinceSealing}`, `filesFingerprinted=${evidence.filesFingerprinted}`]);
  return {
    ruleset: rules.id,
    rulesetVersion: rules.version,
    rulesetFingerprint: await rulesetFingerprint(),
    answers: rules.packs.map((pack) => ({
      pack: pack.id,
      name: pack.name,
      question: pack.question,
      result: failed ? "not-supported" : "supported",
      answer: fill(failed ? pack.notSupported : pack.supported, { sessionEvidence, notSupportedLead }),
      evidence: evidenceLines,
      limits: `${pack.limits} ${rules.commonLimits}`,
    })),
  };
}
