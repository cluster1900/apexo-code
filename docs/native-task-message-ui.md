# Native Task message operator controls

The App/Desktop Tasks panel and both terminal Task panels expose a message editor for native child Tasks. Messaging requires `task.activeMessages: true`, direct-parent ownership and the backend's current permissions, Agent and Goal authority. Running and completed Tasks accept messages; completed Tasks continue through a fresh owned launch in the same child Session. Failed/cancelled Tasks and descendant routing remain unavailable. Compatibility tasks, processes and schedules have no message action.

Open a native Task in the App Tasks panel. In the mini terminal, select it and press `m`; in fullscreen, use `Ctrl+E`. The terminal editor uses Tab for delivery mode, Ctrl+S for send or exact retry, Ctrl+R for a passive receipt read, Ctrl+N for an explicitly new message after a confirmed receipt, and Escape to return to Tasks. The selected child's title and identity are visible.

Steer uses the next safe provider-turn boundary. Queue waits until the child would otherwise become idle. Interject takes priority at a safe boundary and may end a supported passive wait; it does not interrupt arbitrary tools or cancel model execution. Accepted means durable admission, and delivered means promotion to the child. Neither means that the child Task has completed. Cancellation/interruption before promotion remains distinct from delivered work.

A handwritten SDK utility owns only client draft and receipt state. The existing generated API performs send/read operations. An uncertain send keeps its immutable text, delivery and input ID; editing or allocating a new message is blocked until a receipt establishes admission. Only a definitive validation or permission rejection reopens editing. Passive reads do not start provider work. The editor polls receipts only while mounted and aborts in-flight transport on disposal. The per-client cache is bounded to 128 entries; unresolved entries are not silently evicted. A replaced launch timestamp discards unsubmitted drafts. Submitted inputs survive only for exact receipt reconciliation under the current client/Location and parent/child ownership; Send and Next remain blocked until that GET succeeds. Stale responses are fenced by cache generation. No transcript patch or second executor is introduced.

Selection/owner/client changes dispose the editor. A prepended Task row therefore cannot leave an old send action behind a new selected label. Closing and reopening the same Task preserves its receipt. App strings are explicit in English, Simplified Chinese and Traditional Chinese; existing centralized English fallback supplies other locales. The generic prompt composer and Session timeline are unchanged.

## Verification

Run commands from `packages/apexo` unless a package is specified:

- `bun test --timeout 30000 test/cli/run/task-message.test.ts test/cli/run/task-message-view.test.tsx`: real loopback HTTP admission uncertainty, exact retry, UTF-8 validation, permission rejection, owner/client/launch separation, real OpenTUI held-send selection replacement and Escape handling.
- `bun script/grok-task-locales.mjs`: all 118 Task keys are present in English, Simplified Chinese and Traditional Chinese, with matching placeholders. This is not a native-speaker review.
- `bun script/grok-task-message-ui.mjs browser`: actual production App/browser, three delivery modes with two child provider calls each, close/reopen exact receipt, passive promoted receipt, cancellation before delivery with one child call, and navigation to an empty owner.
- `bun script/grok-task-message-ui.mjs native`: the same checks in a rebuilt Electron window.
- `bun script/grok-task-message-tui.mjs steer`: actual mini terminal at 120×40, two child calls, retained admission after editor back/reopen and passive promotion.
- `bun script/grok-task-message-tui.mjs queue --narrow`: actual mini at 80×24, two child calls and visible action geometry.
- `bun script/grok-task-message-tui.mjs interject --fullscreen`: actual fullscreen at 120×40, two child calls.
- `bun script/grok-task-message-tui.mjs steer --fullscreen --narrow --cancel`: actual fullscreen at 80×24, one child call and cancelled-before-delivery receipt.

Installed Grok behavior remains the separately verified reference in `native-task-delivery.md`; these operator tests exercise Apexo's own server and provider execution. They do not claim completed-child wake, arbitrary wait interruption, native-speaker review or the aggregate CI gate.

Final isolated acceptance on 2026-10-15 passed 3 focused tests / 32 assertions, all 118 Task locale keys, SDK/App/TUI/Apexo typechecks, the final App build, and the final complete Desktop build. Actual production browser and rebuilt native window each passed the full three-mode matrix plus cancellation and owner navigation. Mini/fullscreen normal/narrow PTY checks passed with the provider counts above. Native-window screenshots were visually inspected, including the accepted receipt and enabled follow-up controls.

One early App build completed slowly during concurrent build memory pressure; the matching early Desktop build was intentionally stopped, and an early backend readiness check timed out with no established product cause. Those runs are not acceptance. The final App and Desktop builds completed after limiting concurrent heavy tasks. No generated sources, shared composer or timeline files are part of this change.

## Shared integrated acceptance

The 22-file handoff was integrated with original/final hashes verified and its package exports, locales and runtime additions preserved alongside MCP. Shared focused tests pass **3 tests / 32 assertions**. Shared source mini at 80×24 passes queue, and fullscreen at 120×40 passes interject, with two child calls each and the same accepted ID retained after back/reopen. The unified production browser and rebuilt native Desktop window each pass steer, queue and interject (two child calls per mode), cancellation before delivery (one child call), passive promotion, and owner navigation without a stale editor. All 21 workspace types and both unified builds pass. These are scoped integrated results; the aggregate unit/HTTP gate is tracked separately.

## Completed Task continuation checkpoint

The reviewed operator-wake and receipt amendment are integrated. Shared backend/coordinator/terminal verification passes45 tests /322 assertions. The canonical client command passes4 /29; the earlier default-deadline package hook failure remains unexplained in [BUG363](testing/test-stability/task-receipt-hook-timeout.md). All21 types and the final unified App/Desktop builds pass.

`grok-task-message-ui.mjs browser --completed` and `native --completed` each pass steer, queue and interject with exactly two child provider turns, retained promoted receipts and the corrected result. A temporary native acceptance extension additionally closes/reopens the same child, verifies the exact receipt ID, then clears the draft through New message without another provider request, for all three deliveries. This extension modifies only the test harness outside the repository. The client ownership correction is recorded in [BUG362](testing/ui/task-wake-draft-receipt.md).
