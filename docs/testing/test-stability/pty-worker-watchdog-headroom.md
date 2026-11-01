# BUG-20261101-002: `pty-process.test.ts` concurrent worker watchdog clipped steady repetition #9/10 at 20s under macOS batch load

- Status: Fixed; standalone `pty-process.test.ts` and `APEXO_TEST_SHARD=1/6` batch 13/17 pass on Bun 1.4.4.
- Scope: `packages/apexo/test/server/pty-process.test.ts` (`rapid PTY exits survive concurrent test workers`), related to [RULE-20261025-001](../../rules/macos-pty-runtime.md) and [BUG-20261025-013](2026-10-25-acceptance-gates.md#bug-20261025-013--local-batch-reaches-its-watchdog-without-a-test-failure-report).

## Observed and expected behavior

During `GITHUB_ACTIONS=false bun turbo test --concurrency=2` on macOS (Bun 1.4.4, 507 test files across 17 round-robin batches), 16/17 `apexo` batches and all non-`apexo` packages passed, while `test/server/pty-process.test.ts` in batch 13/17 failed with child exit `137` (`SIGKILL`) at `20036ms`.

Unlike the Bun 1.3.14 native `wait4` deadlock (which stalls indefinitely on repetition #2), the worker log showed steady forward progress across repetitions #1 through #8 (`~1.88s–2.29s` per 30-PTY repetition, ~16.8s total plus worker startup) and was killed mid-way through repetition #9 by the hardcoded `20000ms` child watchdog. Even standalone on the same macOS host, 4 workers x 10 repetitions x 30 PTY spawns took `18650.88ms` (leaving `< 1.4s` margin below `20000ms`).

## Reproduction

Run `APEXO_TEST_SHARD=1/6 GITHUB_ACTIONS=false bun turbo test --filter=apexo --concurrency=2` on macOS when round-robin batch 13/17 pairs `test/server/pty-process.test.ts` with `test/session/command-sandbox-native-create.test.ts`.

## Root cause and fix

4 concurrent `bun test` workers spawning 1,200 total PTYs (`forkpty` + shell startup on macOS) require `~18.6s–22.5s` of steady wall-clock throughput on a loaded host, exceeding the `20000ms` child watchdog budget without any deadlock.

Increased the external child `SIGKILL` watchdog from `20000ms` to `35000ms` (and outer test timeout from `30000ms` to `45000ms`), preserving all 4 concurrent workers, 10 repetitions each, separate-process `SIGKILL` watchdog against infinite `wait4` stalls (`RULE-20261025-001`), and all 900 assertions per worker.

## Verification

- `bun test ./test/server/pty-process.test.ts` from `packages/apexo`: 3/3 pass.
- `APEXO_TEST_SHARD=1/6 GITHUB_ACTIONS=false bun turbo test --filter=apexo --concurrency=2`: all 3 batches (`1/17`, `7/17`, `13/17`) pass with 0 failures.
