# BUG-20261014-074: Empty Stop context blocked native provider initialization

- **Scope:** Native Session system-context initialization, including Workflow and sessions without pending Stop hooks.
- **Observed:** The independent native Workflow integration failed before provider execution because `session/stop-hook` rendered an empty baseline.
- **Expected:** An inactive context source has a valid nonempty neutral rendering, allowing normal Session execution.
- **Reproduction:** Start a native Session with no pending Stop continuation after integrating its context source.
- **Root cause:** The source used an empty string for its baseline although SystemContext requires each admitted source to render nonempty text.
- **Fix:** Render `No pending Stop hook continuation.` for the inactive source and add a real SystemContext initialization regression.
- **Verification:** Focused suite passed 12 tests/45 assertions, including real initialization with no pending note. Subsequent native CLI and production Desktop Stop checks passed all five scenarios after correcting the separate wire-role fixture assertion. Independent Workflow rerun pending.
- **Independent occurrences:** 3. The Workflow integration and concurrent first native Stop integration each observed the empty-source violation; the third independent background Task source-authoring episode below establishes the recurring constraint.


## Third occurrence: native background Task context (2026-10-15)

- **Scope:** Isolated native background Task implementation, before shared integration.
- **Observed:** The real HTTP fixture timed out before its first provider request. The retained state showed zero provider hits and zero projected messages. Isolated drain instrumentation captured `System context source session/task-completion rendered an empty baseline` from the actual SystemContext initializer. A terminated initial run is diagnostic evidence, not successful verification.
- **Root cause:** A newly admitted inactive context source again rendered an empty baseline. The completion source's update renderer was nonempty, but its baseline renderer returned its empty state unchanged.
- **Fix:** Render the meaningful neutral baseline `No pending background Task completion.` while retaining the distinct delivered/empty-update semantics. No provider or permission behavior is bypassed.
- **Verification:** From `packages/apexo`, `bun test test/v2/task-completion.test.ts test/e2e/v2-task-background.e2e.test.ts --timeout 25000` passed 5 tests and 59 assertions in the isolated implementation. This includes actual SystemContext initialization and actual idle/active background execution, blocking-wait suppression, and cancellation suppression. Shared CLI/Desktop acceptance remains pending for this occurrence.
- **Occurrences:** Three independent integrations/source-authoring episodes now documented in this record. Repeated diagnostic runs of the Task failure count as one episode.
- **Constraint:** [RULE-20261015-006: Nonempty inactive SystemContext sources](../../rules/system-context-inactive-baseline.md).
