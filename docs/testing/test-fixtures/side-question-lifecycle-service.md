# BUG-20261015-008: Side-question fixture lacked its new lifecycle dependency

- **Scope:** Existing shared side-question unit fixture after the off-tree lifecycle integration.
- **Observed:** Apexo typechecking rejected all three test bodies because direct `SessionSideQuestion.make(db)` now required `SessionLifecycle.Service`, while the fixture supplied only Database.
- **Expected:** The fixture must provide the real lifecycle service consumed by the real side-question implementation.
- **Root cause:** The direct-construction fixture was not updated with the new explicit service requirement.
- **Fix:** Merge a scoped real `SessionLifecycle.make` layer with the existing in-memory Database layer. No mock or production fallback was added.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the earlier fixture and the new shared service.
- **Verification:** Apexo typechecking and all three existing side-question tests passed in the isolated draft. The added lifecycle/snapshot fixtures also passed four tests and 20 assertions.
- **Status:** Draft-only integration record; this is not an independent recurrence of omitted AppNode public outputs.

## Integrated verification

After application to the working branch, the combined focused package suite passed
58 tests with 259 assertions across 16 files. All 21 repository typecheck tasks
passed. The native CLI and rebuilt Desktop deletion acceptance each passed seven
scenarios. These are scoped integration results; complete repository gates and
UI acceptance are tracked in [the feature document](../../native-session-deletion.md).
