# BUG-20261015-006: Deferred background registry construction leaked a service requirement

- **Scope:** Compatibility background registry's off-tree adoption of Session lifecycle ownership.
- **Observed:** Apexo typechecking reported a new `SessionLifecycle.Service` requirement escaping the deferred InstanceState factory.
- **Expected:** The constructed compatibility service retains the existing request environment contract.
- **Root cause:** Passing `BackgroundJob.makeOwned` into deferred InstanceState construction left its required global service unresolved until instance access.
- **Fix:** Capture the lifecycle service when constructing the application service, provide that captured service to the deferred factory, and declare the lifecycle node dependency.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the earlier draft factory.
- **Verification:** The isolated Apexo typecheck passed. The real owned-registry lifecycle tests passed, including detached owner cancellation and stale launch rejection. No live integration claim is made.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).
