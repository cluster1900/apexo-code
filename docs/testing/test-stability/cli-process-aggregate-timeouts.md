# BUG-20261015-325: CLI subprocess deadlines in the complete Memory UI unit gate

- Status: Investigating; no cause or repair established.
- Scope: `test/cli/run/run-process.test.ts` during the complete required unit gate on pinned Bun 1.3.14.
- Observed: Seven subprocess scenarios failed around their existing thirty-second deadlines. Captured failure output contained `Error: Timed out`, an empty stdout and synthesized exit code -1; one test also produced a late assertion error during teardown. The aggregate finished with 4398 passes, 19 skips, one todo, nine failures and one unhandled error in 20 minutes. Its other two failures were the unrelated stale legacy Memory contract.
- Expected: Successful prompts, error formatting, continuation and permission policy complete with their declared output and joined subprocess cleanup inside the existing deadlines.
- Reproduction: From the repository root run `GITHUB_ACTIONS=false bun turbo test --concurrency=2`. Retain the subprocess output and fixture cleanup evidence if this recurs.
- Root cause: Unknown. Concurrent startup or host load is a hypothesis only. The current timeout wrapper discards partial stdout when synthesizing a failed process result, so empty captured output alone does not establish that the child never started.
- Fix: None claimed; no production code, concurrency setting or deadline was changed for the isolated rerun.
- Verification: With the same package sources, `GITHUB_ACTIONS=false bun test --timeout 30000 test/cli/run/run-process.test.ts` from packages/apexo passed all 14 tests and 62 assertions in 35.93 seconds. That pass proves the isolated scenarios, not a repair of the aggregate failure.
- Independent observations: Two complete-gate episodes (seven and six affected cases respectively); individual cases are not independent root-cause recurrences. The cause is unproven, so no constraint is promoted.

## Later frozen eight-capability aggregate

The same subprocess file again exceeded its existing30-second process deadlines in several scenarios, including unknown stream continuation, JSON continuation/order, line-delimited JSON, permissions and streaming JSON. Retained failures again synthesize exit-1 and discard partial stdout, so the child startup/execution/cleanup phase is not established. This is a second independently observed aggregate episode, not a proven shared cause or a repaired regression. The aggregate finishes4553pass/8fail; six failures are CLI process deadlines. The fixture now uses the canonical process observer to retain the last16KiB of each real output stream plus PID/start/last-output timings on failure. The observer adds no second stream reader and preserves the existing scoped kill/join and30-second deadline. No production behavior is changed and no timeout repair is claimed.

The diagnostic-only focused command `GITHUB_ACTIONS=false bun test --timeout 30000 test/cli/run/run-process.test.ts test/e2e/v2-subagent-hooks.e2e.test.ts` exits0 with22 tests/136 assertions in43.76s. All14 CLI cases pass. This does not establish the aggregate deadline cause or a repair; the next complete run retains the added bounded process evidence on any recurrence.
