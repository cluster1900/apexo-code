# RULE-20261015-019: Create custom Global data directories in fixtures

- **Status:** Active.
- **Scope:** Native application fixtures that replace `Global.Service` paths and exercise Session deletion or Goal report cleanup.
- **MUST:** Create the replacement `Global.data` directory before constructing or using the real application graph. Keep it inside the scoped fixture root.
- **NEVER:** Supply a nonexistent custom data directory and interpret the resulting cleanup `lstat` failure as a Session lifecycle defect.
- **Verification:** Run deletion and scoped teardown through the real services; verify the intended assertions complete. Inspect the original retirement cause when deletion reports `SessionLifecycle.Failure`.
- **Source:** [BUG-20261015-003](../testing/test-fixtures/native-session-lifecycle-fixture.md) records three independent missing-data-directory fixture episodes: original native deletion, MCP attachment, and Stop cancellation. Its separate abstract-execution binding omissions are not counted toward this rule.
