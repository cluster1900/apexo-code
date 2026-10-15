# BUG-20261015-207: Worker environment test asserted an obsolete source expression

- Status: Integrated; shared real Worker tests and all 21 workspace typechecks passed. The complete unit rerun remains pending.
- Scope: `test/cli/tui/thread.test.ts`, compatibility and native fullscreen worker construction.
- Occurrences: One fixture assumption episode.
- Observed: The shared full-unit gate's environment-forwarding test failed because its regular expression required `Object.entries(process.env)`. The constructor deliberately overlays `APEXO_NATIVE_TUI_HOST: "0"` before enumerating the inherited environment.
- Expected: Tests should verify environment visible inside an actual worker and explicit compatibility/native mode selection. They should not require one source spelling.
- Reproduction: From `packages/apexo`, run `bun test test/cli/tui/thread.test.ts --test-name-pattern 'forwards the CLI environment'`. The original assertion fails before constructing a worker.
- Root cause: A source-shape regex was mistaken for behavior coverage. The intentional flag overlay changed that source shape without establishing any loss of ordinary inherited environment.
- Repair: Extract the unchanged worker environment assembly into a lightweight shared factory used by both existing callers. Replace the regex with isolated subprocesses that create real workers, inspect a known inherited value, preserve an empty value, and override an opposite inherited mode without modifying the parent environment. Cleanup is bounded and joins the subprocess, including its worker.
- Verification: From `packages/apexo`, `bun test --timeout 30000 test/cli/tui/thread.test.ts` passed 11 tests / 23 assertions. Both real worker modes passed. The initial real test also exposed [BUG-20261015-210](../runtime/tui-worker-mode-env-substitution.md); that distinct runtime read issue is not the regex's root cause and is not counted as a recurrence here.

After the nine-file integration, the same complete thread file passed 11 tests / 23 assertions on the shared branch. `bun turbo typecheck --concurrency=2` passed all 21 tasks (20 unchanged cache hits). The prior failed aggregate is not retroactively green.

The first whole-file private invocation used bare `bun test`, whose default five-second test timeout interrupted three pre-existing CLI subprocess cases. The package test script already specifies `--timeout 30000`, matching those fixtures' existing thirty-second process budgets. Correct verification must use the package's existing budget. These interrupted runs establish neither a forwarding failure nor a new latency cause; no scenario deadline was increased.
