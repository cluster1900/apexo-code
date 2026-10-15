# Task transcript continuation

- **ID:** BUG-20261015-364
- **Scope:** Native Task tool, Session child history admission, saved capability ceilings.
- **Observed:** The working reference exposes `spawn_subagent.resume_from` and creates a fresh child from a terminal direct child's transcript. Apexo's native Task input did not expose or consume this option. A provider fixture supplying it selected the newly requested Agent/model (`override`) instead of the source model (`saved`), and did not implement transcript continuation. This is a missing feature, not a regression in existing same-child Task follow-up.
- **Expected:** A fresh owned child continues a completed, failed, or cancelled direct Task or Workflow source using durable transcript/tool state and the saved Agent/model, subject to current parent policy and the source's original authority ceiling. Source ownership and transcript remain unchanged. Historical usage is context, not newly billed work.

## Implementation

The Session-owned child-resume selector is shared by Workflow and Task. It proves direct ownership, terminal state, Created identity, history revision, idle coordinator/role state, and identical Location/sandbox binding. Task keeps its existing lifecycle, coordinator, Goal accounting, depth limits, foreground/background rules, permission admission, and one provider stream per turn. A shared capability predicate preserves Workflow read-only and delegation restrictions when history crosses owner kinds. The old child's execution capability is never transferred.

History imports use the existing canonical SessionHistoryCopy events and projectors. New Task metadata records the source proof; a retry requires a completed matching import. A draft review found that the ordinary readiness check intentionally allowed Sessions with no import events. The new expected-source argument rejects that state for resumed children. Its negative control failed with Success instead of Failure (0 passed, 1 failed, 1 assertion); after the correction, the canonical copy/replay/runtime tests pass. Incomplete imports remain quarantined, and imported unfinished tools do not execute.

Source policy is captured before permission waits and checked again at actual child creation, after copying, and immediately before child execution. The initial and fresh parent authority and the source's stored/current authority all constrain the new child. Mid-admission source policy changes or parent denial fail closed. Current system context remains produced by the destination's native domains; historical system snapshots do not replace current policy.

Worktree and custom cwd placement remain separate unsupported options in this slice; foreign placement is rejected. A process-interrupted Task is not silently treated as a terminal completed/failed/cancelled source.

## Verification

Run from `packages/apexo` with pinned Bun 1.3.14, the fixed model catalog, and the existing Workflow script executable:

- `bun test test/e2e/v2-task-resume.e2e.test.ts --timeout 30000`: first negative control, 0 passed / 1 failed / 3 assertions; corrected initial test, 1 passed / 7 assertions.
- `bun test test/e2e/v2-task-resume.e2e.test.ts test/session/task-resume-admission.test.ts test/v2/history-copy.test.ts test/v2/history-copy-runtime.test.ts --timeout 30000`: 10 passed / 0 failed / 137 assertions. Covers completed Task, completed read-only Workflow with inherited primary Agent, failed Workflow, cancelled Task, source tool results, fresh IDs, immutable source, model pinning, policy exclusions, source tighten/relax, parent denial, and source revision mutation at Created; canonical replay/accounting and unfinished-tool quarantine are also exercised.
- `bun typecheck` from Core and Apexo: both passed after the final expected-import-proof and inherited-primary wake amendments.
- Isolated installed reference: three checks passed, two child conversation turns, distinct child IDs, `resumed_from` relation, and prior user/assistant transcript in the second provider request. The pinned source is `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, Task types and shell subagent continuation implementation.
- Combined new and existing Workflow/Task gate: 36 passed / 0 failed / 473 assertions across eleven files, including the existing Task message matrix. The resumed Goal test retains 70 historical source tokens and bills exactly 11 new tokens; retries of unimported targets stay non-runnable. Existing Workflow resume/admission, Task depth, Task ownership/admission, and Goal receipts pass unchanged.
- `bun script/grok-task-resume.mjs cli`: four checks passed with seven provider turns, including backend restart, saved model, tool-result history, fresh ID and immutable source. Shared CLI and the unified rebuilt Desktop both pass the same four checks / seven provider calls; all 21 types and unified builds pass. Existing Task panels are unchanged; this feature does not claim a new GUI control.

## Fixture observations

The expanded failed-Workflow case initially expected only the raw user prompt. Canonical history correctly contained the output-schema suffix and the repair prompt as well; the first run was 3 passed / 1 failed / 63 assertions. The fixture now compares every source user message plus the new continuation prompt. No product history was removed to satisfy the assertion.

A first revision-race fixture tried direct prompt admission to a managed source, which was correctly rejected before changing history; the listener's failed effect did not prove a revision race. That run was 7 passed / 1 failed / 89 assertions. The corrected fixture publishes a real durable Synthetic event during Created and verifies zero resumed-child provider requests. These are fixture corrections, not evidence of historical product regressions or recurring constraints.

## Inherited primary Agent wake compatibility

A completed Task resumed from a read-only Workflow legitimately retains that Workflow's inherited primary Agent. An appended real HTTP operator-message test initially returned 409 rather than 200 (0 passed, 1 failed, 23 assertions): the existing late operator-wake guard rejected every primary Agent even when the new durable Task record explicitly retained an inherited selection. The guard now uses the same saved inherited flag as initial Task admission; arbitrary primary-Agent Task creation remains denied. The test checks the saved model and read-only tool ceiling after the wake. The corrected combined gate passes 36 tests and 473 assertions, including the unchanged Task message matrix.
