# Official strategy fixture inspected the planner staging path after promotion

- **Bug ID:** BUG-20261014-168
- **Type:** Test fixture artifact lifecycle
- **Scope:** Installed Goal strategy comparison
- **Status:** Verified
- **Independent occurrences:** 1

The runtime completed the Goal and ran its strategy adviser, but the fixture's
final unchanged-plan assertion failed with ENOENT. It retained the planner's
per-attempt `plan-<id>.md` output path. The runtime promotes that output into the
canonical `goal/plan.md`, which is the path supplied to the strategist.

The fixture now obtains the authoritative plan path from the strategist's actual
input contract and compares its contents against the originally written plan.
It does not assume that a temporary staging file survives successful planning.
Verification is the isolated installed-runtime strategy script.

Final verification: `bun run script/grok-goal-strategy-official.mjs` from
`packages/apexo` passed two checks with 37 local requests on installed Grok
1.0.52. The isolated child exited and final stderr was empty.
