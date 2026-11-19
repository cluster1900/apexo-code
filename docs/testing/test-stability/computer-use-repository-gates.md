# Computer Use repository gates

## BUG-20261116-010: Three aggregate lifecycle tests timed out

- Scope: the first uncached complete repository test run during Computer Use implementation, Bun 1.4.4/macOS arm64.
- Observed: `GITHUB_ACTIONS=false bun turbo test --concurrency=2` exited 1 after 18m47.11s; five of six Turbo tasks succeeded. All 18 Apexo batches ran; batches 6, 15, and 16 each had one timeout. The failed tests were `shell completion resumes queued loop callers` (10 seconds), `workspace synchronization releases its actual application and cleanup owners before fixture reset` (55 seconds), and `shared HttpApi services retain their Location map after the first project scope closes` (60 seconds).
- Expected: every batch completes with its original assertions and deadlines.
- Reproduction: run the complete command from the repository root on this implementation checkpoint. The full run also includes the new permission-profile and Responses request regressions.
- Root cause: unknown. The captured aggregate output does not establish a production regression or a host-load cause. No timeout, assertion, or runner concurrency was changed to make the tests pass.
- Diagnostic verification: an unchanged scoped run from `packages/apexo`, `bun test test/session/prompt.test.ts test/server/httpapi-location-lifetime.test.ts test/server/httpapi-workspace-owner.test.ts --timeout 60000`, passed 87 tests with one existing skip and 446 assertions across three files in 74.31 seconds. The per-test explicit deadlines remained unchanged. This narrows reproducibility and does not prove a repair.
- Final verification: the unchanged repository command completed all six Turbo tasks successfully (three cached), with all 18 Apexo batches exiting zero in 12m42.784s. App unit tests then passed 114 tests with zero failures. The original timeout root cause remains unknown; this is a passing complete-gate observation, not a causal repair. No timeout, assertion, or runner concurrency was changed.

## BUG-20261116-017: Focused follow-up reported an unnamed cleanup timeout

- Scope: manual-permission follow-up verification on Bun 1.4.4/macOS arm64.
- Observed: `bun test test/v2/computer-use-profile.test.ts test/session/llm-responses-tool-choice.test.ts` passed its three tests and 84 assertions, then reported an unnamed hook failure after 5,622.05 ms: `a beforeEach/afterEach hook timed out for this test`. The process exited 1. A separate typecheck and plugin test process were also running; causality is not established.
- Expected: the focused process completes its assertions and cleanup without an additional hook failure.
- Root cause: unknown. This package's preload has an asynchronous `afterAll` that disposes the legacy AppRuntime and removes test data, but the reported output does not identify the exact stalled operation. Do not label this a Computer Use production defect or infer host-load causality from concurrency alone.
- Reproduction/verification: the identical command, run after the other checks settled and without any source, timeout, or assertion change, passed three tests and 84 assertions in 2.19 seconds. This is a successful rerun, not proof of a repair. The complete repository gate is recorded separately in the follow-up acceptance report.

## 2026-11-18 catalog release retest

The complete local command `GITHUB_ACTIONS=false bun turbo test --concurrency=2` exercised all 18 Apexo batches on Bun 1.4.4/macOS arm64. Sixteen passed on the first run. Release changes in this pass covered plugin metadata and Computer Use acceptance scripts. Both affected batches passed when rerun from `packages/apexo` with the same test sources.

### BUG-20261118-008 — Concurrent native Goal fixture received HTTP 401

Batch 3 expected HTTP 200 from `POST /api/session` in `test/e2e/v2-goal.e2e.test.ts` and received 401. The root cause is unknown. `GITHUB_ACTIONS=false APEXO_TEST_SHARD=3/18 bun run test` passed the original 30-file batch on retry.

### BUG-20261118-009 — Headless CLI fixture missed the background follow-up output

Batch 15 expected the initial response and the background completion line in `test/cli/run/run-process.test.ts`. The command exited successfully with only the initial response. The root cause is unknown. `GITHUB_ACTIONS=false APEXO_TEST_SHARD=15/18 bun run test` passed the original 29-file batch on retry.

## 2026-11-19 settings retest

### BUG-20261119-003 — The aggregate structured review CLI test timed out

- Scope is Bun 1.4.4 on macOS arm64 during `GITHUB_ACTIONS=false bun turbo test --concurrency=2`.
- The structured review CLI test in `test/cli/code-review.test.ts` reached its 60-second deadline in batch 6. The other 17 batches passed. The CLI emitted the running review event before cleanup terminated its pending process.
- Expected behavior is a finished review with a JSON report, the expected exit status, and cleanup within the existing test deadline. The cause of the timeout remains undetermined.
- Re-run the original batch with `GITHUB_ACTIONS=false APEXO_TEST_SHARD=6/18 bun run test` from `packages/apexo`. All 30 files passed in 191.30 seconds on the unchanged test code. This rerun establishes that the timeout did not recur in the scoped run.
- The App unit suite passed 114 tests, Turbo type checking passed 21 tasks, and both generated-source checks completed without a diff. `bun run test:httpapi` passed 360 scenarios each in coverage, auth, and effect modes. The two Settings regressions have separate [Web and Desktop acceptance results](../ui/settings-mcp-permission-controls.md).

## Computer Use and path migration consolidation

The merge retained the catalog initialization and relocated the installed registry paths before returning an existing catalog state. An isolated V1 backend moved copies of Computer Use 0.1.0 and 0.1.1 from the legacy directory, kept the installation identity, and returned the real `desktop_version` result after disconnecting and reconnecting. A rebuilt macOS Electron window used `apexo://renderer` and exercised both MCP connection controls and the approval switch in an existing session and a draft. Mini and fullscreen TUI each completed the real version call.

The first repository unit run completed all 18 Apexo batches. Fifteen passed initially, and the remaining three passed on replay. Type checking, both generated-source checks, 72 focused migration and MCP tests, 114 App unit tests, and 1,080 HttpApi scenarios passed on the combined code.

### BUG-20261119-004 — Four runtime test deadlines expired in the aggregate run

- Scope covers the CLI worktree attempts and automatic Dream cases in batch 3 and two provider-list API cases in batch 4. All were expected to complete within their existing deadlines.
- Reproduce with `GITHUB_ACTIONS=false bun turbo test --concurrency=2` on the combined branch. The worktree attempts case reached its 60-second deadline. Automatic Dream did not settle. The two provider cases hit their test deadlines.
- The four cases passed together when selected by name. The original 30-file batches passed with `GITHUB_ACTIONS=false APEXO_TEST_SHARD=3/18 bun run test` and `GITHUB_ACTIONS=false APEXO_TEST_SHARD=4/18 bun run test` from `packages/apexo`. The individual causes remain unknown. The tests and deadlines were unchanged for both replays.

### BUG-20261119-005 — Native MCP initialization failed once during a preference test

- In batch 13 of the same aggregate command, the saved-choice test in `test/v2/mcp-preferences-native.test.ts` reported `MCP.Failure` with code `load` while connecting its configured local fixture. The fixture should connect and persist the overridden preference.
- The reported error did not expose the original cause. The exact saved-choice test passed unchanged on its own. The original 29-file batch passed with `GITHUB_ACTIONS=false APEXO_TEST_SHARD=13/18 bun run test` from `packages/apexo`.
