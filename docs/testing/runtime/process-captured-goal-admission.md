# Captured Goal attempt escaped the background Shell admission guard

- **Bug ID:** BUG-20261015-130
- **Scope:** Private native background Shell worker draft.
- **Status:** Corrected and verified at the real worker boundary.
- **Independent occurrences:** One.

The initial guard rejected stored active Goals but did not inspect the current provider turn's captured Goal attempt. A real fixture created a Goal, began an executing attempt, paused the stored Goal, and called background-capable Shell under that captured attempt. It returned Success instead of Failure and reached command execution. This permits work to outlive the accounting owner even though the stored status has changed.

The guard now rejects `SessionGoalUsage.Current` before durable receipt admission or spawn, in addition to private managed-child ownership and stored active Goal checks. This follows the existing native Task boundary. Ordinary paused Sessions without a captured attempt remain allowed: `SessionGoalRunner.open` claims only active Goals, so a blanket paused-Goal ban would prohibit supported ordinary work.

Verification from `packages/apexo`: `bun test test/v2/process-execution.test.ts` passed one test / 42 assertions. The new case checks failure, zero command side-effect file and unchanged receipt list, then proves an ordinary paused Session command succeeds. The first attempt to run this added test stopped at a separate fixture service-output error, tracked as the sixth BUG134 occurrence; it was not evidence for this accounting defect. Core typechecking passed after the related runner error-channel integration.

Shared integration verification: all 21 workspace typechecks passed, and the combined native Shell/media/Plan suite passed 68 tests / 623 assertions. Shared CLI and freshly rebuilt Desktop passed Shell nine checks / 26 calls each and media-options five checks / eight calls each. These are scoped gates; the earlier full-unit checkpoint is not claimed for the later integration.
