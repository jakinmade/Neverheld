# AI-assisted development disclosure

For buyer due diligence.

- NEVERHELD was extracted from John Akinmade's EXEVVIA codebase (v1.0.29, commit `17d4e4f`). The extraction and initial packaging were carried out with the help of an AI assistant, under John's direction.
- On 27 Nov 2026 Claude (an Anthropic AI model) carried out the review in `docs/REVIEW-FINDINGS.md`. Claude wrote the fixes and regression tests, the Next.js fixture, the release packaging, signing and reproducibility tooling, and these documents, on branch `build/phase-1-core-extraction`.
- Every change was checked by automated tests (unit, CLI and real-browser), and failures were reproduced before fixing. That is not the same as human expert review: an independent security audit has not been done and is recommended before sale.
- No third-party source code was copied into the runtime.
