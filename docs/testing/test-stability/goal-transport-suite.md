# INVESTIGATION-20261014-002: Goal Suite Model Request Failure Without Recorded Usage

- **Status**: Investigating; root cause unconfirmed.
- **Scope**: Integration tests for continuing execution after auto-denial and background notification after Goal completion.
- **Observed**: In one full-suite run, two scenarios entered `infra_paused` during planning with 0 recorded usage and `usageIncomplete=true` (312 passed, 1 skipped, 2 failed).
- **Expected**: The test model server returns the expected report tool call and token usage; if a real transport failure occurs, the Goal pauses and preserves `usageIncomplete`.
- **Reproduction**: Run the full suite command in [goal-suite-timeout.md](goal-suite-timeout.md). Running `bun test test/session/prompt.test.ts --test-name-pattern '(goal|Goal)'` in isolation passed 15/15, and subsequent full-suite diagnostic runs passed 314/314.
- **Investigation Notes**: Added child-session transport error and request count diagnostics on failure to inspect cross-file test ordering if the issue recurs.
