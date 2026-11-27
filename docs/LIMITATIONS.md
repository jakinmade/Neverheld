# What NEVERHELD does not establish

State these to every buyer.

- **The session took place.** The page writes its own proof. The proof hash can be recomputed by anyone who edits it. It is not a signed session attestation.
- **Anything before sealing.** Requests, scripts and disclosures before the seal are not counted or undone. A file opened before sealing makes the answers "not supported".
- **Untested worker declarations.** A declaration that workers are blocked gives "supported if the owner's declaration holds", never plain "supported".
- **Workers started before NEVERHELD loaded**, or through a reference saved earlier. These cannot be seen; the proof relies on the owner's declaration, and says it was not tested.
- **Service workers.** They cannot be governed by the page. If one is registered or in control, the answers are "not supported".
- **Routes outside the Content Security Policy.** WebRTC, connection hints and DNS lookups are not governed by CSP. NEVERHELD blocks WebRTC and removes hints inside the page, which is page-level blocking and can be evaded. Measured limits: WebRTC through an iframe's own copy reaches the network in Chromium, Firefox and WebKit; Safari (WebKit) opens a preconnect connection before the hint can be removed; DNS prefetch is switched off but has not been measured. The browser-enforced control is a `Connection-Allowlist` response header served by the application (Chrome 152 and later only). See the table in `SECURITY-BOUNDARIES.md`.
- **Connections opened before NEVERHELD loaded.** A WebSocket or WebRTC connection opened earlier keeps working after sealing and cannot be seen. Ones opened after NEVERHELD loaded and still open at sealing are detected, and make the answers "not supported".
- **Whole-tab navigation and new windows.** Moving the tab, or opening a new window or tab, can carry data in the address. Browsers offer no rule to stop it.
- **Browser storage.** Data the page writes to storage could be sent by a later, unsealed visit.
- **Other tabs, frames and extensions.** Data passed to them (for example by `BroadcastChannel` or `postMessage`) and extensions themselves are outside the page's rule.
- **Files opened by other routes.** Only file inputs, drops and files the host records are listed.
- **Legal conclusions.** Control Answers are evidence for counsel and auditors. They are not HIPAA, MHMDA, SOC 2, ethics or FTC determinations.
- **Independent audit.** None has been done.
- **Release identity.** Until a NEVERHELD release key is generated and published, no release can be checked as authentic.
- **QR route.** The QR code opens a hosted copy of the verifier, which needs a connection. The offline route is the verifier file.
