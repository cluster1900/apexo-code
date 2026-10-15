# BUG-20261015-073: Task compaction fixture could not fit its own summary

- **Scope:** Native Task Goal-accounting fixture, isolated implementation.
- **Status:** Verified fixture correction.
- **Observed:** The ordinary child case correctly reached eleven accounted tokens. The compaction case used context capacity 1 and expected a tool-free summary request and thirteen tokens, but reached `infra_paused` with six known tokens. The provider fixture's summary assertion failed when the ordinary child request arrived.
- **Expected:** The model must have enough capacity for the summary request while its full system/tool request exceeds that capacity, so the test exercises successful automatic compaction.
- **Root cause:** The synthetic one-token context could not fit the compaction prompt. The existing compactor correctly declined that unavailable operation. The fixture's provider assertion then failed and the Goal correctly retained an incomplete-usage infrastructure outcome.
- **Fix:** Use context 4000 and output 256 for the child-only model. Keep zero retained tokens and the actual wire assertion that the summary request has no tools. The ordinary parent model remains large enough to avoid incidental compaction.
- **Verification:** `bun test test/e2e/v2-task-goal.e2e.test.ts` passed 1 test/15 assertions. The normal child and compaction cases stop the owning Goal at eleven and thirteen actual tokens respectively against budget eight, each after four provider calls. No evaluator or extra child provider turn begins. No product budget, context, or schema behavior changed.
