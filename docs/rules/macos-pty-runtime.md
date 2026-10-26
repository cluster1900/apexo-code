# RULE-20261025-001 — Nonblocking macOS PTY process reaping

- **MUST** use a runtime containing Bun's nonblocking macOS PTY reap fix when running or building Apexo with native Bun terminals; the project and CI pin is Bun 1.4.4.
- **NEVER** downgrade the pin or restore a Windows-only older override without checking the applicable fixes and rerunning the actual PTY adapter regression. A JavaScript timeout cannot recover an event loop blocked in native `wait4`.
- Scope: runtime pins, CI runtime setup, and Bun PTY adapter changes. Node Desktop uses its separate Node PTY implementation.
- Verification: from `packages/apexo`, run `bun test ./test/server/pty-process.test.ts` with the proposed runtime. Preserve the concurrent test-worker check and its external watchdog, output, exit-code and late-subscription assertions. Also run the repository's required gates.
- Evidence: [BUG-20261025-013](../testing/test-stability/2026-10-25-acceptance-gates.md#bug-20261025-013--local-batch-reaches-its-watchdog-without-a-test-failure-report), four independent macOS hangs with the same symbolicated blocking path. [Upstream fix](https://github.com/oven-sh/bun/commit/bfa1209e35663056248406661f1b90851e5c72fa).
