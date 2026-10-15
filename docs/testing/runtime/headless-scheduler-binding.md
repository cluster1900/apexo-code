# BUG-20261015-240: Scheduler binding precedes headless policy selection

- Status: shared combined lifecycle and Scheduler gates passed.
- Scope: native Scheduler ownership binding combined with per-input headless execution.

## Observed and expected behavior

A real native control supplied with the headless execution policy successfully bound Scheduler timers. Separately, a saved due timer acquired an admitted child occurrence while a headless input completed. Both violate the unsupported detached-work boundary: headless input must neither bind a saved timer nor bypass the policy through direct binding.

## Reproduction and cause

Run `bun test test/v2/headless-scheduler.test.ts` from `packages/apexo`. Before the amendment, both tests failed (three assertions): direct binding returned Success, and the saved timer had an admitted occurrence instead of an empty occurrence list. The combined runner bound timers before canonical input promotion and policy selection; the runtime binding entrypoint did not check the headless policy.

## Fix

Move ordinary Scheduler binding after promotion and policy selection. Require no headless execution, no managed role, no captured Goal attempt, a real CurrentChildren capability, and no active Goal. The Location Scheduler runtime independently rejects direct binding under the Session's headless policy. Existing coordinator ownership and timer implementation remain unchanged.

## Verification

The same real-service tests passed: two tests, thirteen assertions. They cover direct denial, ordinary control binding without provider calls, no saved due occurrence during headless execution, later ordinary timer completion, and preservation of Stop-paused intent through another headless input. This verifies the private combined source, not an independently rebuilt shared Desktop artifact.

Shared composition subsequently passed these cases within the 60-test / 449-assertion lifecycle gate and the 18-test / 345-assertion Scheduler gate. All 21 refreshed typechecks and the shared Desktop build passed. Actual headless CLI acceptance remains a separate pending adapter phase.
