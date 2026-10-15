# BUG-20261015-262: Ineligible automatic Dream created durable no-work operations

- **Scope:** Private Stage 2 automatic follow-up after native terminal capture.
- **Observed:** The existing Stage 1 ordinary-capture regression expected two capture receipts but found three operation receipts. Provider calls remained correct: the extra row was an ineligible Dream that later settled no-work. The combined gate had 66 passing tests and this one failure.
- **Cause:** Eligibility was checked only after durable Dream admission, although automatic admission itself is conditional on the configured threshold.
- **Fix:** Check canonical eligibility before admitting an automatic Dream, and retain the execution-time recheck for changes between admission and execution. Manual Dream continues to bypass only eligibility. The unchanged Stage 1 exact-count assertion is retained.
- **Review refinement:** Follow-up preparation uses the Location runtime guard. A result already durably settled is not overwritten if later follow-up work is interrupted; this was review-driven, not a separately reproduced historical failure.
- **Verification:** The unchanged ordinary-terminal capture case passed after the correction. Full final scoped results are recorded in the Stage 2 feature document. Run `bun test test/v2/memory-lifecycle-native.test.ts test/v2/memory-dream-native.test.ts` from `packages/apexo`.
