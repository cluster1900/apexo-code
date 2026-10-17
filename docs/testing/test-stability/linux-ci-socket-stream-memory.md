# BUG-20261017-001 — Linux CI socket backlog, stdio pipe flush, and memory operation settlement races

- **Bug ID**: `BUG-20261017-001`
- **Category**: Test stability / Runtime (`test-stability`)
- **Affected Scope**:
  - `packages/apexo/test/fixture/lsp-native-socket.ts` (`packages/apexo/test/v2/lsp-socket-native.test.ts`)
  - `packages/apexo/test/v2/memory-legacy-native.test.ts`
  - `packages/apexo/src/cli/cmd/acp.ts` (`packages/apexo/test/cli/acp/grok-backend.test.ts`)
  - `packages/apexo/test/v2/monitor-execution.test.ts`
  - `packages/apexo/script/run-tests.ts`
- **Occurrences**: 1 independent Linux CI episode (`unit (linux)` on PR #4).

## Observed Behavior

1. **`lsp-socket-native.test.ts` (`native socket deadline also bounds a pending TCP connection`)**:
   - Failed on Ubuntu GitHub Actions with `expect(connected.size).toBeLessThan(connections.length) | Expected: < 512 | Received: 512`.
2. **`memory-legacy-native.test.ts` (`automatic flush waiting on maintenance lock honors disable without stale publication`)**:
   - Failed on Ubuntu GitHub Actions with `expect((yield* operations.get(session.id, receipt.id)).result?.status).toBe("failed") | Expected: "failed" | Received: undefined`.
3. **`grok-backend.test.ts` (`Grok ACP proxy forwards multi-megabyte replies without truncating frames`)**:
   - Failed on Ubuntu GitHub Actions with `expect(frames.length).toBe(2) | Expected: 2 | Received: 1` when forwarding two 2.1 MB NDJSON frames.
4. **`monitor-execution.test.ts` (`debounces persistent monitor events per session, preserves split UTF-8, supports stop and rearm without replay, and bounds output`)**:
   - Failed when the initial split UTF-8 `stdout` chunk (`FIRST\360\237` + `\230\200\n`) and `stderr` chunk (`ERROR中文\n`) straddled the 200ms debounce timer boundary on Linux `/bin/sh` (`dash`).

## Expected Behavior

1. Stopping the native LSP socket fixture with `SIGSTOP` saturates its TCP accept backlog well before 512 concurrent connection attempts on both macOS and Linux.
2. Disabling automatic memory mode while an operation is parked on the maintenance lease resolves the operation receipt to terminal `failed` status before the test assertion inspects `result.status`.
3. `apexo acp --backend grok-build` flushes all forwarded `stdout` and `stderr` write chunks to the parent pipe before the CLI process exits.
4. Both initial `stdout` and `stderr` chunks are present in the monitor buffer before asserting on the first debounced event batch.

## Reproduction Steps

Run the affected tests on Linux (or locally):

```sh
bun test test/v2/lsp-socket-native.test.ts test/v2/memory-legacy-native.test.ts test/cli/acp/grok-backend.test.ts test/v2/monitor-execution.test.ts
```

## Root Cause

1. **Bun `net.Server.listen` backlog**: Bun ignores the `backlog` option in `server.listen({ port: 0, host: "127.0.0.1", backlog: 1 })` and calls the kernel `listen(fd, SOMAXCONN)` syscall (`128` on macOS, `4096` on Linux). Because `4096 > 512`, the Linux kernel TCP stack completed the 3-way handshake for all 512 sockets even while the user-space server process was stopped.
2. **Memory mode disable vs. operation receipt persistence**: `MemoryModeNative` resolves `worker.done` inside the inner `Effect.acquireRelease` release finalizer when interrupting the worker fiber, which allows `modes.set(..., false, false)` to return slightly before the outer `Effect.onExit` in `MemoryOperation` finishes persisting the `failed` receipt to SQLite.
3. **Node/Bun `pipeline(..., process.stdout, { end: false })` drain**: `pipeline(agent.stdout!, process.stdout, { end: false })` resolves as soon as the source stream ends after passing the final chunk to `process.stdout.write(chunk)`, without waiting for `process.stdout`'s write callback to finish draining user-space buffered chunks into the 64 KB Linux pipe before `process.exit()` runs.
4. **Monitor initial split-chunk timing**: Two sequential `sleep 0.03` external process spawns under `/bin/sh` (`dash`) on loaded CI runners could delay the second half of the split UTF-8 sequence past the 200ms debounce timer started by the first bytes.

## Fix

1. In `packages/apexo/test/fixture/lsp-native-socket.ts`, invoke `listen(fd, 1)` via `bun:ffi` (`libSystem.B.dylib` on macOS, `libc.so.6` on Linux) inside the `server.listen` callback so the kernel updates `sk_max_ack_backlog` to `1`.
2. In `packages/apexo/test/v2/memory-legacy-native.test.ts`, use `settled(operations, session, receipt.id)` (matching the `clear`/`deny` branch right below it) when asserting the terminal status of the interrupted operation receipt.
3. In `packages/apexo/src/cli/cmd/acp.ts`, replace `pipeline(..., { end: false })` with an explicit `forward(source, target)` loop that awaits the `target.write(chunk, callback)` completion callback for every chunk before returning.
4. In `packages/apexo/test/v2/monitor-execution.test.ts`, shorten the inter-byte delay from `sleep 0.03` to `sleep 0.01` and await `awaitOutput("😀")` and `awaitOutput("ERROR中文")` before `awaitPending`.
5. In `packages/apexo/script/run-tests.ts`, emit a separate `::error` annotation for each `(fail)` block in a failed batch.

## Verification

- Verified focused test execution in `packages/apexo`:
  - `bun test test/v2/lsp-socket-native.test.ts test/v2/memory-legacy-native.test.ts test/cli/acp/grok-backend.test.ts test/v2/monitor-execution.test.ts` (all 4 files pass).
  - `bun typecheck` in `packages/apexo` passes.
