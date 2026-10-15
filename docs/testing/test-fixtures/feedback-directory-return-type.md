# BUG-20261014-075: Scoped Temporary Fixture Return Shape

- **Status:** Fixed and verified.
- **Occurrences:** Three independent fixture-authoring episodes: Feedback, durable Stop, and native media. Multiple cases from one authoring episode count once.
- **Scope:** Effect fixtures using `tmpdirScoped`, including Feedback, Stop, and native media.
- **Observed:** The cross-directory case received 200 rather than 404. Typecheck also reported that `.path` does not exist on `string`.
- **Expected:** Send the request with a real second directory, allowing the test to exercise the actual Session routing contract.
- **Reproduction:** From `packages/apexo`, run `bun test test/server/httpapi-feedback.test.ts` and `bun typecheck` with the original fixture.
- **Root cause:** `tmpdirScoped()` returns the path string. Reading `.path` produced `undefined`, so the request reused the original directory instead of exercising cross-directory access. This did not demonstrate a production authorization bypass.
- **Fix:** Pass the returned string directly. The original 404 expectation was a separate contract mistake, tracked in [BUG-20261014-076](feedback-session-routing-contract.md).
- **Verification:** `bun typecheck` from `packages/apexo` passed after the path correction. After correcting the separate routing expectation and resolving the runtime integration checkpoint, the affected four-file suite passed 43 tests and 120 assertions. The type fix is distinct from the routing and teardown findings.

## Independent occurrences

1. The original Feedback fixture used `.path` on the returned string, producing the incorrect routing request and a type error described above.
2. The durable Stop fixture independently made the same mistake after its separate spawner correction. [BUG-20261014-072](hooks-stop-fixtures.md) records the return-shape failure and the corrected 12-test / 45-assertion gate plus package typecheck. This occurrence is unrelated to the missing-spawner constraint.
3. The native media fixture repeated `.path` for an external reference directory. Its combined gate reported eight passing cases and three setup failures; `path.join` received `undefined`, and package typecheck reported TS2339 on `.path`. All three cases came from one new fixture episode. Passing the actual string preserved the denial assertions. The corrected scoped run passed three tests / 12 assertions, and `bun typecheck` from `packages/apexo` exited successfully. No production authorization defect was demonstrated by these setup failures.

The recurring requirement is [RULE-20261015-007](../../rules/scoped-temp-fixture-return-shape.md).
