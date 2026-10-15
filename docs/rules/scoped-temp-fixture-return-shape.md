# RULE-20261015-007: Scoped temporary fixture return shape

- **Scope:** Effect tests using `tmpdirScoped` and Promise tests using `tmpdir`.
- **MUST:** Use the actual return type: `yield* tmpdirScoped()` yields the directory string; `await tmpdir()` yields an object with `.path`.
- **NEVER:** Transfer `.path` access from the Promise fixture to the Effect fixture, cast away the mismatch, or relax a production assertion to accommodate an undefined directory.
- **Verification:** Check the helper declaration when adding a fixture; run the focused real test and package `bun typecheck`. For routing or external-directory tests, ensure the request actually uses the intended distinct directory.
- **Source:** [BUG-20261014-075](../testing/test-fixtures/feedback-directory-return-type.md) consolidates three independent episodes, including the separately documented Stop occurrence in [BUG-20261014-072](../testing/test-fixtures/hooks-stop-fixtures.md).

This rule concerns the returned value only. Real process-spawner setup remains governed independently by [RULE-20261014-003](scoped-temp-fixture-spawner.md).
