# RULE-20261015-011: Explicit production service outputs

- **Scope:** Production AppNode/LayerNode aggregate groups, including global HTTP hosts and LocationServiceMap output groups.
- **MUST:** Explicitly expose each service consumed by a caller outside its constructing dependency graph in the appropriate public aggregate group. Check every supported host that mounts the handler or accesses the service.
- **NEVER:** Assume that constructing a service transitively through another node exposes it to an independent handler or LocationServiceMap consumer. Do not fix missing outputs by changing global/Location placement, adding Session-ID layers, or weakening Effect environment types.
- **Verification:** Check the dependency graph to distinguish already-constructed-but-unexposed services from entirely missing nodes. Run affected Core/Server/application package typechecks and the real host endpoint or Location entrypoint. A leaf typecheck alone cannot validate aggregate outputs.
- **Source:** [BUG-20261014-062](../testing/runtime/workflow-source-registration.md) records four independent production occurrences: Workflow source resolution, native LSP status, native Shell process handlers and native Scheduler handlers in the mixed HTTP host.

This production rule complements [RULE-20261015-001](fixture-appnode-public-services.md), which concerns test fixture public groups. It does not change service lifetime or authorize cross-layer runtime dependencies.
