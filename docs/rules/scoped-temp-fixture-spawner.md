# RULE-20261014-003: Provide the Real Process Spawner for Scoped Temporary Fixtures

- **Status:** Active.
- **Sources:** [BUG-20261014-021](../testing/test-fixtures/goal-cleanup-fixture-layer.md), which tracks four independent occurrences, and [BUG-20261014-072](../testing/test-fixtures/hooks-stop-fixtures.md).
- **Scope:** Effect test fixtures using `tmpdirScoped` in `packages/apexo`.
- **MUST:** Provide the real `ChildProcessSpawner` service for both scoped temporary-directory setup and cleanup. Use `AppNodeBuilder.build(CrossSpawnSpawner.node)` as the base layer, or an existing application layer that already includes it.
- **NEVER:** Use `Layer.empty` as the complete environment for a fixture calling `tmpdirScoped`, or replace the missing service with a mock merely to satisfy initialization.
- **Verification:** Run the affected test from its package directory and confirm that both assertions and scoped teardown complete. A missing-service failure before assertions does not verify the product behavior.

The verified independent runs were the Goal cleanup fixture, the durable Stop fixture, the native bundle runtime fixture, and the batch immutable-search fixture. Multiple failed tests in one setup run count as one occurrence; the Stop fixture's separate timeout and returned-path mistakes do not count toward this rule.
