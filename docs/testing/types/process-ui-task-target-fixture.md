# Footer fixture lacked source-qualified task identity

- **Bug ID:** BUG-20261015-191.
- **Scope:** One existing footer renderer fixture updated for the private native Process manager UI.
- **Observed:** Apexo package typechecking rejected the fixture TaskItem without source/key and its string-only cancellation callback after the real adapter introduced source-qualified TaskTarget. App/TUI package types and both real HTTP adapter suites had passed.
- **Expected:** The renderer fixture supplies the same discriminated target as the actual adapter and asserts cancellation preserves its source and ID.
- **Root cause:** The implementation updated the production adapter/consumer contract but initially left this existing renderer fixture on the previous string-ID shape.
- **Fix:** Supply a compatibility source-qualified row, assert the exact selected row passed to cancellation, and provide a wait handler that fails if a compatibility row incorrectly invokes native Process wait. Original no-model-prompt, live-output and close assertions remain.
- **Verification:** The Apexo package typecheck passed. The actual footer renderer regression passed one test with five assertions. App and TUI types also passed; their real HTTP adapter suites each passed 24 tests / 91 assertions. No production behavior was weakened to satisfy the fixture.
