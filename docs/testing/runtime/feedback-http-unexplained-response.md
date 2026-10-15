# BUG-20261014-207: Unexplained HTML response in a local feedback fixture

- **Scope:** First GET in `test/server/httpapi-feedback.test.ts` during the migrated
  eleven-file HTTP fixture gate.
- **Status:** Unresolved cause; not reproduced by the immediate focused rerun.
- **Observed:** One run returned HTTP 501 `Not Implemented` with an HTML body from
  the loopback session feedback URL. The JSON decoder rejected the leading `<`.
  The other feedback test and all other HTTP files completed successfully.
- **Expected:** The initial feedback collection request returns HTTP 200 with an
  empty JSON array.
- **Reproduction:** Run the migrated eleven-file HTTP fixture gate with
  `bun test --timeout 30000` from `packages/apexo`. The initial recorded run failed
  this one request; an immediate focused feedback and feature run passed 15 tests
  and 56 assertions without a runtime change.
- **Root cause:** Unknown. The response body and headers were not retained beyond
  the JSON decode failure. Concurrent activity alone does not establish causation.
- **Fix:** None claimed. A passing rerun is not proof of a product fix. If repeated,
  capture the non-200 response status, headers and body before JSON decoding.
- **Verification:** Focused rerun passed. The subsequent combined 22-file fixture
  gate also passed (264 passed, two existing skips, 1,053 assertions), including both
  feedback tests. The shared full-suite gate remains the next checkpoint. These
  passing runs do not establish the original response's cause. This symptom is separate from the timeout invocation mistake
  in [BUG-20261014-205](../test-fixtures/focused-test-timeout-option.md).
