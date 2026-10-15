# BUG-20261015-091: Public resume consumed a managed child's live execution allowance

- **Status:** Integrated and verified through shared runtime checks.
- **Scope:** Native process-local `SessionExecution.resume` and advisory `wake`, including `SessionV2.resume`, for privately owned Task, Workflow and Goal children.
- **Observed:** With a real Workflow role attached and its owning child call deliberately held, an unrelated public resume started one child provider request before the owner released the gate. The initial probe observed one provider call before owner release. Interrupting the owning operation joined that child; cancellation escape and duplicate provider work were not observed.
- **Expected:** Public resume must refuse managed children before coordinator admission, even while a live role exists. Advisory wake must not consume that role or schedule model work. Only the owning native runner's child capability may invoke the existing internal child drain.
- **Root cause:** Public resume and `CurrentChildren.run` shared the same execution closure. The runner checked a global live role and consumed its one-use allowance, but could not distinguish the unrelated public caller from the owning parent operation.
- **Fix:** Keep the private child closure and coordinator unchanged. Public resume and wake first query the existing durable managed-child authority under a short lifecycle read. They retain the captured incarnation through scheduling. Public resume returns a typed failure; advisory wake declines managed admission. Absent ordinary authority preserves existing ordinary Session behavior. Present stale/malformed evidence and historical quarantine cannot become public execution authority.
- **Graph:** `SessionExecutionLocal` explicitly depends on the existing global managed-child service. No new executor, provider loop, scheduler or durable model retry is introduced. No mutation lease spans model execution.

## Reproduction and verification

The deterministic regression uses a real native parent Workflow and the actual role service. A test decorator pauses after real role attachment but before the owning runner calls its child capability. The provider and Session services are real. It races unrelated public resume against a provider request, checks advisory wake, then releases the legitimate owner and verifies joined interruption and no late request.

Additional tests exercise Task and Goal children at their atomic Created boundary, retired children, and synthetic historical Workflow quarantine. The exact Task receipt-replay regression obtains the real native parent's child capability through a canonical test tool; it no longer substitutes public resume for trusted execution.

On the common baseline, the unchanged two-case regression failed both cases: public resume produced a second provider request while the owner was held (only the first parent request was allowed), and public wake admitted an active child and reached that same second request. Both observations used the real native provider path. Baseline cleanup joined the owning chain.

With the patch, the focused gate passed **39 tests / 272 assertions** across eleven files. It includes both real-parent resume/wake cases, Task atomic publication and exact receipt replay, Workflow private/historical authority, Goal planning/verifying/summary with verifier continuation, native deletion, coordinator controls, and lifecycle background ownership. Core and Apexo `bun typecheck` both passed.

Commands (from `packages/apexo`, except Core typecheck):

```sh
bun test test/v2/managed-resume-ownership.test.ts test/v2/task-created-admission.test.ts test/workflow/managed-ownership.test.ts test/workflow/managed-admission.test.ts test/session/goal-managed-admission.test.ts test/session/lifecycle.test.ts test/session/lifecycle-background.test.ts test/session/control-coordinator.test.ts test/session/native-delete.test.ts test/v2/task-authority.test.ts test/v2/task-store.test.ts
bun typecheck
```

No expectation was relaxed to allow public child execution. An initial test-file extraction left an obsolete expression tail and was corrected before runtime assertions; this was fixture syntax, not a product failure. The separate multi-tool reply fixture mistake is recorded as [BUG-20261015-094](../test-fixtures/managed-resume-multiple-tool-reply.md). The stale private validation dependency was resolved by refreshing the existing mixed-server sandbox export, tracked under BUG-20261015-053 rather than counted as a new production graph defect.

These are native Apexo ownership checks, not claims about Grok runtime cancellation or full feature parity. CLI/Desktop shared acceptance and aggregate gates remain integration responsibilities.


Shared verification: the identical focused gate passed 39 tests / 272 assertions; all 21 repository typecheck tasks and App/Desktop production builds passed. On the patched implementation, CLI and rebuilt Desktop each passed native Task five checks / 15 calls, Workflow managed admission four checks / two calls, and Goal closing-summary ten checks / 80 calls. No public API schema changed. The separately isolated installed summary comparison passed two checks / 24 requests and remains lifecycle comparison only. Full aggregate validation is tracked independently.
