# RULE-20261015-001: Expose Services Consumed by Application Fixtures

- **Status:** Active.
- **Sources:** [BUG-20261014-134](../testing/test-fixtures/native-delete-services.md), with seven independent omitted-public-output fixture failures; [BUG-20261015-003](../testing/test-fixtures/native-session-lifecycle-fixture.md), with three independent omitted-concrete-execution-replacement fixture failures. These are distinct causes covered by one graph-construction checklist.
- **Scope:** Effect tests that construct an application with `AppNodeBuilder` or `LayerNode.group`, including tests that enter a `LocationServiceMap` context.
- **MUST:** Include each service directly consumed by the fixture in the appropriate group's public outputs, or supply it explicitly through an existing real layer. Check service placement before choosing the group. Capture process-global services from the root application context before entering a Location context when needed.
- **MUST:** Bind each required abstract/unbound node to its real implementation through the builder replacement map (for example, `[SessionExecution.node, SessionExecutionLocal.node]`). Including the concrete implementation in a public group does not replace the abstract node. Verify both graph binding and public outputs before running behavior assertions.
- **NEVER:** Assume a service is available to a fixture merely because another node constructs it as a transitive dependency. Do not expose a process-global service as Location-scoped or substitute a mock to hide a missing binding.
- **Verification:** Run the affected package tests and confirm that the intended behavior assertions and scoped teardown complete. A missing-service failure during fixture construction does not verify the product behavior. Typecheck the affected package after integration.

The first five independent cases were the native deletion fixture's Hook snapshot
service, the native MCP recovery fixture's global guard/event services, the
native LSP restart fixture's global guard, the native Task authority fixture's
PermissionSaved service, and the managed-child reconstruction fixture's Lifecycle
service. Multiple missing services in one construction failure count as one
occurrence. The separate production LocationServices exposure record is not
counted toward this fixture rule.

The sixth independent fixture episode was the native Shell worker application’s omitted public process services, verified through the corrected real-process tests. Multiple missing nodes in that one fixture setup count as one occurrence.

The three concrete-replacement cases are the deletion, native Memory and explicit Scheduler restoration fixtures. They do not increase BUG134's public-output occurrence count. The missing custom data directory in the first BUG003 episode is also distinct and is not counted as another binding failure.

The seventh independent fixture episode attempted to consume the intentionally private native legacy Memory leaf. Its corrected fixture uses the exposed lifecycle facade rather than expanding the production public graph.
