# BUG-20261015-203: Headless outcome event omitted from exhaustive transcript dispatch

- Scope: Private native headless Phase 1 draft; no shared release defect.
- Observed: Core typecheck rejected the new input settlement event because SessionMessageUpdater's exhaustive event match lacked its case. Projector unknown-channel diagnostics cascaded from that missing match arm.
- Expected: Operational input outcome events participate in durable replay without adding visible transcript content.
- Root cause: The draft extended SessionEvent's union without adding the corresponding non-transcript dispatch case.
- Fix: Add the explicit input settlement no-op to the transcript updater; the dedicated input projector owns its durable outcome.
- Verification: Private Core `bun typecheck` passed. The canonical input storage test passed 1 test /26 assertions, including no visible message from withdrawn inputs and passive receipt settlement. Runtime provider and public API integration remain pending.

## Native Task ordinary withdrawal event (second independent authoring episode)

The active Task delivery draft added `session.next.prompt.withdrawn` to the canonical Session event union. The initial Core `bun typecheck` reported the missing exhaustive message-updater arm, followed by projector unknown-channel diagnostics from that same root cause. Reproduce by extending the event inventory without its transcript-dispatch case and running `bun typecheck` in `packages/core`.

The fix adds an explicit no-op transcript dispatch while the dedicated canonical input projector retains the withdrawal sequence. Private Core, Server and Apexo `bun typecheck` passed after the fix. `bun test test/v2/task-message.test.ts test/v2/input-execution.test.ts test/v2/task-store.test.ts` in `packages/apexo` passed, including a selected-promotion/withdrawal race and deterministic withdrawal replay with no visible user message. The separate HTTP/provider delivery matrix passed three cases. These checks validate the private checkpoint; shared integration remains a later gate. This is the second confirmed independent occurrence of the same omission; no recurring rule is promoted yet.
