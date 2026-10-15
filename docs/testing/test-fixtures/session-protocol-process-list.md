# BUG-20261015-229: Mixed-protocol panel fixture omitted the Process list contract

- Status: Corrected and verified by the focused shared test; a fresh complete aggregate remains required.
- Scope: The existing native/compatibility Session panel transport regression after integrating the unified Task and Process manager.
- Occurrences: One integration episode.
- Observed: The complete unit gate passed 4,266 tests and failed the native panel case with `processes.value.data.map is not a function`. Nineteen tests were skipped and one remained todo. The recorded 4,888-file source checkpoint was unchanged throughout that run.
- Expected: Native management reads both canonical Task and Process list endpoints, while compatibility management retains its existing Task endpoint. Both return an empty list for this fixture.
- Reproduction: From packages/apexo, run `bun test test/tui/session-protocol-panels.test.ts` with the original fixture after the Process manager change. Its catch-all responds to the new Process route with a health object instead of an array.
- Root cause: The panel fixture modeled only the old Task request and treated every unknown route as a successful health probe. The expected request list was also stale.
- Fix: Return the actual Process list response, restrict health to its explicit route and reject unknown routes. Assert the complete empty snapshot and exact request set without imposing an order on independent concurrent list requests. No production transport behavior changed.
- Verification: The focused shared command passed both native and compatibility cases, two tests / six assertions, with clean listener cleanup. The earlier complete aggregate remains failed until rerun; this passing focused result does not change its outcome.
