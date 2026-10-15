# Native Memory recovery used a Bun-only file probe

- Bug ID: BUG-20261015-290.
- Scope: Native recovery preview in the packaged Electron/Node backend.
- Status: Fixed and verified in shared source CLI and rebuilt packaged Desktop.
- Independent occurrences: One implementation defect. Recovery and retry acceptance exposed the same defect, not two independent authoring episodes.

The shared source CLI passed recovery and exact-retry acceptance, but both freshly rebuilt Desktop counterparts returned HTTP503 while inspecting a prepared discard after process restart. The initial missing-scope preview succeeded. Expected behavior is the same bounded, permission-checked recovery preview on both backends, with no provider request.

Reproduce from `packages/apexo` after rebuilding Desktop: `bun script/grok-memory-recovery-native.mjs desktop` or `bun script/grok-memory-retry-native.mjs desktop`. Both failures occurred before any provider request. A diagnostic-only bundle run exposed `MemoryCaptureError` with `ReferenceError: Bun is not defined`; the original build artifact was restored byte-for-byte afterward. The diagnostic run is retained as failure evidence, not acceptance.

`MemoryCapture.inspectRecovery` called `Bun.file(...).exists()` only after finding an existing Memory scope. Electron executes that shared Core path under Node, where the Bun global is absent. Unit tests and the source CLI run under Bun and therefore did not expose this runtime dependency.

The correction follows the adjacent revision probe: use the already imported Node-compatible `lstat`, treat only `ENOENT` as an absent database, and propagate other filesystem failures. Existing canonical path, permission, read-only database and ownership checks remain in place. No polyfill, error suppression, permission bypass or weaker assertion is introduced.

Verification after the correction:

- From `packages/apexo`, `bun test --timeout 30000 test/v2/memory-dream-native.test.ts test/tool/memory-recovery.test.ts`:24 tests/162 assertions pass.
- `bun typecheck` from `packages/core`:passed. The preceding all 21 repository typechecks passed before this narrow portable probe amendment.
- `bun run build` from `packages/desktop`:passed using the isolated local model catalog.
- `bun script/grok-memory-recovery-native.mjs desktop`:six checks pass, zero provider calls.
- `bun script/grok-memory-retry-native.mjs desktop`:nine checks pass, zero provider calls.
- Both corresponding `cli` commands pass again after the correction: six and nine checks, zero provider calls.

All commands exited zero and owned processes were reaped. The unchanged real HTTP assertions now succeed under the actual Electron/Node runtime; no mock Bun global or diagnostic artifact is used for the passing runs.
