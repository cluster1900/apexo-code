# Native Compaction Fixture Used Invalid Goal IDs

- **Bug ID:** BUG-20261014-146
- **Scope:** `packages/apexo/test/e2e/v2-compaction.e2e.test.ts`
- **Status:** Verified
- **Independent occurrences:** 5

The fixture created `goal_compact_idle` and expected HTTP 200 but received 400.
The Goal ID schema permits `goal_` followed by alphanumeric characters; the
additional underscore is invalid. The budget scenario had the same invalid
construction in the same fixture authoring occurrence. Use `goal_compactidle`
and `goal_compactbudget` so the scenarios reach the intended active-Goal and
compaction-budget checks. No runtime schema was loosened.

Verification: from `packages/apexo`, pinned Bun 1.3.14,
`bun test test/e2e/v2-compaction.e2e.test.ts test/e2e/v2-goal.e2e.test.ts`:
2 tests passed, 76 assertions, no failures. The new compaction receipt exhausts
the eight-token Goal budget at 13 accounted tokens and starts no evaluator.

## Independent native Task admission fixture occurrence

The Task ownership admission fixture supplied `goal_task_guard` and expected the
managed-child conflict, but schema validation returned HTTP 400 first. Replacing
it with `goal_taskguard` reaches the actual Goal conflict and proves that no Goal
state was created. This is the same extra-underscore construction mistake in a
separate fixture authoring episode; no product schema was changed. The isolated
mixed HTTP regression passed 1 test and 24 assertions, and the combined Task gate
passed 6 tests and 90 assertions. This second episode is independent of the original compaction fixture.


## Third independent episode: Goal managed-child admission probe

The native Goal admission probe constructed `goal_admission_probe` with `Goal.ID.make`; the canonical constructor rejected the extra underscore before execution. Replacing it with `goal_admissionprobe` preserved the schema and reached the actual product admission failure. Planning, verifying and summary scenarios belong to this single authoring episode, not three occurrences.

The corrected isolated probe completed the native flow and failed only the intentional product-admission assertion. After the separate product repair, the expanded `bun test test/session/goal-managed-admission.test.ts --timeout 30000` passed two tests / 16 assertions and Apexo typechecking passed. The three independent cases are compaction, Task admission and Goal admission. See [RULE-20261015-004](../../rules/goal-fixture-id-format.md).

## Fourth independent episode: background Task Goal rejection

The background Task ownership fixture used a human-readable `review-backgroundguard` value with the Goal ID constructor. Validation rejected it before the intended background-Goal admission check. The fixture now uses `Goal.ID.create()` and keeps its readable scenario name outside the identifier. No schema or product permission was relaxed.

From `packages/apexo`, `bun test test/v2/task-background-ownership.test.ts --timeout 30000` passed 2 tests / 9 assertions: the real Goal rejects background Task admission before any child/provider work, and application-scope closure joins a held background child. The expanded four-file Task regression passed 15 tests / 153 assertions. This fourth authoring episode follows the already active [RULE-20261015-004](../../rules/goal-fixture-id-format.md); it does not create a second rule.

## Fifth independent episode: Task delivery permission fixture

The new Goal-held Task message permission test supplied an additional underscore in its Goal suffix and received HTTP 400 before starting the Goal. It now uses Goal.ID.create(), preserving production validation and keeping the scenario label outside the ID. The corrected delivery store and HTTP suite passed six tests / 97 assertions, including real Goal pause while message permission is pending. This is one independent fixture-authoring episode under RULE-20261015-004, not a new constraint.
