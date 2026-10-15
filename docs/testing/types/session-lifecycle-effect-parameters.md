# BUG-20261015-004: Lifecycle wrappers narrowed Effect.fn parameter tuples

- **Scope:** Off-tree Session lifecycle wrappers around existing Effect functions.
- **Observed:** Initial Core/Apexo package typechecks rejected wrappers whose postprocessor dropped a trailing argument or inferred an optional boolean as required.
- **Expected:** Adding lifecycle ownership preserves the original callable parameter tuple, including optional `resume` and `interrupted` arguments.
- **Root cause:** The Effect.fn postprocessor participates in parameter inference; an incomplete or narrower callback signature changed the inferred function contract.
- **Fix:** Preserve all positional parameters and explicitly type the optional trailing boolean parameters as optional.
- **Reproduction:** Run `bun typecheck` from the affected package in the earlier isolated deletion draft.
- **Verification:** Core and Apexo package typechecks passed after the corrected postprocessor signatures and other separately recorded draft fixes. No live source was changed during this verification.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).
