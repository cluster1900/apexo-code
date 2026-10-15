# Completed Task operator continuation

- Bug ID: BUG-20261015-357
- Scope: Native Task HTTP messaging and App/TUI message controls.
- Status: Integrated; shared native HTTP, CLI, rebuilt Desktop and browser/native UI acceptance pass.

## Confirmed missing capability

A completed direct child accepted an exact retry of an old message, but a fresh operator HTTP message returned 409. Tool-owned continuation already worked. The initial three-delivery negative control failed all three cases at expected 200 versus observed 409 (12 assertions). This was an unimplemented operator wake path, not a regression of active child messaging.

The operator adapter now supplies the existing process-global execution control capability. A fresh completed-child message queues a canonical Task launch in the parent's control lane. The launch reuses the child's Session, durable history, saved Agent/model, sandbox and original authority ceiling. Its explicit operator origin uses the durable input ID and child incarnation; it fabricates no tool call. Running child delivery remains direct. Exact retry reconciles before later launch checks, including after a queued control wait.

Current Agent, permissions, direct ownership/incarnations, Goal restriction and active-message setting are revalidated before admission and child execution. Failed/cancelled Tasks remain unavailable. App and both terminal Task panels enable completed Tasks through the existing message draft/receipt client.

## Process-global service boundary implementation failure

The first draft incorrectly included the abstract process-global SessionExecution node in the Location-scoped SessionTask dependency graph. Leaf Core types passed, but real HTTP setup returned empty 500 responses before prompt execution. The retained output does not identify an exception body; no more specific exception is claimed. The corrected adapter captures the already-exposed global service in the HTTP handler and passes its control capability to the Location service. It adds no Location layer or second coordinator. The same HTTP cases subsequently passed.

## Verification

From `packages/apexo`, pinned Bun 1.3.14:

- `bun test test/e2e/v2-task-message.e2e.test.ts test/v2/task-message.test.ts`: first corrected baseline 15 tests, 216 assertions, zero failures; final ownership/deletion, durable inbox, coordinator and lifecycle suite passed 43 tests and 300 assertions across four files.
- `bun test test/cli/run/task-message-view.test.tsx`: running/completed Task editors both submit through a real local HTTP server and preserve the original child during selection changes; 2 tests, 22 assertions.
- `bun script/grok-task-operator-wake.mjs cli`: steer, queue and interject each keep one child, issue exactly two child provider turns, preserve history, and reconcile the exact retry.
- `bun script/grok-task-operator-wake-official.mjs`: isolated installed runtime accepted the human address message after child completion, with the prior assistant result in the resumed request; three checks, two child provider turns.
- Package `bun typecheck` passed in Core, Apexo and App.

The source reference is `xai-grok-shell/src/extensions/subagent_message.rs` and `agent/mvp_agent/subagent_spawn.rs`; it forwards human-origin messages to the coordinator. No reference runtime is used by Apexo product code.

The coordinator cancellation tests prove queued and claimed control cleanup in the canonical coordinator. The HTTP race fixtures hold permission evaluation; they do not instrument an exact queued-control entry boundary.

The deletion-race fixture initially expected only domain 403/404/409 responses. Deletion interrupts the pending HTTP fiber through the existing Session lifecycle, which the real host exposes as 503. The fixture now checks that cancellation response and independently verifies no receipt or extra provider turn; this changes no public error mapping.

Shared composition: the five-file HTTP/coordinator/lifecycle/terminal gate passes45 /322; source CLI and rebuilt Desktop each pass all three modes. Browser/native completed-wake acceptance and the additional native exact-receipt reopen checks pass. Full aggregate gates remain separately tracked.
