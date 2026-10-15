# BUG-20261015-043: Hook preference fixture asserted an Effect wrapper as the underlying failure

- **Scope:** New isolated Hook preference compatibility test; no shipped execution failure.
- **Observed:** The first focused run passed 18 tests and failed one assertion. A deliberately missing preference capability correctly rejected execution, but the fixture expected the inner failure text on `Effect.tryPromise`'s default `UnknownError` wrapper.
- **Expected:** Verify the typed `HookPreferences.Failure` returned by the adapter and its `read` code.
- **Root cause:** The test converted a rejected Promise to Effect without preserving its cause, then asserted the wrapper's string representation.
- **Fix:** Supply an explicit identity error mapping and assert the actual failure type/code. Do not alter the production fail-closed result.
- **Reproduction:** Run `bun test test/plugin/hook-preferences.test.ts` from `packages/apexo` with the original wrapper assertion.
- **Verification:** The corrected isolated focused run passed 21 tests and 109 assertions. The final combined Hook suite passed 44 tests and 204 assertions across 12 files, including the same missing-capability case.
- **Occurrences:** One new fixture-authoring episode; no recurring rule promoted.
