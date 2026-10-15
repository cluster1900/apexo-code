# BUG-20261015-312: Goal correction fixture assumed a response wrapper

- Scope: New native Task correction usage HTTP fixture.
- Observed: Goal polling failed with Missing key at data after three successful setup/admission assertions.
- Expected: Decode the Goal endpoint's direct Goal.Info response.
- Root cause: The fixture copied the Session endpoint's data wrapper instead of the Goal route's actual schema.
- Fix: Decode Goal.Info directly, preserving the existing HTTP contract.
- Reproduction: Decode GET /api/session/:id/goal with Schema.Struct({ data: Goal.Info }).
- Verification: The corrected focused test passed one test / seven assertions. The correction appeared once in the real child request, the five actual provider calls accounted ten tokens, and the Goal stopped budget_limited with a promoted receipt.
- Independent occurrences: One fixture-authoring episode. No recurrence is claimed.
