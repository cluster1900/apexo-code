# BUG-20261101-702 — `SessionRunner` pre-output SSE retry re-subscribed accounting wrappers and amplified HTTP retries; Linux `bwrap` bridge port check and `--attempts 1` worktree routing

- **Bug ID**: `BUG-20261101-702`
- **Category**: Runtime (`runtime`)
- **Affected Scope**:
  - `packages/core/src/session/runner/llm.ts`
  - `packages/core/src/command-sandbox/linux.ts`
  - `packages/apexo/src/cli/cmd/run.ts`
  - `packages/apexo/src/cli/run-attempts.ts`
  - `packages/apexo/test/v2/doctor-and-v2-hardening.test.ts`
  - `packages/apexo/test/v2/sandbox-proxy-and-attempts.test.ts`
- **Occurrences**: 1 independent review episode.

## Observed Behavior

1. `SessionRunner` retried `providerStream` outside `WorkflowRole.track`, `SessionGoalUsage.track` / `trackTerminal`, and `headlessUsage`, and also retried `LLMError` with `retryable === true`:
   - Re-subscribing the outer stream left an unfinished receipt in `WorkflowRole.track`, triggered `goals.usageMissing` in `SessionGoalUsage` (`Stream.ensuring`), and left an incomplete `observe(call, false)` entry in `headlessUsage` (`usageIncomplete: true` even when retry succeeded).
   - Retrying `LLMError` in `SessionRunner` multiplied `RequestExecutor.execute`'s built-in 3 HTTP attempts (`1 + MAX_RETRIES`) into up to `3 x 3 = 9` HTTP requests on HTTP 429/5xx.
2. In `Bwrap.prepare` (`packages/core/src/command-sandbox/linux.ts`), launching the loopback-to-Unix-socket proxy bridge via `process.execPath -e` omitted `BUN_BE_BUN=1` (needed when compiled via `bun build --compile`) and did not fail closed before emitting the sandbox confirmation marker if `PROXY_PORT` was empty or non-numeric.
3. `apexo run --attempts 1` bypassed `runParallelAttempts` in `packages/apexo/src/cli/cmd/run.ts` (running in-place instead of an isolated Git worktree and skipping `--attempts` flag validation/JSON report format), and mid-loop worktree creation failures in `runParallelAttempts` did not clean up already-created `1..k-1` worktrees.

## Expected Behavior

1. Pre-output transient SSE `provider-error` retry must wrap `llm.stream(request)` inside `transport` so outer usage/workflow accounting streams subscribe once per provider turn, while HTTP status/transport retries remain solely owned by `RequestExecutor.execute` (`1 + 2 = 3` attempts).
2. Linux `bwrap` proxy bridge startup must pass `BUN_BE_BUN=1` only to the bridge subprocess and exit `126` before printing the confirmation marker if `PROXY_PORT` is empty or non-numeric.
3. Passing `--attempts` (for any valid `1..16`, including `1`) must route through `runParallelAttempts`, and any partial worktree creation error must remove already-created worktrees and the batch directory.

## Reproduction Steps

Run in `packages/apexo`:

```sh
bun test test/v2/doctor-and-v2-hardening.test.ts test/v2/sandbox-proxy-and-attempts.test.ts
```

## Root Cause

1. `runStreamWithRetry` wrapped `providerStream` instead of the inner `transport` stream factory and checked `err instanceof LLMError && err.retryable` on top of `RequestExecutor.execute`.
2. `Bwrap.prepare` assumed `process.execPath` always runs in Bun script mode and exported `HTTP_PROXY` without validating `$PROXY_PORT`.
3. `RunCommand.handler` gated `runParallelAttempts` on `args.attempts > 1`, and the worktree creation loop ran prior to the main `try / finally` cleanup block.

## Fix

1. Replaced `runStreamWithRetry` with `retryPreOutputStream` inside `transport` in `packages/core/src/session/runner/llm.ts` and removed duplicate `LLMError` retry handling from `SessionRunner`.
2. Scoped `BUN_BE_BUN=1` to the bridge invocation and added `case "$PROXY_PORT" in ''|*[!0-9]*) exit 126 ;; esac` prior to `printf "%s" "$1"` in `packages/core/src/command-sandbox/linux.ts`.
3. Routed all `args.attempts !== undefined` invocations in `packages/apexo/src/cli/cmd/run.ts` to `runParallelAttempts`, and added `Effect.onError` rollback for partially created worktrees in `packages/apexo/src/cli/run-attempts.ts`.

## Verification

- `bun turbo typecheck --concurrency=2`: passed across workspace.
- `cd packages/apexo && bun test test/v2/doctor-and-v2-hardening.test.ts test/v2/sandbox-proxy-and-attempts.test.ts`: 5 pass, 0 fail (124 `expect()` calls, verifying `usageIncomplete === false` after transient SSE retry, HTTP 503 capped at 3 requests, fail-closed `Bwrap.prepare` launcher script, and isolated `--attempts 1`).
