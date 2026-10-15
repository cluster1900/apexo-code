# Native Goal launch promotion and terminal delivery

## BUG-20261014-055

- **Scope:** Core native V2 SessionRunner Goal orchestration and the native production acceptance fixture.
- **Observed:** A Goal exhausted its 120-token budget during the first planner call, but two additional native worker calls followed. The fixture observed three calls where exactly one was expected.
- **Expected:** The Goal launch prompt belongs to that Goal. Exhausting its budget must not reinterpret the still-pending launch as unrelated ordinary work. Distinct user queue inputs must remain pending while the Goal is active and run at the eventual idle boundary.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-goal-v2.mjs cli`. The budget scenario creates an empty native Session, starts a Goal with a one-call budget, and asserts the exact request delta.
- **Root cause:** Planning ran before promotion of the admitted original objective. After terminal Goal settlement, the newly added idle-boundary delivery logic saw that original steer as pending work and executed it without a Goal attempt.
- **Fix:** Promote admitted steers at the first owned Goal boundary before independent planning. Do not promote queued inputs merely because an active Goal is explicitly resumed. After a Goal settles, drain genuinely pending steers or one queued input through the ordinary native runner.
- **Verification:** The CLI fixture passed all five scenarios with 37 provider calls after the fix; its budget scenario observes exactly one request. `bun test test/e2e/v2-goal.e2e.test.ts` also verifies a distinct queued input is delivered after completion and excluded from Goal usage. Final Desktop results are recorded in the native execution document.
- **Recurrence:** One independently observed failure. No recurring constraint is promoted.
