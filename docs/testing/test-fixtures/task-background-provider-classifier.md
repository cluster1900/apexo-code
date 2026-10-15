# Background Task provider fixture classified only the latest wire user message

- **Bug ID:** BUG-20261015-099
- **Scope:** Native background Task CLI provider fixture and native Monitor cancellation acceptance.
- **Status:** Original Task correction and shared Monitor correction verified.
- **Independent occurrences:** The provider-classification mistake has two independent authoring episodes. The cancellation-before-readiness mistake has two independent episodes, Task and Monitor; no constraint is promoted at two.

## Observation and cause

The real CLI fixture reached child completion but timed out waiting for its expected completion answer. Retained local provider input showed a SystemContext reconciliation update as the latest wire-level user message. The fixture classified scenarios only from the original parent marker in that latest message, so it failed to recognize the completion request. Wire context representation is not evidence that a new durable user prompt was admitted.

## Correction

Select the exact original scenario marker from the retained request history when the latest message is a context update, and recognize completion data before the initial-parent branch. Keep assertions that the durable parent transcript still has only its original user message and the provider receives bounded Task completion data.

The same acceptance authoring episode also assumed that cancellation always follows a child provider request. Early cancellation can legitimately settle before that request starts. The joined-running-child scenario now waits for the fixture's actual child-request readiness signal before cancelling; it does not require extra product work or a timing sleep.

## Verification

From `packages/apexo`, pinned Bun 1.3.14, `bun script/grok-native-task-background.mjs cli` passed 8 checks with 32 provider calls. It covers idle/active completion, model wait, cancellation, parent Stop, deletion, failed-child completion and real process restart without replay. The backend and fixture processes were reaped. Packaged Desktop verification is a separate integration step.

## Independent Monitor cancellation episode

The shared `bun script/grok-native-monitor.mjs desktop` run passed idle, active and wait, then timed out waiting for `cancel.pid`. The retained database and transcript show a running receipt, a successful `process_cancel`, terminal `cancelled` state with suppressed notice and no output, followed by the expected parent continuation. The fixture issued cancellation about 20 ms after its first provider request, before the shell executed its first PID-file instruction. It then incorrectly required that file to appear after cancellation. Receipt creation is not proof that a command's first instruction has executed. No production cancellation defect is established.

The running-process cancellation scenario now holds its second provider response on an explicit fixture gate. The driver reads the command-owned PID file and verifies that PID is alive before releasing `process_cancel`; it still requires terminal cancellation, no event/completion reminder and a dead PID afterward. Cleanup releases the same gate if an assertion fails. No product code, timeout or cancellation expectation was weakened.

Reproduce with `bun script/grok-native-monitor.mjs desktop` from `packages/apexo`; verify the corrected script with both `cli` and `desktop`. The actual file passed formatter and `node --check`. Corrected shared CLI and rebuilt Desktop each passed all ten checks / 57 provider calls and exited zero. All twenty recorded process PIDs were absent after cleanup. The independent six-scenario installed comparison also passed; it does not verify Apexo's implementation.

## Active-delivery fixture phase episode

A new native Task delivery CLI fixture used the shared helper's `finished` flag to decide whether to spawn its initial child. That flag describes tool output after the latest wire user item. Actual retained requests showed a later SystemContext reconciliation item, so the flag became false and the fixture authored another Task after the first child had already received its correction and completed. Two failed diagnosis runs belong to this one authoring episode. The changed parent/child classifier alone did not solve it; the retained request sequence established the repeated authored launch as the cause.

The correction keeps explicit per-scenario parent launch state. Provider classification first excludes actual title/dashboard calls; child delivery checks select exact ordinary user content and require the correction exactly once. The corrected `bun script/grok-native-task-delivery.mjs cli` passed steer, queue and interject with two child provider requests per scenario. Final packaged verification is recorded in the native Task delivery implementation document. This is the second independent provider-phase/classification episode; the separate cancellation-readiness occurrence count above is unchanged.
