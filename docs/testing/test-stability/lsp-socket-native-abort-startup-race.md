# BUG-20261101-705 — `lsp-socket-native.test.ts` abort startup timeout race and mismatched trace baseline counter

- **Bug ID**: `BUG-20261101-705`
- **Category**: Test stability (`test-stability`)
- **Affected Scope**:
  - `packages/apexo/test/v2/lsp-socket-native.test.ts` (`native socket startup timeout, abort, malformed frame and hung shutdown join connection cleanup without killing server`)
- **Occurrences**: 1 Linux CI run (`apexo tests (3/6)` on PR #196)
- **Linked Constraint**: None (1 occurrence)

## Observed Behavior

On Ubuntu GitHub Actions (`apexo tests (3/6)`), `native socket startup timeout, abort, malformed frame and hung shutdown join connection cleanup without killing server` failed at `1327.25ms` with an unhandled `DOMException` (`TimeoutError` from `AbortSignal.timeout(500)`) followed by `# Unhandled error between tests: error: Timed out: held initialization` at `lsp-socket-native.test.ts:37:13` while the trailing test in the file was running.

## Expected Behavior

1. Each iteration (`"hang"`, `"abort"`, `"frame"`, `"shutdown-hang"`) compares `"initialize"` trace events against the pre-iteration `"initialize"` count (`beforeInit`) and `"close"` trace events against the pre-iteration `"close"` count (`beforeClose`).
2. Non-timeout modes (`"abort"`, `"frame"`, `"shutdown-hang"`) do not race a 500ms `startupTimeout` against child JSON-RPC handshake under CI CPU contention, and `"abort"` specifically verifies cancellation (`"cancel startup"`).
3. `pending` always has a settlement observer attached before `await poll(...)` runs so an early rejection can neither trigger an unhandled promise rejection nor leave an orphaned 5-second `poll` loop running between tests.

## Reproduction Steps

Run the socket transport test suite in `packages/apexo`:

```sh
bun test test/v2/lsp-socket-native.test.ts
```

## Root Cause

1. **Mismatched baseline counter (`close` vs `initialize`)**: The loop computed `const before = (await trace(server.root)).filter((row) => row.event === "close").length`, then polled `(await trace(server.root)).filter((row) => row.event === "initialize").length > before` during `mode === "abort"`. Whenever the preceding `"hang"` iteration timed out at 500ms after TCP `connect` but before the child process dispatched JSON-RPC `initialize`, `"hang"` incremented `"close"` to `1` while `"initialize"` stayed `0`. In `"abort"`, the child received `"initialize"` (`length === 1`), leaving `1 > 1` permanently `false`.
2. **500ms `startupTimeout` shared across `"abort"` and unguarded `pending` promise**: Because `"abort"` also used `startupTimeout: 500` and `expect(pending).rejects.toThrow()` was not reached until after `await poll(...)`, `AbortSignal.timeout(500)` rejected `pending` unhandled during `await poll(...)` and left the uncancelled `poll` loop running across test teardown until its 5000ms deadline threw between tests.

## Fix

In `packages/apexo/test/v2/lsp-socket-native.test.ts`:

1. Track `beforeClose` (`row.event === "close"`) and `beforeInit` (`row.event === "initialize"`) separately at the start of each mode iteration.
2. Use `startupTimeout: mode === "hang" ? 500 : 5000` so `"hang"` still exercises the 500ms startup deadline while `"abort"`, `"frame"`, and `"shutdown-hang"` have headroom under CI load, and assert `rejects.toThrow("cancel startup")` for `"abort"`.
3. Attach a settlement observer (`pending.then(...)`) immediately upon creating `pending` (both in the startup-abort loop and the hover-cancellation test) and short-circuit `poll` when `state.settled` flips to `true`, preventing unhandled rejections and orphaned polling loops.

## Verification

- `cd packages/apexo && bun test test/v2/lsp-socket-native.test.ts`: 12 passed, 0 failed (38 assertions).
- `cd packages/apexo && bun typecheck`: passed (`tsgo --noEmit` exited 0).
