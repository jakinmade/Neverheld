# Security boundaries and claims

NEVERHELD records what a browser page observed after its seal took effect. It is not a packet-capture appliance, endpoint security product or independent audit.

## What the seal does
The page adds a Content Security Policy including `default-src 'none'`, `connect-src 'none'` and `form-action 'none'`. A self-test request must be refused and a browser policy-violation event must be observed before the state becomes sealed. The page then counts observed post-seal resource requests and counts CSP-blocked attempts separately.

## What it does not cover
- Requests, scripts or disclosures before sealing are not counted or undone.
- Service workers and dedicated or shared workers are not covered by the page's policy or counter. NEVERHELD detects a registered or controlling service worker, and workers started after it loads; either makes the Control Answers "not supported" unless the owner has declared worker policies. Workers started before NEVERHELD loaded cannot be seen. Blob workers started after sealing take the page's policy (tested).
- Browser extensions, other tabs, existing iframes, new windows opened by script, and browser storage read by a later unsealed visit are not covered.
- Whole-tab navigation is not reliably prevented by this page policy. Ordinary clicked links are opened in new tabs, but script-driven navigation is not comprehensively controlled.
- Browser vulnerabilities, hostile extensions, operating-system activity and network devices are outside page control.
- The page writes its own session proof. The proof hash can be recomputed by someone who edits the proof. A signed release authenticates released files, not the user's session.
- The seal does not prove data was not viewed, copied, held in memory or disclosed before sealing, or exposed through an ungoverned context.

## Claim wording
Use: "After sealing, the browser refused this page's network connections and resource requests; the page recorded zero successful post-seal requests."

Do not use: "No data could ever leave the device", "the vendor can never access customer data", "HIPAA compliant", "not a HIPAA business associate" or an unqualified assertion that no packet escaped.

Control Answers are evidence for counsel, auditors and reviewers, not legal, audit or compliance opinions.
