# BUG-20261015-370: Batch capture trigger referenced the wrong admission service binding

- **Scope:** New native batch Dream dispatch after a successful live capture.
- **Observed:** Manual batch tests passed, but the real automatic capture fixture completed its main turn and capture without a Dream receipt; the ten-second operation readiness poll failed.
- **Expected:** Eligible batch Dream admits under the current Session input epoch and canonical admission fence.
- **Root cause:** The new branch referred to `admission`, while this service binds the canonical dependency as `inputAdmission`. The defect occurred after capture settlement, so no automatic Dream was admitted.
- **Fix:** Use `inputAdmission.fence` with the captured epoch, current-token check and pending-input check. No fallback executor or passive restart rearming was introduced.
- **Verification:** From `packages/apexo`, `bun test test/v2/memory-batch-dream-native.test.ts --test-name-pattern 'automatic batch'` passed one test / four assertions: 20 eligible notes consolidated after one main turn and one capture, with one batch provider reply. The final seven-file batch/default Dream/consolidation/grep aggregate passed 57 tests / 279 assertions, including the automatic input/publication cancellation control. Package type checks are recorded separately in the handoff.
- **Occurrences:** One observed draft implementation defect; missing feature scope and repeated diagnostic runs are not additional occurrences.
