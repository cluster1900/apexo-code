# BUG-20261015-313: Pending operator Task send retained a replaced agent

- Scope: HTTP/operator active Task message admission.
- Observed: After the operator send requested permission for the persisted build agent, switching the Session to a restricted agent and approving the old request still admitted the message (HTTP 200 instead of 409).
- Expected: A new operator admission must still belong to the persisted agent selection captured before permission evaluation. A changed selection requires an explicit new operation under current authority.
- Root cause: Permission.reply intentionally revalidates existing.agent, which is correct for an executing tool's captured context.agent, but operator send did not revalidate the Session's persisted selection.
- Fix: Operator send passes its captured persisted selection into the canonical admission commit; that transaction rereads Session.agent and rejects changed/missing ownership before committing the input/binding. Tool calls retain their real context.agent attribution. No general permission reply semantics changed.
- Reproduction: Launch an active child, hold the operator message permission, switch the parent to an agent denying Task sends, then approve the pending permission once.
- Verification: The retained before-fix HTTP test failed with 200 versus expected 409. After the fix, eight store/HTTP tests passed with 113 assertions; stale operator admission leaves no canonical input, the child remains running, and an explicit new operation under the restricted agent returns 403. Apexo package typechecking passed.
- Independent occurrences: Two confirmed selected-operator-agent validation defects across Task admission and native legacy Dream publication; no recurrence rule is promoted.


## Native legacy Dream publication (2026-10-15)

The new manual native Dream draft captured the selected agent and rechecked that agent's current read/edit permissions, but did not compare the Session's latest persisted selection. A held-provider regression switched from build to an edit-denying restricted agent and then released the result. Before correction it returned completed instead of failed (zero tests passed, one failed, one assertion), proving this independent boundary could publish under replaced operator authority.

The native Dream validation now resolves the current persisted selection and rejects a changed agent before inference, before filesystem publication, and during explicit recorded-output retry. It retains captured permission intersection rather than widening authority. The regression requires no published memory, a failed original operation, a failed explicit retry and one total provider call. The final focused gate passed 26 tests / 153 assertions; Core and Apexo types passed. The rebuilt Desktop backend and native window each passed four checks with one provider call. This is the second confirmed occurrence of omitted current-operator selection validation, not a recurrence of Permission.reply internals.
