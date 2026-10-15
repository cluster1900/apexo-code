# BUG-20261015-094: Child-capability fixture assumed distinct tool indices in one reply

- **Status:** Corrected and verified in the isolated ownership patch.
- **Scope:** Native Task Created-boundary and exact receipt-replay fixture; no production defect.
- **Observed:** The fixture chained `reply().tool("capture_children", {}).tool("task", ...)` and timed out after approximately ten seconds waiting for Task Created. The combined run reported 34 passing tests and one failing fixture.
- **Expected:** The native parent must first capture its actual internal child capability through a canonical test tool, then invoke the real Task tool and reach the held Created boundary.
- **Cause:** The test provider helper emits tool deltas at index zero. Calling `.tool()` twice did not represent two independently indexed tool calls in that response. The test assumed a helper capability that it did not implement.
- **Fix:** Send two distinct provider turns: capability capture followed by Task. Keep native execution, permissions, ownership and all receipt assertions intact. Expected provider counts now include that explicit capture turn: four calls through parent completion, six through the two receipt launches and exact replay.
- **Verification:** `bun test test/v2/task-created-admission.test.ts` passed one test and 32 assertions. The final focused ownership/lifecycle gate passed 39 tests and 272 assertions; Core and Apexo package typechecks passed.

This is one fixture-authoring episode, not a recurrence or a product timeout fix. The receipt test still proves that retrying completed launch A after follow-up B returns A's exact durable receipt, while general output returns B.

## Second independent occurrence: native Plan batch fixture

A later native Plan fixture independently chained `plan_exit` and `write` through the same index-zero helper. Its exit remained pending and the approval wait timed out. The original Task correction had not changed that helper's contract. The Plan scenario must exercise both calls in one provider batch, so it now supplies real indexed SSE tool calls (indices zero and one) through the existing raw response helper. The unchanged batch assertion then passed: exit emitted before write presents the written plan content, waits for explicit approval, and adds no synthetic user message. The focused case passed one test and 15 assertions; the expanded native Plan suite passed 11 tests and 107 assertions, with Apexo package types passing.

There are two verified independent helper-assumption episodes, below rule-promotion threshold. The diagnostic rerun of the unrepaired Plan fixture is not another occurrence.
