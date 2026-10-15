# RULE-20261015-018: Serialize generated-source writers and readers

- **Scope:** Same-checkout SDK/Client generation, uncached Turbo build/test preparation, typechecks and source CLI/UI acceptance.
- **MUST:** Finish every generated-source writer before starting a reader of that tree. Inspect the Turbo dependency graph: `bun turbo test` can run the SDK build and its clean/recreate generator before tests. Run complete gates sequentially, or finish and verify their build prerequisites before parallel independent readers.
- **NEVER:** Treat full unit tests, typechecks and source-runtime acceptance as independent read-only operations while an uncached generator may still run. A previously passing manual generation does not mean a subsequent Turbo build will be cached.
- **Verification:** Retain the writer's exit result, verify generated files are stable, then rerun affected readers unchanged. Record failed-load attempts separately; a passing rerun does not erase the race. Keep canonical generators and do not hand-edit generated outputs. Isolated checkouts do not share this filesystem race.
- **Source:** [BUG-20261014-242](../testing/test-fixtures/concurrent-sdk-generation-and-typecheck.md) records three independent failures: whole typechecking, CLI startup and MCP helper loading.
