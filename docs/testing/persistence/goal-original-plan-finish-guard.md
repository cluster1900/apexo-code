# BUG-20261014-256: Worker finish receipts could replace the original Goal plan

- **Scope:** Shared `SessionGoal.finish` state mutation.
- **Status:** Fixed; focused regression and native CLI report-hash checks passed.
- **Observed:** Source review found that any accepted executing attempt could
  supply `result.plan`; the finish path copied it into `Goal.Info.plan`. This
  bypassed the intended once-only planner contract. The finding is static; no
  historical production occurrence is asserted.
- **Expected:** Only the initial planner may establish the original plan. Worker
  progress and deviations cannot replace it or change finalized report hashes.
- **Reproduction:** Finish a real planner attempt, begin an executing worker,
  then call `finish` with a different `plan`. It must return a typed invalid
  conflict before settling the attempt or changing the Goal.
- **Root cause:** `Finish` validated plan text shape but not the role that could
  supply it or the already-established immutable plan value.
- **Fix:** Reject plan-bearing non-planner receipts and any planner receipt that
  replaces an existing original plan with different text. Keep progress in the
  bounded separate `planProgress` state.
- **Verification:** The real persisted-state test rejects a worker replacement
  and verifies the original plan remains unchanged. The six-file regression passed
  180 tests, one existing skip and 1,104 assertions. All three native CLI scenarios
  read finalized planner/verifier reports and confirm their plan text and SHA-256
  hashes still match the original. Independent verification still decides completion.
