# BUG-20261015-007: Memory worker annotation still required an infinite result

- **Scope:** Off-tree compatibility Memory capture worker lifecycle.
- **Observed:** Apexo typechecking rejected a worker fiber typed `Fiber<never>` after its lifecycle-closed branch gained a graceful `void` exit.
- **Expected:** The stored worker type reflects cancellation/revocation termination.
- **Root cause:** The annotation described the old forever loop rather than the new handled exit path.
- **Fix:** Use `Fiber<void>` for the worker. Keep the actual loop and cancellation ownership intact.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the old worker annotation and new lifecycle handler.
- **Verification:** The isolated Apexo package typecheck passed after this and the separately recorded draft fixes. This was a compile-time draft integration defect.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).
