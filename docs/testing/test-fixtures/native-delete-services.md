# BUG-20261014-134: Native deletion fixture omitted a public service binding

- Scope: New native Session deletion regression fixture.
- Observed: The test failed with Service not found for SessionHookSnapshot before exercising deletion.
- Expected: A service directly yielded by the fixture must be in its exposed AppNode group.
- Root cause: The snapshot service was a transitive production dependency but was omitted from the test's public layer group.
- Fix: Add SessionHookSnapshot.node to the fixture group, preserving the real shared implementation.
- Reproduction: Run `bun test test/session/native-delete.test.ts` from packages/apexo with the earlier fixture.
- Verification: Corrected fixture reached the intended deterministic deletion assertion and reproduced BUG-20261014-140. This construction error is separate from the product race; green deletion verification is recorded there.
- Occurrences: Eight independent omitted-public-binding fixture construction errors, detailed below.

## Compatibility prompt fixture affected by the same dependency integration

After Session removal acquired the native execution service, the compatibility prompt tests still used raw `LayerNode.compile` without a concrete LocationServiceMap replacement. Their module registration failed before any prompt tests ran. Add the existing production `locationServiceMapLayer` to both `makePrompt` and `makeHttp` replacement lists. The corrected four-file snapshot/Runner/prompt batch passed 117 tests, one pre-existing skip, and 530 assertions. This is another fixture affected by the same dependency integration, not an invented independent recurrence of the exact initial omitted-export error.

## Native MCP recovery fixture: independent omitted global export

The new MCP recovery test initially requested `LocationRuntimeGuard.Service` from the Location service map even though the guard is process-global. Its root AppNode group also omitted the guard and EventV2 services that the test directly consumes. The first focused run passed 11 tests and failed this test with `Service not found: @apexo/LocationRuntimeGuard` before reaching recovery assertions.

The fixture now explicitly exports both global nodes and captures the guard from the root application context before entering Location contexts. No production service lifetime changed. From `packages/apexo`, `bun test test/v2/mcp-native.test.ts` passed 12 tests, 97 assertions, and completed scoped teardown. This is the second independent omitted-public-binding occurrence tracked here; the compatibility dependency integration described above remains part of the original episode. The later native LSP policy fixture provides the third independent occurrence, described below.

## Native LSP policy fixture: independent omitted global export

The new automatic-restart policy fixture directly yielded `LocationRuntimeGuard.Service` to hold real Location work during crash recovery. Its AppNodeBuilder root group exposed SessionV2, LocationServiceMap, and EventV2, but omitted the global guard. The isolated draft run failed with `Service not found: @apexo/LocationRuntimeGuard` before its busy-recovery assertions; this was fixture construction, not a production restart failure.

The fixture now explicitly includes `LocationRuntimeGuard.node` in its root group, retaining the real shared guard. The corrected draft suite passed six tests and 47 assertions. After integration and additional policy boundary checks, `bun test test/v2/lsp-policy-native.test.ts test/v2/lsp-native.test.ts test/v2/plugin-bundle-runtime.test.ts` from `packages/apexo` passed 12 tests and 129 assertions with scoped child cleanup. This is the third independent fixture omitted-public-output occurrence; it is distinct from production LocationServices exposure in BUG-20261014-062. The recurring requirement is now [RULE-20261015-001](../../rules/fixture-appnode-public-services.md).

## Native Task authority fixture: independent omitted global export

The Task permission fixture directly yielded the process-global PermissionSaved service inside a Location context, while omitting PermissionSaved.node from its root public group. Its first behavior run failed with Service not found before policy assertions. The correction exposes the actual global service at the root and captures it before entering the Location map. `bun test test/v2/task-authority.test.ts` passed one test and 12 assertions in isolated draft validation, including sibling consent isolation and an empty project saved-grant list. The authority/store checkpoint passed two tests and 28 assertions. This is the fourth independent omitted-public-binding episode, covered by the existing RULE-20261015-001; it does not add a new constraint.

## Managed-child ownership fixture: independent omitted global export

The new ownership test reconstructs the real `SessionManagedChild.make` service against the same database to verify persisted authority. Its public AppNode group exposed the managed service but omitted SessionLifecycle, which the constructor directly consumes. The first run failed with `Service not found: @apexo/SessionLifecycle` after one assertion, before reconstruction checks.

The fixture now exposes `SessionLifecycle.node` in its root group. No production dependency changed. `bun test test/workflow/managed-ownership.test.ts` passed one test and 26 assertions, including reconstruction, stale proof refusal, atomic rollback, historical quarantine and Session-ID reuse. This is the fifth independent omitted-public-binding episode under the existing RULE-20261015-001; no new rule is introduced.

## Native Shell Goal-accounting fixture: omitted public Goal output

The new Shell owner regression directly yielded `SessionGoal.Service`, but an automated edit failed to add `SessionGoal.node` to the formatted root AppNode public group. The run failed with `Service not found: @apexo/SessionGoal` before the intended captured-attempt assertion. The service existed transitively through completion dependencies; that did not expose it to the test.

The fixture now explicitly exports the Goal node. The corrected pre-fix test then reproduced the distinct captured Goal admission defect (BUG-20261015-130); after that product correction, the real owner test passed one test / 42 assertions. This is the sixth independent omitted-public-binding episode under [RULE-20261015-001](../../rules/fixture-appnode-public-services.md). No production dependency lifetime was changed to accommodate the fixture.

## Native legacy Memory fixture: private leaf access

Two new native legacy tests requested MemoryLegacyNative.Service through the production Location map. That leaf is intentionally private behind the exposed MemoryLifecycleNative facade, and both failed with `Service not found` before the new assertions. The fixture now uses prepareFlush/executeLegacy on the public facade and decodes the canonical legacy Plan. No production aggregate export was added. The corrected focused suite passes 8 tests / 45 assertions. This is one independent fixture-authoring episode, the seventh omitted-public-service episode; the two failed tests are not counted separately.

## Active Task delivery Goal fixture: omitted public Goal output

The new delivery boundary fixture directly consumed SessionGoal.Service but omitted SessionGoal.node from its public AppNode group. The first run failed with Service not found before Goal assertions. Adding the real public node preserves service lifetime. The corrected delivery store and HTTP suite passed six tests / 97 assertions, including paused/exhausted Goal rejection before launch closure. This is an eighth independent omitted-public-output episode under RULE-20261015-001; no new rule is introduced.
