# BUG-20261015-117: Guarded mutable properties lost narrowing inside deferred callbacks

- **Scope:** Native media fixtures and the native Shell worker; TypeScript callback boundaries.
- **Observed:** Apexo typechecking reported TS2339 for `tool.state.structured` inside an `Effect.promise` callback, although the runtime suite passed.
- **Expected:** The fixture uses the completed tool's proven saved path without weakening the discriminated union.
- **Root cause:** Narrowing of the nested mutable `tool.state` property does not carry safely into a later callback.
- **Fix:** Capture the saved path after the completed-state guard, then pass that stable string into the file-read callback. Assertions for MIME, extension and exact bytes remain unchanged.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the earlier WebP fixture.
- **Verification:** `bun typecheck` from `packages/apexo` passed after the correction. The final frozen runtime gate passed 14 tests / 104 assertions, including the captured-path WebP fixture.
- **Occurrences:** Five independent authoring episodes. See [RULE-20261015-012](../../rules/deferred-property-narrowing.md).

## Native Shell worker callback

A second independent episode occurred in the private native Shell worker. Core typechecking reported `TS2722: Cannot invoke an object which is possibly undefined` for `children.notify(...)` inside a nested Effect callback despite an outer property guard. The worker now captures `children?.notify` into a constant, checks that value and calls the same validated callback later. This does not cast away optional execution ownership. Corrected Core typechecking passed; the actual real-process owner test passed one test / 20 assertions, including terminal receipt before notification and cancellation settlement.


## Native S3 output fixture episode

The later native media-options fixture independently accessed `tool.state.structured.path` inside an `Effect.promise` callback after a completed-state guard. Its real HTTP suite passed four tests / 53 assertions, but package typechecking reported TS2339. The fixture now captures the path before creating the callback, retaining exact persisted-byte checks. Apexo package typechecking passed after this correction. This is the third independent occurrence of the guarded-property/deferred-callback mistake when composed with the Shell worker episode above. It is not another occurrence for each rerun, and runtime success did not establish type correctness.

Shared integration combines both independently verified corrections. The complete shared type gate passed all 21 tasks with exit zero; the combined Shell/media/Plan regression passed 68 tests / 623 assertions across twelve files.

## Native headless output callback episode

The separate headless output adapter narrowed `event.data` with an `assistantMessageID` membership check, then accessed the mutable property inside `Array.some`. Apexo typechecking rejected the lost narrowing. Binding the validated data value before constructing the callback preserved the canonical union; the final private package typecheck passed. This is the fourth independent callback-narrowing episode. The adapter's unrelated argv diagnostics and verification reruns are not additional occurrences. Shared adapter integration remains a later gate.


## Native socket LSP startup callback episode

Core typechecking of the native TCP transport candidate reported TS18048 and TS2345 when the bounded startup-notification callback accessed `input.workspaceOpen.solution` and `.projects` after outer guards. This is the same deferred mutable-property narrowing mistake, independently introduced in the transport slice. The client now captures the validated solution and projects into constants before constructing those callbacks. The first failed typecheck is excluded from verification; final package checks are recorded with [BUG-20261015-368](../runtime/native-lsp-socket-transport.md). This is the fifth independent occurrence, not an additional count for each diagnostic or rerun.
