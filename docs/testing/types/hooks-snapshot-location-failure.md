# BUG-20261014-110: Snapshot registration error leaked through Location construction

- Scope: HookSnapshotLocation layer and unrelated native Session revert APIs.
- Observed: Core typechecking after native integration reported `HookSnapshotFailure` in Location construction, widening revert stage/clear beyond their declared errors.
- Expected: Snapshot capture/reload failures remain typed operation errors; initialization has an explicit lifecycle failure policy.
- Root cause: Scoped owner registration can reject a closed global service, and the Location layer unintentionally exposed this registration error through every Location consumer.
- Fix: Treat registration against an already closed service as a layer initialization defect via `Effect.orDie`; keep capture/reload failures typed.
- Reproduction: Run `bun typecheck` from `packages/core` with native snapshot bridge wiring before the fix.
- Verification: Integrated Core `bun typecheck` exited 0 after correction. One observed integration failure; no recurring rule promoted.
