# BUG-20261114-F02-001: MCP worker initialization failed in the remediation unit gate

- **Status:** Investigating; no production fix or underlying cause established.
- **Scope:** `test/cli/mcp-serve.test.ts`, the outer native Code Mode/stdio worker scenario, during the complete F02 remediation unit gate on Bun 1.4.4.
- **Observed:** The full `GITHUB_ACTIONS=false bun turbo test --concurrency=2` run completed 16 of 18 Apexo batches successfully. Batch 18 failed `outer Apexo V2 Code Mode session orchestrates multi-turn apexo mcp serve child agent over stdio` after 12.11 seconds with `MCP.Failure`, code `load`, message `Could not initialize MCP server`, server `worker`. The safe error adapter did not expose the original cause. Batch 15 separately failed the CLI duration assertion described below; these are not assumed to share a root cause.
- **Expected:** The actual stdio worker initializes and completes the two native turns, preserving its Session identity and joining shutdown.
- **Reproduction:** Run the complete root unit command above with the remediation snapshot. The standalone files are `test/cli/mcp-serve.test.ts` and `test/cli/run/run-process.test.ts` in `packages/apexo`.
- **Root cause:** Unknown. The available aggregate output does not prove a startup timeout, permission-review regression or host-load explanation.
- **Fix:** None claimed. No MCP behavior, test deadline or concurrency setting was changed before the unchanged focused rerun.
- **Verification:** `bun test --timeout 60000 test/cli/run/run-process.test.ts test/cli/mcp-serve.test.ts` from `packages/apexo` passed **29 tests / 144 assertions** in 157.19 seconds. The outer worker case passed in 7.79 seconds. This narrows reproducibility and verifies the individual scenarios; it is not a causal repair of the aggregate failure. The complete gate was then rerun unchanged, with its final result recorded in the F02 implementation report.

## Separate CLI duration symptom

Batch 15 produced the background-exit case's expected exit code 1, exact stdout and expected cleanup message, then failed its wall-time assertion: **25,959 ms** versus **less than 25,000 ms**. The unchanged focused rerun passed that case in 4.40 seconds. This is additional symptom evidence for [BUG-20261015-325](cli-process-aggregate-timeouts.md); it does not establish the earlier record's unknown cause, a new production defect or a verified repair. No timeout was increased and no occurrence count or recurring rule was promoted.

## BUG-20261114-F02-002: PTY child cleanup hook exceeded its limit in the repeated gate

- **Status:** Investigating; no causal repair established.
- **Scope:** `test/server/pty-process.test.ts`, its concurrent child test workers during the second complete unit gate.
- **Observed:** The unchanged complete rerun passed 17/18 batches, including the previously failing CLI and MCP batches. Batch 4 failed because one child reported an unnamed beforeEach/afterEach hook timeout at 7.28 seconds. That child still completed all ten PTY repetitions and all 900 expected PTY assertions, then exited 1; its total duration was 28.30 seconds. The parent consequently failed its zero-exit assertion.
- **Expected:** Child fixture hooks join within their limits and all four workers exit zero after their real adapter assertions.
- **Reproduction:** Run `GITHUB_ACTIONS=false bun turbo test --concurrency=2` from root with the remediation snapshot; the focused adapter command is `bun test --timeout 60000 test/server/pty-process.test.ts` from `packages/apexo`.
- **Root cause:** Unknown. The log does not identify which hook exceeded its deadline. This is not the earlier external-watchdog SIGKILL recorded in [BUG-20261101-002](pty-worker-watchdog-headroom.md), and the forward progress is not evidence of a native reaping deadlock. [RULE-20261025-001](../../rules/macos-pty-runtime.md) remains unchanged.
- **Fix:** None claimed. No test assertion, hook deadline, runtime pin, watchdog or worker count was changed.
- **Verification:** The unchanged focused adapter run passed **3 tests / 104 assertions** in 24.49 seconds; the concurrent worker case passed in 20.80 seconds. This verifies the focused scenario and narrows reproducibility, not a repair of the aggregate timing. Both local complete-gate failures remain recorded, and PR Linux CI validates the committed snapshot separately.
