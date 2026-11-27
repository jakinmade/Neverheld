# NEVERHELD proof format

This extraction retains the open `seal-kit-proof/1` envelope.

The canonical JSON contains application identity, optional release-manifest identity, seal state and time, exact policy text, self-test result, page request and blocked-attempt counts, worker evidence, optional file fingerprints, six deterministic Control Answers, explicit limits, creation time and a SHA-256 hash over the RFC 8785 canonical body.

## Verification levels

**Proof consistency:** the verifier recomputes the body hash and the deterministic Control Answers. This catches accidental changes and inconsistent answers. Since the page writes the proof and the hash is in the same file, a deliberate editor can change the body and recompute the hash. It does not prove that the session occurred.

**Release authenticity:** with a separate release-seal file and NEVERHELD's published public key, the verifier can check the Ed25519 signature, signed release time and the release named by the proof. This authenticates released code, not an individual session.

The current browser verifier does not validate RFC 3161 timestamp-token trust chains.
