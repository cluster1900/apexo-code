# BUG-20261014-062: Production services were constructed transitively but omitted from public groups

- Scope: Native Workflow control, Location service composition, CLI serve typecheck, and public start endpoint.
- Observed: Adding saved-source resolution leaked WorkflowSources.Service through the control method's environment. Full application typecheck detected it; the native start endpoint returned HTTP 500 before provider work.
- Expected: Global control discovers the Session's Location and consumes the explicitly exposed Location-scoped source resolver.
- Reproduction: Typecheck the full affected application after adding WorkflowControl's LocationServiceMap resolution; or run the native Workflow end-to-end test.
- Root cause: The resolver was a transitive dependency of WorkflowRuntime but not a public output of the LocationServices group. Transitive construction does not expose a service for callers using LocationServiceMap.
- Fix: Register WorkflowSources.node in the LocationServices group. Keep filesystem and permission services Location-scoped; do not add Session-ID layers or a global filesystem resolver.
- Verification: Parent owns the aggregate registration and full typecheck. Native end-to-end rerun passed one test and nine assertions, including the public start endpoint.
- Occurrences: Four verified production service exposure errors, distinct from fixture-only public-output errors and the earlier SessionExecution ownership cycle.

## Independent native LSP occurrence

- The first native LSP implementation constructed `LSP.Service` transitively through plugin activation and tools but omitted it from the public Location service group. Real LocationServiceMap tests failed with `Service not found: @apexo/v2/LSP` before their status assertions.
- Added `LSP.node` to the same explicit group. Native LSP tests then reached the actual language servers and passed three tests with 31 assertions after the separate request-lifecycle fixes.
- This is the second verified occurrence of the same transitive-construction versus public-output mistake. It does not yet meet the rule-promotion threshold.

## Native Shell host group: third independent production occurrence

The new process handlers require global `SessionProcessControl` and `SessionProcessCompletion`. Both were already constructed transitively: the existing host Location map hoists control from `BuiltInTools → BashTool/ProcessTool → SessionProcessExecution`, and the host's `SessionExecutionLocal` directly depends on process completion. Their own nodes remain process-global. The native Server routes explicitly exposed both, but the compatibility host's separate `AppNodeBuilderV1` public group omitted them. Apexo typechecking reported a service requirement escaping `RouteRequirements` at `server/routes/instance/httpapi/server.ts`.

The host group now explicitly exports both nodes without moving them into a Location scope or adding Session-ID layers. Corrected Apexo typechecking passed; actual isolated CLI API/tool acceptance passed nine checks / 26 provider calls, including passive process endpoints. This extends the scope from Location output groups to production aggregate groups at the correct placement; the root cause remains transitive construction being mistaken for public exposure.

The third independent occurrence supports [RULE-20261015-011: Explicit production service outputs](../../rules/production-service-outputs.md). Fixture-only omissions remain under BUG134 and RULE001.

## Native Scheduler mixed HTTP host: fourth independent production occurrence

The private Scheduler handler consumed global `SessionScheduleStore`, already constructed transitively by `SessionExecutionLocal → SessionScheduleOwner → SessionScheduleStore`. The native Server host exported the store, but the compatibility host that also mounts the native API omitted its public output. The real CLI process exited before serving requests with `Service not found: @apexo/SessionScheduleStore`; leaf Server and Core types alone did not catch that host composition.

The mixed HTTP host now explicitly exposes `SessionScheduleStore.node` in its existing global public group. No service moved scope, and no alternate execution path was added. The corrected private CLI acceptance passed four checks / six provider calls, including actual Scheduler tools and passive/control API routes. Shared integration remains pending. This is the fourth independent transitive-construction versus public-exposure episode under RULE011, not a fixture-only missing binding.
