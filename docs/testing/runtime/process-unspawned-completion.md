# Failed Shell startup emitted a background completion

- **Bug ID:** BUG-20261015-125
- **Scope:** Private native background Shell worker; not a shipped defect.
- **Status:** Corrected and verified in the isolated implementation.
- **Independent occurrences:** One.

The real worker test launched a nonexistent shell. Startup correctly returned a typed failure and stored a failed receipt, but the completion service also called its parent notifier. The observed sequence was `completed, failed` instead of only the earlier successful `completed` notification. The added assertion failed one test with 20 assertions.

Notice eligibility checked background and terminal status but omitted the successful-spawn receipt. The store now requires `spawned`, intended background status and a non-cancelled terminal state. Failed startup remains readable for diagnostics and never creates an autonomous completion wake. Foreground completion likewise remains ordinary tool settlement.

Verification from `packages/apexo`: `bun test test/v2/process-execution.test.ts test/v2/process-store.test.ts test/v2/process-output.test.ts test/tool/native-process-observer.test.ts` passed 12 tests / 112 assertions. An expanded owner test then passed one test / 38 assertions, adding same-PID timed promotion, accepted-Stop suppression, Session deletion and Location invalidation cleanup. The startup assertion joins the BackgroundJob result before inspecting notifications. Core typechecking passed; final expanded fixture typechecking is recorded with its own authoring correction.

Shared integration verification: all 21 workspace typechecks passed, and the combined native Shell/media/Plan suite passed 68 tests / 623 assertions. Shared CLI and freshly rebuilt Desktop passed Shell nine checks / 26 calls each and media-options five checks / eight calls each. These are scoped gates; the earlier full-unit checkpoint is not claimed for the later integration.
