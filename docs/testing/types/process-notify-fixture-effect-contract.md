# Shell diagnostic notifier returned an unsupported error channel

- **Bug ID:** BUG-20261015-128
- **Scope:** Private real-process lifecycle fixture only.
- **Status:** Corrected and verified.
- **Independent occurrences:** One; no recurring constraint.

The expanded worker test passed at runtime, but Apexo typechecking reported TS2322: its receipt-inspecting `notify` callback returned `Closed | SessionProcessFailure` while the native coordinator capability intentionally requires `Effect<void, never>`. The fixture had added a fallible diagnostic read without settling that diagnostic error channel.

The callback now applies `Effect.orDie` to the assertion-only receipt read. Unexpected read failure still fails the test; it cannot become a recoverable production notifier error. The production advisory capability remains unchanged. This differs from the guarded-property narrowing issue in BUG117 and the conditional generic inference issue in BUG005.

Verification: `bun typecheck` from `packages/apexo` passed after correction. The actual owner test passed one test / 38 assertions, including receipt-before-notice ordering, same-PID timed promotion, cancellation, Session deletion and Location invalidation. No mocked process or duplicate runtime implementation was introduced.

Shared integration verification: all 21 workspace typechecks passed, and the combined native Shell/media/Plan suite passed 68 tests / 623 assertions. Shared CLI and freshly rebuilt Desktop passed Shell nine checks / 26 calls each and media-options five checks / eight calls each. These are scoped gates; the earlier full-unit checkpoint is not claimed for the later integration.
