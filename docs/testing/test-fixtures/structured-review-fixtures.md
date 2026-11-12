# BUG-20261112-004: Review fixtures omitted required provider usage

- Scope: initial native F01 provider fixtures.
- Observed: a syntactically valid final report was rejected with incomplete usage, including after a fabricated tool call.
- Expected: fixtures claiming a complete metered review provide usage for every provider turn.
- Reproduction: queue `TestLLMServer.tool(...)` or `.text(...)` without usage, then require a successful review receipt.
- Root cause: those convenience responses do not include usage by default. The production headless ledger correctly marked the receipt incomplete.
- Fix: attach explicit usage to successful fixture responses, including tool turns; retain a separate missing-usage rejection test.
- Verification: the native review/headless regression command passed 15 tests / 133 assertions. The real CLI suite passed 2 tests / 13 assertions, covering report JSON, priority thresholds, streaming, export and ephemeral execution.

# BUG-20261112-005: Restart fixture used an in-memory database

- Scope: native review restart/replay fixture.
- Observed: the second application graph could not find the first graph's persisted report.
- Expected: a simulated process restart opens the same isolated database and reconciles unfinished rows without provider work.
- Reproduction: construct and dispose two native graphs with the default test database while carrying a report ID between them.
- Root cause: the test preload selects an in-memory database; a Global data-directory override does not override the independently configured Database node.
- Fix: explicitly bind `Database.layerFromPath(...)` to a fixture-owned persistent database and use that same path in both graphs.
- Verification: the restart regression passed in the 15-test command; it checks captured evidence, `interrupted` status, exact retry and unchanged provider-call count.

## Other validation observations

- The sandbox denied the local fixture listener and surfaced `EADDRINUSE` for port zero. The approved local-listener test run reached the actual fixtures; no application networking fix is claimed.
- One aggregate run exhausted the default five-second deadline in the real Git fixture. These OS/subprocess tests now explicitly use a twenty-second deadline. The precise resource delay was not diagnosed; this is not evidence of a fixed Git hang. The later native/headless run passed without changing production logic to accommodate a timeout.
