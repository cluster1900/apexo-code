# BUG-20261015-382: AppNodeBuilder created duplicate rewritten nodes across replacements and hoisted location services

Status: **Fixed and verified** (2026-10-15).

## Scope and observed behavior

- Scope: `packages/core/src/effect/layer-node.ts` (`AppNodeBuilder.build`, `AppNodeBuilder.hoist`, `replacementMapFrom`, `compile`), affecting `packages/apexo/test/v2/task-background-ownership.test.ts` and `packages/apexo/test/e2e/v2-media-options.e2e.test.ts`.
- Observed behavior:
  - In `test/v2/task-background-ownership.test.ts`, both tests failed with `Error: Tag global has conflicting implementations for @apexo/ProjectV2`.
  - When `Database.node` or `Global.node` was replaced in `AppNodeBuilder.build(locationServices, ...)` (as in `TestInstance` and `task-background-ownership.test.ts`), `Location.boundNode(ref)` (a replacement in `allReplacements`) and `ProjectCopy.node` (a dependency of `locationServices`) both depended on `Project.node` (`@apexo/ProjectV2`, tag `global`).
  - Because `replacementMapFrom` and `hoist`/`compile` allocated separate `rewriteCache` maps when cloning nodes whose transitive dependencies were replaced, `Project.node` was cloned into two distinct `AppNode` object references with the same `id` (`@apexo/ProjectV2`) and `tag` (`global`), triggering the conflicting implementation error in `hoist` and compiling duplicate location-scoped services (such as `SessionMemoryOperation`) when a node was shared between `root` and `replacements`.

## Expected behavior

- A single `AppNodeBuilder.build` or `AppNodeBuilder.hoist` invocation must share one `rewriteCache` across `replacementMapFrom` and the subsequent graph walk, caching rewritten nodes under both the original node and the rewritten clone so that any node shared between `root` and `replacements` resolves to the exact same rewritten `AppNode` reference.

## Reproduction steps

1. Run `bun test test/v2/task-background-ownership.test.ts` from `packages/apexo` before the fix.
2. Observe `Error: Tag global has conflicting implementations for @apexo/ProjectV2` thrown from `hoist` in `packages/core/src/effect/layer-node.ts`.

## Root cause and fix

- Root cause: `replacementMapFrom` created a local `new Map()` for `rewriteNodeWithReplacements`, and `hoist` / `compile` each created another local `new Map()`, nor did they rewrite `root` with the shared cache before walking `node.dependencies`.
- Fix in `packages/core/src/effect/layer-node.ts`:
  - Passed a shared `rewriteCache` into `replacementMapFrom`, `hoist`, and `compile`.
  - Cached rewritten nodes under both `target` and `result` in `rewriteNodeWithReplacements`.
  - Applied `rewriteNodeWithReplacements(root, map, rewriteCache)` at the entry of both `hoist` and `compile`.
- Added a direct regression unit test in `packages/apexo/test/effect/app-node-builder-v1.test.ts` (`shared rewriteCache prevents conflicting implementations when replacements and hoisted location services share a dependency`).

## Verification commands and results

- `bun test test/effect/app-node-builder-v1.test.ts test/v2/task-background-ownership.test.ts` (from `packages/apexo`) → `4 pass, 0 fail`.
- `bun typecheck` (from `packages/core` and `packages/apexo`) → exited `0`.
