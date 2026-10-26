# Remaining issue reproduction — 2026-10-25

Scope: [#157](https://github.com/cluster1900/apexo-code/issues/157), [#158](https://github.com/cluster1900/apexo-code/issues/158) and [#162](https://github.com/cluster1900/apexo-code/issues/162). Baseline: `bebb18ab5a76f01ad504e27a621b5c6b754fb848` on macOS 26.6.2 arm64 with the repository-pinned Bun 1.4.4. The original failures used Bun 1.3.14. The earlier runtime upgrade fixes a separately reproduced PTY deadlock; it does not establish a cause or fix for these three observations.

The [test plan](../../desktop-cli-testing.md#remaining-issue-reproduction-follow-up) was written before execution. The user explicitly authorizes closing an issue as unable to reproduce after reporting that result. This supersedes the earlier instruction to leave these issues open, without turning passing controls into evidence of a fix. Original failures and unknown root causes remain in [BUG-20261025-010, -011 and -015](../test-stability/2026-10-25-acceptance-gates.md).

## Source investigation

| Issue | Inspected path                                                                                                                     | Finding and remaining uncertainty                                                                                                                                                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #157  | Core `process-execution.ts`, `process-completion.ts`, `run-coordinator.ts`, native Plan reply and runner completion reconciliation | Process completion is persisted before the completion ticket becomes ready. A wake during an active drain sets `pendingWake`; settlement schedules another drain. Plan approval persists its switch and resolves a present waiter. No lost notification or approval handoff was demonstrated. The original timeout lacks the later diagnostic snapshot. |
| #158  | Legacy HttpApi session query schema/handler, `MessageV2.page`, request fixture                                                     | The schema accepts nonnegative integer limits, without a 510-message cap; zero selects the unbounded legacy path. Pagination fetches `limit + 1` and returns the requested page. The explicit cursor error branches do not explain a limit-only request. The original 400 response body was not retained, so its rejection boundary is still unknown.   |
| #162  | Legacy prompt shell/loop, `SessionRunState`, Effect runner `ShellThenRun` transition                                               | The shell waits for output and process exit; the synchronized state transition starts the pending run after shell completion. No lost handoff or inherited shell-startup delay was established. Scheduling or host load remains a hypothesis.                                                                                                           |

No production code, fixture timeout, readiness condition or assertion was changed in this follow-up. Existing timeout/transcript and non-200 response diagnostics remain enabled.

## Fresh-process controls

Run each command from `packages/apexo`, twenty times in separate Bun processes. Three issue workers ran concurrently; each worker executed its own repetitions serially. This avoids reuse of the disposed shared HTTP runtime observed in an earlier in-process rerun of #158.

```sh
bun test test/e2e/v2-plan-shell-completion.e2e.test.ts --test-name-pattern 'background Shell completion waits for native Plan approval without a new user input'
bun test test/server/session-messages.test.ts --test-name-pattern 'does not truncate large legacy limit requests'
bun test test/session/prompt.test.ts --test-name-pattern 'loop waits while shell runs and starts after shell exits'
```

| Issue | Result     | Assertions | Total process wall time | Slowest process |
| ----- | ---------- | ---------- | ----------------------- | --------------- |
| #157  | 20/20 pass | 320        | 27.688 s                | 1.856 s         |
| #158  | 20/20 pass | 40         | 42.984 s                | 2.584 s         |
| #162  | 20/20 pass | 100        | 50.346 s                | 3.474 s         |

These are whole-process timings, not measurements of the individual assertion or provider turn.

## Original batches under concurrent load

From `packages/apexo`, start `bun run test:httpapi` and replay `APEXO_TEST_SHARD=N/17 bun run script/run-tests.ts` for N = 10, 11 and 16 twice, with at most two batch workers. Each selected batch contains 29 of the current 501 test files. The direct batch runner avoids generated-source writes during this concurrency experiment.

| Batch | Related issue | Round 1       | Round 2       |
| ----- | ------------- | ------------- | ------------- |
| 10    | #162          | PASS, 89.21 s | PASS, 90.11 s |
| 11    | #157          | PASS, 69.55 s | PASS, 67.83 s |
| 16    | #158          | PASS, 53.73 s | PASS, 46.01 s |

All six runs exited zero: 174 file executions. The overlapping HttpApi gate also passed: coverage 346/346, authentication 346/346 and Effect 346/346, with zero failures, skips or missing cases in every mode; total wall time 359.014 seconds. These are loaded controls, not an exact recreation of the historical scheduler interleaving or old runtime.

## Final gates and live acceptance

Final required gates run sequentially, with no overlapping generated-source writer and reader. `--force` makes Turbo execute every task rather than accept cached results.

| Command and working directory                                       | Result                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Client: `bun run check:generated`                                   | PASS, 0.58 s                                                                         |
| Legacy JavaScript SDK: `bun run check:generated`                    | PASS, 4.76 s                                                                         |
| Root: `bun turbo typecheck --concurrency=2 --force`                 | PASS, 21/21 tasks, zero cached, 28.547 s                                             |
| Root: `GITHUB_ACTIONS=false bun turbo test --concurrency=2 --force` | PASS, 6/6 tasks, zero cached, all 17 Apexo batches / 501 files, 6m26.094s            |
| Apexo: `bun run test:httpapi`                                       | PASS, 346/346 in each of coverage/auth/Effect; zero failures/skips/missing, 294.87 s |
| Apexo: `bun run script/build-node.ts`                               | PASS, 1.00 s                                                                         |
| Desktop: `bun x electron-vite build`                                | PASS, 20.98 s                                                                        |

CLI used a new isolated project and session with native `antigravity/gemini-3.8-flash`, variant `low`, through the actual `src/index.ts run --format json` entry point. Turn one read `19 + 23`, implemented `sum.py` without `eval`, executed it and independently asserted `result.txt` was exactly `42` plus one newline. Turn two resumed the same Session ID using `--session`, changed the input to `20 + 23`, reran the existing program and independently asserted exactly `43` plus one newline. Both commands exited zero with no stderr, emitted their requested completion markers, and matched the external file-byte oracle: 17.41 seconds and 11.17 seconds respectively.

Desktop was rebuilt from this baseline and launched with isolated test storage. Through the native folder picker, open a fresh fixture project, select Antigravity / Gemini 3.8 Flash / Low, and send the same two-turn coding task in one conversation. Approve each of the two file writes and two shell commands with **Allow once**. The UI displays both completion markers, Gemini 3.8 Flash / Low, a ready composer and `Tasks · 0`. Displayed turn durations are 29 and 37 seconds, including permission-review time.

The authenticated Desktop server returns HTTP 200 with nine durable messages: two user inputs and seven assistant messages. All five tool parts are completed (one read, two writes, two shell commands); both shell commands run the program and a separate byte assertion, printing `VERIFIED`. Both final assistant messages have `finish: stop`. All assistant messages identify `antigravity/gemini-3.8-flash`. External filesystem assertions confirm `42\n` after turn one and `43\n` after turn two. The final screenshot was visually inspected; the completed result and composer are visible without an obstructing dialog. The owned test instance was shut down after evidence capture.

## Disposition

All local gates and fresh Gemini Desktop/CLI acceptance passed. CI and merge outcomes are recorded on the associated PR. The reproduction attempts above did not reproduce any of the three reported failures. No root cause or code fix is claimed. After all PR checks pass and the documentation is merged, reply "Unable to reproduce (无法复现)" on each issue and close it under the user's explicit instruction. Reopen if a new failure supplies the retained Plan/process snapshot, HTTP error body or shell/loop transcript needed to locate the failed boundary.
