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
- The PR 209 Linux batch later reached the same 60-second deadline during the final model and agent checks. An isolated Linux x86_64 run with two CPUs and Bun 1.4.4 reproduced the deadline on both `d2ca7f0c` and `65ab771d`. The fixture now gives option validation, local output, model selection, and attached review separate 60-second budgets.

### BUG-20261120-004 — Attached review timed out on cold OpenAPI discovery

- Scope covers `review --attach` against a cold `apexo serve` process. GitHub Actions reported an HTTP timeout in the attached child after 13.863 seconds. The previous whole-test timeout had a separate 60-second deadline. [Linux shard retry](https://github.com/cluster1900/apexo-code/actions/runs/44677434843/job/136100876461)
- Reproduce from `packages/apexo` with a fresh review fixture server and the structured review CLI test on Bun 1.4.4. Trace method, pathname, and elapsed time in the client and server. In a Linux x86_64 container limited to half a CPU, the attached command received a 404 from `GET /openapi.json`, then aborted `GET /doc` at 10.107 seconds on `origin/main` (`d2ca7f0c`) and at 10.017 and 10.011 seconds on PR 209 (`65ab771d`). With two CPUs, both revisions passed and the cold `GET /doc` took 3.112 to 4.207 seconds.
- The first `GET /doc` builds and serializes the combined OpenAPI specification synchronously. The CLI needed only the supported review input fields before session admission, but waited on the full document subject to a 10-second HTTP deadline.
- The attached CLI now queries the authenticated `GET /api/review/capabilities` endpoint. Its response derives the available fields from the review request schema. Servers that lack the capability endpoint use the compatible OpenAPI discovery path. Discovery timeouts include the method and path.
- On the fixed server at the same half-CPU limit, the capability request took 146 ms and returned 82 bytes. The first full document request took 21.096 seconds and returned 784,073 bytes. A second request for the cached document took 186 ms.
- The regression runs the actual CLI, server, and loopback model fixture with both OpenAPI endpoints unavailable. It requires successful option discovery, a completed structured result, and a 404 for the ephemeral Session after CLI exit. The route exerciser also checks the capability response and authentication.
- From `packages/apexo`, `bun test --timeout 30000 test/cli/code-review.test.ts` passed five cases and 40 assertions on macOS. The isolated attached case failed with the old CLI and passed with the fix on Linux x86_64. The fixed CLI also attached to a real `d2ca7f0c` server with an explicit model and turn limit. The server trace showed both discovery 404s followed by `GET /doc` returning 200.

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

## PR 209 compatibility persistence and stdio cleanup retest

### BUG-20261119-019 — The existing-repository Git initialization test returned HTTP 404 once

- Scope is `test/server/project-init-git.test.ts` in batch 5 of the macOS arm64 repository run. `POST /project/git/init` should return HTTP 200 for an existing Git repository and preserve the running instance.
- On the final aggregate `GITHUB_ACTIONS=false bun turbo test --concurrency=2` run, the existing-repository case received HTTP 404. The other 17 Apexo batches passed. The cause remains unknown.
- From `packages/apexo`, `bun test test/server/project-init-git.test.ts --timeout 30000` passed both cases. `GITHUB_ACTIONS=false APEXO_TEST_SHARD=5/18 bun run test` then passed all 30 files in the original batch. Neither case required a change to the Git initialization handler or its test.

## PR 209 closed-connection retest

### BUG-20261119-022 — The pure permission review HTTP fixture returned 500 once

- Scope is `test/e2e/v2-permission-review.e2e.test.ts` in batch 13 of `GITHUB_ACTIONS=false bun turbo test --concurrency=2` on Bun 1.4.4 and macOS arm64. The pure native server fixture received 500 from `POST /api/session` before the permission review flow started. The expected response is the created Session with HTTP 200.
- The failing assertion retained the status. Response provenance, response body, and root cause remain unknown.
- From `packages/apexo`, `bun test --timeout 30000 test/e2e/v2-permission-review.e2e.test.ts` passed both pure and mixed cases. The original 29-file batch also passed with `GITHUB_ACTIONS=false APEXO_TEST_SHARD=13/18 bun run test`. Tests, server code, and deadlines were unchanged for both replays.

On the closed-connection fix, the full repository command completed all 18 Apexo batches. Seventeen passed initially, with batch 13 passing on the replay above. Type checking passed all 21 tasks. Both generated-source checks passed without a diff. `bun run test:httpapi` passed 360 cases in each of coverage, auth, and Effect modes, with zero failures, skips, or missing scenarios. App passed 118 unit tests, Desktop passed three, and the four packaging tests and all 17 published-file checksums passed.

The rebuilt macOS arm64 package and Web client both exercised the native and compatibility backends. Native Desktop passed seven Computer Use checks after [an approval retry](../ui/settings-mcp-permission-controls.md#bug-20261119-023--a-native-desktop-permission-reply-failed-once), native Web passed six, and both compatibility entrypoints passed six each. The Desktop renderer upgrade and both worktree paths preserved the saved route and effective approval choices. Mini and fullscreen both ran the real tool and rendered its durable result, with [a Mini retry](../test-fixtures/computer-use-catalog-install.md#bug-20261118-005--mini-tui-acceptance-left-the-prompt-in-the-editor). The migration fixture also opened the legacy transcript in the compatibility TUI through both directory spellings. Native CLI and Electron each passed the nine-check runtime scenario with the Promise, Effect, and legacy SDK clients. Compatibility reconnect, MCP choice persistence after reload and restart, and independent OAuth state passed through the legacy Client.

## Computer Use 0.1.2 Save retest

The catalog verifier fetched the dual-architecture 0.1.2 artifact and validated all 17 files. Both macOS native executables and helpers and both permission files matched the 0.1.1 artifact byte for byte. The catalog update fixture installed 0.1.1, refreshed the preview catalog, and updated to 0.1.2 while retaining the installation data directory and a sentinel file.

The [new-document regression](../test-fixtures/computer-use-acceptance.md#resolution-in-computer-use-012) passed on macOS arm64 with the fetched artifact under the distributed `ask` profile. The packaged Desktop and Web passed the native and compatibility Computer Use scenarios, and the Desktop upgrade preserved the renderer route and approval choices. Mini and fullscreen exercised the real tool and nine MCP control checks each. An unchanged Mini replay passed after a first submission timeout. Native CLI and Electron each passed nine checks, including Promise, Effect, and legacy SDK clients. The compatibility Client, inherited child denial, readonly migration, both worktree spellings, and scheduler restart also passed.

Both generated checks passed with identical output and all 21 Turbo typecheck tasks succeeded. `bun run test:httpapi` passed 360 cases in each mode. App passed 118 tests, Desktop passed three, and Computer Use packaging passed four. The aggregate runner completed all 18 Apexo batches, with 16 passing initially and batches 3 and 13 passing on unchanged replays. Batch 3 repeated the CLI worktree timeout in [BUG-20261119-004](#bug-20261119-004--four-runtime-test-deadlines-expired-in-the-aggregate-run). Its replay passed all 30 files.

### BUG-20261119-026 — The native preference writer fixture reached its deadline

- `GITHUB_ACTIONS=false bun turbo test --concurrency=2` failed batch 13 on macOS arm64. `separate private processes preserve choices and serialize independent preference writers` in `test/v2/mcp-preferences-native.test.ts` reached its 30-second deadline. The expected child responses and zero exit statuses must arrive before the deadline.
- The runner terminated two child processes. The ensuing assertion recorded exit 143. The original stall's cause remains unknown.
- From `packages/apexo`, `GITHUB_ACTIONS=false APEXO_TEST_SHARD=13/18 bun run test` passed the unchanged 29-file batch. This replay preserved the assertions and deadlines.
