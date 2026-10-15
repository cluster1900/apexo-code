# BUG-20261014-204: Legacy Session fixtures compiled an unbound execution graph

- **Scope:** Legacy HTTP, Session, tool and end-to-end fixtures directly compiling
  graphs containing the compatibility Session service.
- **Status:** Verified by the 22-file focused fixture gate; shared whole-suite gate pending.
- **Independent occurrences:** One dependency-boundary change exposed multiple
  callsites in the same full-suite checkpoint; each file is not a separate recurrence.
- **Observed:** The whole unit suite failed while importing eleven HTTP fixture
  files with `Unbound layer node: @apexo/example/LocationServiceMap`. Tests did not
  reach assertions. Additional Session and tool fixtures used the same raw graph boundary.
- **Expected:** Application fixtures bind the real native Location map before compiling
  Session's execution dependency, retaining native cancellation on session deletion.
- **Reproduction:** Run `bun test test/server/session-messages.test.ts test/server/session-diff-missing-patch.test.ts`
  from `packages/apexo` with the original direct `LayerNode.compile` fixture calls.
- **Root cause:** Compatibility `Session.node` now requires `SessionExecutionLocal.node`
  to stop native execution before deletion. That implementation has an intentionally
  unbound LocationServiceMap dependency. Raw LayerNode compilation rejects it eagerly;
  merging an HTTP layer afterward cannot bind a graph that failed to compile.
- **Fix:** Build affected compatibility fixture graphs with `AppNodeBuilderV1.build`.
  The feature fixture that explicitly supplies its own bootstrap uses Core
  `AppNodeBuilder.build` to preserve that replacement (see [BUG-20261014-206](explicit-bootstrap-replacement.md)).
  The separately bound native SessionV2 graph
  in the prompt tests remains unchanged. No no-op executor, global compiler fallback,
  production builder change or removal of cancellation was introduced for this fix.
- **Verification:** `bun test --timeout 30000` with the 22 migrated HTTP, Session,
  tool and E2E fixture files from `packages/apexo`: 264 passed, two existing skips,
  zero failures, 1,053 assertions. `bun typecheck` from the same package also passed.
  The separate shared-graph shutdown investigation and native MCP service-identity
  collision are not counted as this root cause. The final gate includes the MCP fix.

The final complete unit/build graph passed all six Turbo tasks: 3906 tests passed, 19 skipped, one todo, zero failures, 12477 assertions across 324 files. The subsequent serialized repository typecheck passed all 21 tasks.
