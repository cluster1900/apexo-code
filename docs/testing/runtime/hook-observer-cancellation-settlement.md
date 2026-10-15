# BUG-20261015-030: Hook observer cancellation returned before dispatch cleanup

- **Scope:** Core `HookObserver.observe` and the independently authored `SessionHookStop.evaluate` decision wrapper.
- **Observed:** A real native Session held a Python PostCompact command after the compaction event committed. Session interruption and the compaction caller both settled, but the hook process was still alive at the immediate post-settlement assertion. The initial focused run passed two tests and failed this cancellation assertion.
- **Expected:** Interruption aborts the observer and joins its dispatch cleanup before the owning Session operation settles. A committed compaction stays committed, and deletion cannot complete while its held PreCompact dispatch remains owned.
- **Root cause:** The original interruptible `Effect.promise` forwarded cancellation through its AbortSignal but did not join the underlying `HookDispatch.run` promise. That promise settles on the child process close event, after process-tree cancellation.
- **Fix:** Acquire one AbortController and pending dispatch together, forward cancellation during the interruptible use phase, and abort then await the same pending dispatch in the uninterruptible release phase. Existing handler time/output bounds and process-tree termination remain in force. No detached worker or new Session mutation lease is introduced.
- **Draft correction:** The first acquire/use/release draft used a zero-argument `Effect.promise` callback for its use phase. The pinned Effect implementation treats that callback as non-cancellable, so the test reached its existing five-second limit. The corrected use callback accepts and forwards the AbortSignal. The timeout and behavior assertions were not weakened.
- **Reproduction:** From `packages/apexo`, run `bun test test/session/native-compaction-hooks.test.ts` with the compaction integration and original observer wrapper. The held PostCompact case fails the immediate process-exit assertion after `sessions.interrupt` and joining compaction.
- **Verification:** The corrected native suite passed three tests and 23 assertions. It covers committed PostCompact cancellation and joined PreCompact deletion, with no extra provider requests or late changes after Session ID reuse. The combined native-compaction, existing observer, and existing compaction gate passed 61 tests, one existing skip, and 199 assertions. The real CLI acceptance passed five checks and three provider calls. Core and Apexo package typechecks passed. The coordinated rebuilt Desktop backend passed the same five checks with three provider calls.
- **Status:** Applied to the working branch. The live focused suite passed 61 tests, one existing skip, and 199 assertions; live CLI acceptance passed five checks and three provider calls. Rebuilt Desktop backend acceptance passed five checks and three provider calls. The earlier concurrent-build timing failures are tracked separately in [BUG-20261015-034](../test-fixtures/compaction-loaded-host-timing.md).
- **Occurrences:** Two independent wrapper-authoring episodes: observer cancellation and Stop decision cancellation. Diagnostic and intermediate draft reruns belong to their original repair episode.

## Stop decision cancellation

The independently implemented `SessionHookStop.evaluate` used interruptible
`Effect.tryPromise` to dispatch a normal-completion Stop decision. Its negative
control interrupted a real held command that ignored SIGTERM; `Fiber.interrupt`
returned while `process.kill(pid, 0)` still succeeded. This repeats the original
missing-promise-settlement join, rather than introducing a new process-kill bug.

The decision wrapper now acquires its AbortController and dispatch promise
together, forwards cancellation during use, and aborts then awaits dispatch in
release. An interrupted durable claim stays `evaluating`, so an exact evaluation
retry cannot replay its external command. No completion is fabricated.

Verification from `packages/apexo` with pinned Bun 1.3.14:
`bun test test/session/hook-stop.test.ts test/plugin/hook-stop.test.ts test/session/native-stop-hook-cancellation.test.ts`
passed eight tests and 41 assertions in the private validation tree. Both native
Session interruption and deletion immediately prove the held process is gone
after settlement. Deletion additionally verifies receipt removal and clean
Session-ID reuse; interruption verifies the durable claim cannot dispatch again.
The original negative control failed the immediate process-exit assertion.
Shared integration and built-backend acceptance remain pending.

## Shared Stop cancellation integration

The six-file cancellation handoff was baseline/final hash-checked and integrated. The shared focused command above passes eight tests / 41 assertions with pinned Bun 1.3.14. The source CLI command `bun script/grok-native-stop-cancellation.mjs cli` passes four checks and two provider turns: interruption and deletion join a real Hook command that ignores SIGTERM, repeated idle interruption does not replay work, and deletion followed by Session-ID reuse has no late history. The freshly rebuilt Desktop backend also passes all four checks and two provider turns through `bun script/grok-native-stop-cancellation.mjs desktop`; the larger Subagent lifecycle Hook feature is separate from this correction.

After composing Task wake, Workflow selection and Subagent Hooks, the repeated Desktop cancellation gate again passes four checks / two provider turns. One invocation mistakenly used Node and stopped immediately at the fixture's required-Bun guard before any product setup. The corrected pinned-Bun invocation passed; this command-selection mistake is not another cancellation defect or recurrence. The combined 76-test / 675-assertion gate and all 21 workspace typecheck tasks also pass.
