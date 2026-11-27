# NEVERHELD — standalone sale-readiness

## Product and sales route

NEVERHELD is a standalone, licensable browser SDK/software kit, not a hosted SaaS dependency and not an EXEVVIA feature. Buyers should be able to embed the one-file runtime into their own application and validate each proof offline. EXEVVIA is a useful live reference/demo and provenance source, but the kit must not need EXEVVIA at runtime.

The v0.5 product spec identifies likely first buyer groups as client-side security vendors, trust-centre/questionnaire platforms, US health-tech vendors with browser workflows, and legal-tech vendors. The suggested first commercial conversation is a paid pilot converting to an embedding licence; outright IP sale is a separate, slower route. These are target segments, not validated demand. No buyer willingness to pay has yet been established.

## Current technical baseline

The branch has a one-file browser runtime, seal self-test, page request and blocked-attempt counters, canonical JSON proof, six deterministic Control Answer packs, readable HTML proof, a separate QR/ZIP proof renderer, an offline verifier, CLI/cold-check scripts, plain HTML example and Chromium CI.

Latest verified run at the current code baseline: https://github.com/jakinmade/Neverheld/actions/runs/46070302669

This establishes a working technical baseline. It is not yet a complete distributable release or independently audited security product.

## Outstanding before sale-ready demo / serious buyer diligence

1. Fix and independently validate the meaning of worker coverage and missing file fingerprints in one-tag proof.
2. Align the QR flow with the actual offline-verifier claim.
3. Complete signed release manifest, dedicated NEVERHELD Ed25519 key, reproducible build, public timestamp and independent timestamp trust validation.
4. Test plain HTML and a real Next.js host across Chromium, Firefox and WebKit; validate worker/service-worker/frame limitations and fail-closed behaviour.
5. Produce a clean standalone release archive, lockfile and checksums. The one-script installation must not require buyers to build the repository.
6. Build a self-contained demo workflow. EXEVVIA may be used to demonstrate realistic use, but never as a runtime dependency.
7. Complete source provenance and third-party licence review, explicit commercial licence, support/maintenance terms and AI-assisted development disclosure.
8. Obtain a US privacy counsel review of the Control Answers. Get a quote for independent security testing.
9. Check name/domain/trademark availability and agree the first pilot fee before outreach.

## Buyer proposition and limits

The product's differentiator is not a claim that the page never sees the data or that every network packet is measured. It is a browser-enforced page-level network restriction after sealing, a self-test that must pass, per-session browser observations, deterministic evidence mapped to named control questions, and customer-held proof that can be checked offline.

The proof is written by the page; it is not a cryptographically signed session attestation. Browser extensions, other tabs, whole-tab navigation, activity before sealing and workers not separately configured/tested remain outside the page seal's evidence. Control Answers support counsel and auditors; they are not HIPAA, MHMDA, SOC 2 or legal determinations.

## Sale options

- Paid pilot: fixed-fee use in one buyer product for 60–90 days, converting to an embedding licence.
- Licence / white-label: buyer embeds NEVERHELD and its control packs; seller retains the IP and agrees updates/support.
- Outright IP sale: source, proof format, verifier, control packs and agreed brand/IP rights, with a separately negotiated licence-back if required.

Pricing is not set in the v0.5 spec. Agree a pilot fee before buyer calls and use the first two or three conversations to calibrate licence pricing.
