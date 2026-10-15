# Synthetic legacy Goal fixture omitted its explicit ID

- **Bug ID:** BUG-20261015-002
- **Scope:** `packages/apexo/script/grok-goal-legacy-reports.mjs`
- **Status:** Verified
- **Independent occurrences:** 2

The first CLI migration fixture run failed at `POST /session/:sessionID/goal` with HTTP 400 and `Missing key at ["id"]`, before reaching maintenance. Goal creation requires an explicit schema-valid ID. The fixture supplied only objective and budget.

The fixture now supplies `goal_` followed by a hyphen-free UUID, matching the existing creation contract. No API defaults or validation were changed. This is distinct from the extra-underscore invalid-ID construction in BUG-20261014-146.

Verification: from `packages/apexo`, pinned Bun 1.3.14, `bun script/grok-goal-legacy-reports.mjs cli` passed four checks with zero provider requests. The run reached real startup maintenance for unknown, live and verified-dead owners, checked unchanged report hashes and public Goal state, and verified idempotent restart.

## Independent managed-child CLI fixture occurrence

The new managed-child admission script attempted native Goal creation on a Workflow child to verify rejection before Goal state mutation. It supplied objective and budget but omitted the required ID, so payload decoding returned HTTP 400 (`Missing key at ["id"]`) before the expected owner conflict. Supplying `goal_managedrefusal` reaches the actual HTTP 409 boundary and leaves Goal state absent. No API defaults or validation changed.

`bun script/grok-managed-child-admission.mjs cli` passed four checks and two provider calls in isolated source validation, including native and compatibility rejection, restart persistence, and ordinary ID reuse. This is a second independent omitted-ID authoring episode; it is distinct from invalid extra-underscore IDs and does not meet the rule-promotion threshold.
