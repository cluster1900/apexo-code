# BUG-20261017-001 — Linux CI socket backlog, stdio pipe flush, and test settlement/clock races

- **Bug ID**: `BUG-20261017-001`
- **Category**: Test stability / Runtime (`test-stability`)
- **Affected Scope**:
  - `packages/apexo/test/fixture/lsp-native-socket.ts` (`packages/apexo/test/v2/lsp-socket-native.test.ts`)
  - `packages/apexo/test/v2/memory-legacy-native.test.ts`
  - `packages/apexo/test/v2/memory-batch-dream-native.test.ts`
  - `packages/apexo/src/cli/cmd/acp.ts` (`packages/apexo/test/cli/acp/grok-backend.test.ts`, `packages/apexo/test/cli/acp/lifecycle.test.ts`)
  - `packages/apexo/test/v2/monitor-execution.test.ts`
  - `packages/apexo/test/v2/process-execution.test.ts`
  - `packages/apexo/test/v2/session-mcp-attachment.test.ts`
  - `packages/apexo/test/cli/run/run-process.test.ts`
  - `packages/apexo/script/run-tests.ts`
- **Occurrences**: 3 Linux CI runs (`unit (linux)` on PR #4 and PR #142).
- **Linked Constraint**: [RULE-20261023-001](../../rules/pid-file-polling.md)

## Observed Behavior

1. **`lsp-socket-native.test.ts` (`native socket deadline also bounds a pending TCP connection`)**:
   - Failed on Ubuntu GitHub Actions with `expect(connected.size).toBeLessThan(connections.length) | Expected: < 512 | Received: 512`.
2. **`memory-legacy-native.test.ts` (`automatic flush waiting on maintenance lock honors disable without stale publication` and `automatic idle source is invalidated by deny before provider admission`)**:
   - Failed on Ubuntu GitHub Actions when reading `operations.get(...)` or `operations.list(...)` before the interrupted operation finished writing its terminal `result.status` to SQLite.
3. **`grok-backend.test.ts` (`Grok ACP proxy forwards multi-megabyte replies without truncating frames`)**:
   - Failed on Ubuntu GitHub Actions with `expect(frames.length).toBe(2) | Expected: 2 | Received: 1` when forwarding two 2.1 MB NDJSON frames.
4. **`lifecycle.test.ts` (`apexo acp lifecycle subprocess > stdin EOF exits cleanly`)**:
   - Timed out when `acp.close()` closed `stdin` immediately on subprocess startup because `ReadableStream` in `src/cli/cmd/acp.ts` attached `process.stdin.on("data", ...)` (resuming `stdin`) before `Effect.logInfo("setup connection")` yielded and before the `process.stdin.on("end", ...)` shutdown listener was attached.
5. **`monitor-execution.test.ts` (`real unconfined Monitor preserves split UTF-8 pipes, Stop epochs, terminal ordering and owner deletion`)**:
   - Failed when the initial split UTF-8 `stdout` chunk (`FIRST\360\237` + `\230\200\n`) and `stderr` chunk (`ERROR中文\n`) straddled the 200ms debounce timer boundary on Linux `/bin/sh` (`dash`).
6. **`process-execution.test.ts` (`real shell owner returns live preview, settles before notice, consumes once and joins cancellation`)**:
   - `fileText(name)` returned `""` if it polled a PID file immediately after `/bin/sh` opened the file with `O_CREAT | O_TRUNC` and before `echo $$` wrote the PID bytes, causing `Number("")` to evaluate to `0` (`process.kill(0, 0)` checks the caller's own process group and never throws).
7. **`session-mcp-attachment.test.ts` (`retained snapshot bytes are capped and expiration releases capacity without rereading expired handles`)**:
   - `TestClock.setTime(first.expiresAt + 1)` left `second` unexpired whenever reserving `second` took `>= 2ms` longer than `first`.
8. **`memory-batch-dream-native.test.ts` & `run-process.test.ts`**:
   - Under 3-worker shard concurrency and 11 concurrent `cliIt.concurrent` full CLI subprocess cold-starts on a 4-vCPU runner, `apexo.run` (30s) and `settled` (10s for 21 topic file writes) timed out due to CPU contention.

## Expected Behavior

1. Stopping the native LSP socket fixture with `SIGSTOP` saturates its TCP accept backlog well before 512 concurrent connection attempts on both macOS and Linux.
2. Interrupted memory operations settle their SQLite receipt before tests assert terminal status.
3. `apexo acp` flushes all forwarded `stdout` and `stderr` write chunks before exiting and never drops an early `stdin` EOF that arrives during startup.
4. Monitor and process execution tests wait for non-empty PID files and decoded stream output before asserting on debounced events or process group termination.
5. `TestClock` advances past both reserved attachment operations' expiration timestamps.

## Reproduction Steps

Run the affected suites in `packages/apexo`:

```sh
bun test test/v2/lsp-socket-native.test.ts test/v2/memory-legacy-native.test.ts test/v2/memory-batch-dream-native.test.ts test/cli/acp/grok-backend.test.ts test/cli/acp/lifecycle.test.ts test/v2/monitor-execution.test.ts test/v2/process-execution.test.ts test/v2/session-mcp-attachment.test.ts test/cli/run/run-process.test.ts
```

## Root Cause

1. **Bun `net.Server.listen` backlog**: Bun ignores the `backlog` option in `server.listen({ port: 0, host: "127.0.0.1", backlog: 1 })` and calls the kernel `listen(fd, SOMAXCONN)` syscall (`128` on macOS, `4096` on Linux).
2. **Memory mode disable / invalidation vs. operation receipt persistence**: `MemoryModeNative` resolves `worker.done` inside the inner `Effect.acquireRelease` release finalizer when interrupting the worker fiber, which can complete slightly before the outer `Effect.onExit` in `MemoryOperation` finishes persisting the terminal receipt to SQLite.
3. **Node/Bun `pipeline(..., process.stdout, { end: false })` drain**: `pipeline(agent.stdout!, process.stdout, { end: false })` resolves when `agent.stdout` ends rather than when `process.stdout`'s write callback drains buffered chunks into the 64 KB Linux pipe.
4. **Early `stdin` EOF race in `acp.ts`**: `process.stdin.on("data", ...)` puts `process.stdin` into flowing mode immediately; if `stdin` was already closed by the parent, `"end"` can fire across `yield* Effect.logInfo("setup connection")` before `process.stdin.on("end", ...)` is registered.
5. **Empty PID file read & `TestClock` timestamp delta**: `fileText` accepted an empty string before `echo $$` wrote bytes (`Number("") === 0`), and `TestClock.setTime(first.expiresAt + 1)` assumed `second.expiresAt <= first.expiresAt + 1`.

## Fix

1. In `packages/apexo/test/fixture/lsp-native-socket.ts`, invoke `listen(fd, 1)` via `bun:ffi` inside the `server.listen` callback so the kernel updates `sk_max_ack_backlog` to `1`.
2. In `packages/apexo/test/v2/memory-legacy-native.test.ts`, await `settled(operations, session, ...)` before asserting terminal receipt status.
3. In `packages/apexo/src/cli/cmd/acp.ts`, register the `stdin` `"end"` / `"close"` promise before constructing the `ReadableStream` (and resolve immediately if `process.stdin.readableEnded`), and use an explicit `forward(source, target)` loop that awaits `target.write(chunk, callback)`.
4. In `packages/apexo/test/v2/monitor-execution.test.ts`, shorten the inter-byte delay to `sleep 0.01`, await `awaitOutput("😀")` and `awaitOutput("ERROR中文")` before `awaitPending`, validate `Number.isInteger(pid) && pid > 0` when polling `deleting`, and await `jobs.wait({ id: deleted.id })` after `sessions.remove(parent.id)`.
5. In `packages/apexo/test/v2/process-execution.test.ts`, require non-empty trimmed text in `fileText`.
6. In `packages/apexo/test/v2/session-mcp-attachment.test.ts`, advance `TestClock` to `Math.max(first.expiresAt, second.expiresAt) + 1`.
7. In `packages/apexo/test/v2/memory-batch-dream-native.test.ts`, `packages/apexo/test/cli/run/run-process.test.ts`, and `packages/apexo/script/run-tests.ts`, use `30 seconds` for batch Dream settlement, `cliIt.live` for full CLI subprocess tests, and cap default shard concurrency at `2`.
8. In `packages/apexo/test/tool/memory-health.test.ts`, unlink `memory_state.sqlite` before writing corrupt bytes so `writeFile` creates a new inode unaffected by any deferred WAL checkpoint on the prior connection while keeping `native.query` in `sqlite.bun.ts` for recovery crash fixtures.

## Verification

- Verified focused test execution and `bun typecheck` in `packages/apexo`.
