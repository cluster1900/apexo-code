# Background Task UI fixture mistook an assistant marker for a scenario

- **Bug ID:** BUG-20261015-109
- **Scope:** Background extension of the real native Task UI acceptance fixture.
- **Status:** Corrected in the private fixture; product behavior unchanged.
- **Independent occurrences:** 1 authoring episode.

The helper smoke check timed out waiting for the idle scenario's third parent request. Fourteen actual requests had already completed through setup and that scenario. Its reverse-history classifier accepted any role and matched the prefix `UI_PARENT_DONE` inside the assistant's `UI_PARENT_DONE_IDLE` response, incorrectly assigning the completion request to the DONE setup scenario.

The classifier now considers only user-origin scenario messages and requires an exact scenario boundary. Assistant output is never authority for selecting the fixture scenario. This differs from BUG099, whose latest wire-user message was a SystemContext update rather than the original user input.

From `packages/apexo`, pinned Bun 1.3.14, `bun script/grok-task-background-ui-fixture-check.mjs` passed four checks with 22 real provider calls. It covers cancellation without parent wake, idle completion after passive reads, active-parent delivery at the safe boundary, and model wait without duplicate notification. All fixture processes were reaped. Actual browser/native-window and terminal visual acceptance are recorded separately.
