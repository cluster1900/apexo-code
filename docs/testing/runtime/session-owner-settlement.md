# BUG-20261015-016: Draft Session retirement waited after its owner settled

- **Scope:** The off-tree native Session deletion draft, specifically `SessionLifecycle.run` owner settlement during recursive deletion.
- **Observed:** A deterministic real-application test held the first child's cancellation finalizer, independently deleted and recreated a sibling ID, then released the first child. Both ordinary owner wrapper fibers completed, but parent removal remained blocked beyond five seconds before deleting the first child's row. Instrumentation localized the wait to the registered owner stop, with zero active mutation leases. The simpler nested-retirement tests already passed.
- **Expected:** Both ordinary completion and deletion cancellation observe the same worker Exit after all its finalizers settle. Recursive deletion then completes while preserving an independently recreated root Session.
- **Root cause:** The draft observed one worker through separate ordinary `Fiber.join` and registered `Fiber.interrupt` wait paths. In the real-application scheduling context, the ordinary path settled while the registered interrupt waiter did not. The precise general behavior of the underlying Effect observer implementation has not been established; this record does not claim a general upstream defect.
- **Fix:** Install one completion observer and retain its Exit in a Deferred. Ordinary completion and every cancellation wait use that same finalizer-aware settlement. Cancellation still signals interruption first; registration failure and caller cancellation also await settlement before releasing ownership.
- **Reproduction:** In the deletion draft checkout, run `bun test test/session/child-reuse-removal.test.ts test/session/nested-retirement.test.ts` from `packages/apexo`. The child-reuse test uses real application services and held finalizers, without extending the failed timeout or weakening assertions.
- **Verification:** The copied final tests passed 3 tests and 15 assertions; the child-reuse case completed in approximately 70 ms. The combined lifecycle, removal, background, side-question, Memory, and Scheduler draft suite passed 52 tests and 247 assertions, including success/failure propagation after finalizers. Core and Apexo package typechecks passed before the final copied test typecheck.
- **Status:** Verified off-tree only. Production application and CLI/Desktop deletion acceptance remain pending.
- **Occurrences:** One draft integration failure, reproduced diagnostically. Diagnostic reruns are not additional occurrences.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).
