# RULE-20261015-004: Use Valid Goal Identifiers in Fixtures

- **Status:** Active.
- **Source:** [BUG-20261014-146](../testing/test-fixtures/native-compaction-goal-id.md), three independent compaction, Task-admission and Goal-admission fixture episodes.
- **Scope:** Tests and acceptance scripts that construct or submit Goal IDs.
- **MUST:** Use the canonical Goal ID constructor with `goal_` followed only by alphanumeric characters, or use its canonical generator. Keep human-readable scenario labels outside the identifier.
- **NEVER:** Add another underscore, hyphen or other punctuation to the suffix, cast around validation, or weaken the production schema to make a fixture reach a different boundary.
- **Verification:** Confirm that an intended ownership/conflict test actually reaches that boundary, rather than passing or failing at malformed-payload validation. Run the affected package fixture and typecheck separately.

Multiple malformed IDs in one fixture-authoring run count as one occurrence. These ID spelling failures are separate from omitted required Goal IDs and from product permission failures.
