# BUG-20261016-385: Legacy Flush Direct Execution Fallback Operation ID and Cache Path

- **Bug ID**: `BUG-20261016-385`
- **Category**: `runtime`
- **Affected Scope**:
  - `packages/core/src/memory-legacy-native.ts`
  - `packages/apexo/test/v2/memory-legacy-native.test.ts`

## Observed Behavior

1. Invoking `MemoryLifecycleNative.executeLegacy(plan)` directly without `optionsInput` failed immediately with `SchemaError: Expected a string matching /^mop_[a-zA-Z0-9-]+$/, actual "legacy-flush"` because `MemoryLegacyNative.execute` constructed `MemoryOperation.ID.make("legacy-flush")` as its fallback operation ID.
2. When semantic flush deduplication was enabled, `MemoryLegacyNative.execute` checked permission access for `search.sqlite` under `path.dirname(file)` (`<workspaceRoot>/sessions/search.sqlite`) rather than `scope.root` (`<workspaceRoot>/search.sqlite`).

## Expected Behavior

1. Direct calls to `MemoryLegacyNative.execute(plan)` without `optionsInput` must use a schema-valid fallback operation ID (`MemoryOperation.ID.make("mop_legacy-flush")`).
2. Permission checks for the legacy search SQLite index during semantic flush deduplication must resolve against `scope.root` (`<workspaceRoot>/search.sqlite` or `<workspaceRoot>/search-${generation}.sqlite`).

## Reproduction Steps

1. Run `bun test test/v2/memory-legacy-native.test.ts` in `packages/apexo` where tests call `memory.executeLegacy(plan)` directly without `optionsInput`.
2. Observe `SchemaError` at `MemoryLegacyNative.execute` line 503.

## Root Cause

`MemoryOperation.ID` enforces the `^mop_[a-zA-Z0-9-]+$` brand pattern, and `target(plan)` resolves inside the `sessions/` subdirectory of the workspace memory root (`scope.root`).

## Fix

1. Updated the fallback operation ID in `packages/core/src/memory-legacy-native.ts` from `MemoryOperation.ID.make("legacy-flush")` to `MemoryOperation.ID.make("mop_legacy-flush")`.
2. Updated `cacheFile` in `packages/core/src/memory-legacy-native.ts` to join `scope.root` instead of `path.dirname(file)`.

## Verification

- `bun typecheck` in `packages/core` and `packages/apexo`: passed (`0` errors).
- `bun test --timeout 30000 test/tool/memory-search.test.ts test/v2/memory-legacy-native.test.ts test/v2/memory-native.test.ts test/v2/memory-context.test.ts test/v2/memory-session.test.ts` in `packages/apexo`: **84 pass, 0 fail** (including 15/15 in `memory-search.test.ts` with 128 assertions and 50/50 in `memory-legacy-native.test.ts`).

