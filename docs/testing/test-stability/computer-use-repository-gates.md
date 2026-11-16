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
