# BUG-20261014-151: Hook management handlers required services outside their scope

- Scope: Native and compatibility hook snapshot HTTP handlers and application service exports.
- Observed: Type checking reported unfulfilled service requirements in Server routes and embedded test server layers after management handlers were added.
- Expected: Session placement middleware provides Location services per request; process-global control services and compatibility adapters are exported explicitly by their application graph.
- Reproduction: Run package `bun typecheck` after adding the initial Hooks handler that read `HookSnapshotLocation.Service` during handler-group construction.
- Root cause: Group construction occurs outside the Session Location middleware. In addition, services present only as another node's dependencies were not necessarily exported to sibling HTTP handlers.
- Fix: Resolve the Location snapshot service inside each native request. Export SessionExecution from both server application groups and CompatHookSnapshotLocation from the compatibility group.
- Verification: Focused HTTP exercise passed all five hooks scenarios, including both native and compatibility uncaptured inspection and reload conflict responses. Final `bun typecheck` from `packages/apexo` exited 0 after the related application exports and separate Feedback permission boundary fixes settled.
- Occurrences: One integration failure; no recurring constraint promoted.
