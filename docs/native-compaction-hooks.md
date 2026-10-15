# Native compaction hook observers

The native Session compactor dispatches `PreCompact` and `PostCompact` using the Session's captured hook registry. The matcher and payload `source` are `manual` for an explicit control and `auto` for automatic context compaction. This is Apexo-owned execution; the installed Grok runtime is only a behavioral reference.

Registry capture occurs after compaction eligibility checks. PreCompact runs after the existing Started event and before the summarization provider request. PostCompact runs after the existing durable Ended event. Both calls use the same immutable captured registry. Editing hook files does not change an already captured Session; explicit Session hook reload remains the configuration boundary.

These are observers: denial output, nonzero exit status, and dispatch errors do not veto compaction, inject context, retry a provider request, or undo committed history. Parent cancellation still interrupts dispatch and joins cleanup. Empty/ineligible compaction emits neither event. Failed or cancelled summarization emits no PostCompact. Cancellation during PostCompact preserves the already committed compaction. All work stays inside the existing native control or drain owner, without a separate long mutation lease.

## Reference boundary

The pinned source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` declares PreCompact/PostCompact observational, matcher-tested events in `crates/codegen/xai-grok-hooks/src/event.rs`. The shell compactor chooses manual/auto source and awaits the pre/post observers around summarization in `crates/codegen/xai-grok-shell/src/session/compaction.rs`. The observer dispatcher ignores veto output.

An isolated installed-runtime comparison passed five checks with five total provider calls: a populated manual compaction emitted PreCompact before summarization and PostCompact afterward despite exit code 2; provider failure emitted PreCompact without PostCompact. The reference also summarized an initially empty Session and emitted both hooks. Apexo preserves its existing empty-compaction no-op behavior, which makes no provider request and captures no hook registry. Reference title/seed requests and tool exposure are not copied into Apexo's summarization contract. Automatic source selection is confirmed by pinned source and Apexo's real native runtime test; the installed comparison exercises manual compaction only.

## Verification

All commands run from `packages/apexo` unless stated otherwise:

- `bun test test/session/native-compaction-hooks.test.ts`: three tests, 23 assertions passed, including real subprocess cancellation and Session deletion.
- `bun test test/session/native-compaction-hooks.test.ts test/plugin/hook-observer.test.ts test/session/compaction.test.ts`: 61 passed, one existing skip, 199 assertions.
- `bun script/grok-native-compaction-hooks.mjs cli`: five checks, three provider calls passed against both the off-tree implementation and applied CLI source.
- `bun script/grok-native-compaction-hooks.mjs desktop`: five checks, three provider calls passed against the coordinated rebuilt Desktop backend.
- `bun script/grok-compaction-hooks-official.mjs`: five checks, five provider calls passed against the isolated installed reference.
- Core and Apexo package `bun typecheck`: passed.

The source is applied to the working branch. The live focused gate passed 61 tests, one existing skip, and 199 assertions after a quiet rerun; the earlier concurrent-build timing failures remain documented in [the timing investigation](testing/test-fixtures/compaction-loaded-host-timing.md). Packaged Desktop backend acceptance passed five checks with three provider calls. Integrated complete gates remain tracked by the parent checkpoint. Compatibility compaction observers retain their existing timing; this slice changes only native compaction dispatch and shared observer cancellation settlement.

See [the cancellation repair record](testing/runtime/hook-observer-cancellation-settlement.md) for the observed failure and exact cleanup boundary.
