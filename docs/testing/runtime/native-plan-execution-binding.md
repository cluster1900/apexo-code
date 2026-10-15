# BUG-20261015-119: Plan Question service depended on an unbound execution node

- **Status:** Corrected in the isolated native Plan draft; focused runtime verification passed.
- **Scope:** New native Plan recovery integration. This was not a fixture public-service omission or a shipped runtime regression.
- **Observed:** The first recovery test returned HTTP 500 when admitting the first native prompt, before any provider call. Diagnostic output identified `Unbound layer node: @apexo/v2/SessionExecution` during LocationServices compilation.
- **Expected:** Location-owned Question and Plan services materialize independently of process-global execution routing.
- **Cause:** The Question service attempted to schedule a recovered approval by adding the abstract SessionExecution node to its Location graph. That graph did not bind the process-global implementation.
- **Fix:** Question reply returns an internal original-incarnation continuation claim only for a genuinely new recovered decision. The native handler captures the existing global execution and lifecycle services and schedules a wake under that claim. Exact reply retries return no claim. The in-process Question contract documents the same explicit scheduling responsibility. No execution node is added to the Location graph, and idle interruption remains a no-op.
- **Reproduction:** Run `bun test test/e2e/v2-plan.e2e.test.ts --test-name-pattern 'batch boundary'` from `packages/apexo` against the original recovery draft.
- **Verification:** The unchanged batch behavior assertions passed after the binding repair, with 1 test and 18 assertions. The full native Plan fixture then passed 11 tests and 116 assertions. Apexo package typechecking passed. Subsequent CLI recovery passed 13 checks / 10 provider calls, and the two real crash checkpoints passed 10 checks / 6 calls. The expanded native shell/boundary suite passed 13 tests / 133 assertions.

Shared integration verification: the combined native Plan and background Task approval suite passed 14 tests / 153 assertions; all 21 repository typecheck tasks passed. CLI and rebuilt Desktop recovery each passed 13 checks / 10 local-provider calls; the actual crash checkpoints passed 10 checks / six calls. This does not replace the separate pending UI acceptance.
