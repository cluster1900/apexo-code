# BUG-20261015-134: Native Plan acceptance selected the CORS preflight

- **Scope:** The actual Electron Plan approval acceptance script; no production change.
- **Observed:** After all three locale checks and successful canonical approval, the script failed with a JSON parse error for `undefined`. The recorder contained an OPTIONS 204 with no body followed by the actual POST 204 with `{"answers":[["Approve"]]}`. Same-origin browser acceptance had passed.
- **Expected:** Inspect the actual answer submission, excluding transport preflight requests.
- **Reproduction:** Run `bun script/grok-native-plan-ui.mjs native` from `packages/apexo` against the original path-only recorded-request lookup.
- **Root cause:** The first record matching the reply URL was selected without checking its HTTP method. The native window's cross-origin request issued a CORS preflight at the same URL.
- **Fix:** Require POST when selecting both the Plan answer and ordinary custom-answer records; keep exact canonical answer and provider continuation assertions unchanged.
- **Verification:** The corrected `bun script/grok-native-plan-ui.mjs native` passed six checks / six local-provider calls, including canonical Plan approval and exact ordinary custom-answer submission. The process exited zero and owned resources were reaped. The earlier browser run passed six / six; the final shared typecheck completed all 21 tasks. The first failed native run is not counted as a completed acceptance.
- **Occurrences:** One fixture-authoring episode. The separate DOM Response/CORS fixture record has a different root cause.
