# BUG-20261015-132: Keyed local-video renderer omitted its child argument

- **Scope:** Private Session UI media attachment draft.
- **Observed:** App and Session UI typechecks reported TS2769: a zero-argument `() => JSX.Element` did not satisfy the keyed `Show` child overload.
- **Expected:** Changing the saved media URI remounts its ownership boundary, aborting the old read and revoking its Blob URL, with correctly typed rendering.
- **Root cause:** The keyed conditional render callback omitted the required keyed value parameter.
- **Fix:** Consume the keyed URL argument and pass it to the mounted attachment. No type casts or error suppression were introduced.
- **Verification:** Both package `bun typecheck` commands pass after the correction. The original failures are retained as one type-authoring episode, not two independent bugs. Final rebuilt browser and actual Electron renderer rechecks each pass twelve media checks.
