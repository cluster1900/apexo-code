# Native Memory mode introduced a Location construction cycle

- **Bug ID:** BUG-20261015-149
- **Status:** Fixed in the private draft; verified through real native and mixed HTTP hosts.
- **Scope:** Native Memory mode, Location construction and HTTP management.
- **Observed:** The first Memory status request returned HTTP 500 before entering its handler. Captured defect: `Unbound layer node: @apexo/example/LocationServiceMap`, while compiling the Location's hoisted services.
- **Expected:** Passive status resolves the stored Session Location and returns mode information without provider work.
- **Cause:** The global storage-mode service depended on SessionExecution to inspect busy state. ExecutionLocal depends on LocationServiceMap, while constructing that map hoisted the mode service through Location Memory tools, introducing a construction cycle. This was not an omitted public output: adding the mode service to public groups alone still failed.
- **Fix:** Keep mode storage dependent on Database, SessionStore and SessionLifecycle. The HTTP handler captures the already process-global Execution service and passes its observed busy value internally. The public payload cannot set it. Durable writes retain their incarnation/revision fences.
- **Verification:** `bun test test/e2e/v2-memory.e2e.test.ts` in `packages/apexo`: two tests, 36 assertions passed, covering both actual pure-native and mixed HTTP graphs. Each host exercises passive management and the native Memory tool transcript. A previous combined service/native HTTP gate passed nine tests and 57 assertions. No new executor or coordinator reservation was added.
- **Rejected diagnosis:** This is not another occurrence of the production-public-output bug. The failed output-only experiment and captured construction site distinguish the causes.

## Shared integration verification

The shared eleven-file Memory/terminal gate passed 96 tests / 371 assertions, including the six-file Memory coverage; all 21 workspace typechecks passed. Shared source CLI and freshly rebuilt Desktop each passed four checks / three provider requests. The five native Memory HTTP inventory scenarios also passed. The separate Memory-context timing observation remains unresolved and is not attributed to this repair.


## Second independent occurrence: native capture completion observer

A new private native capture draft imported the process-global Memory operation controller directly into the Location-scoped Session runner. The controller discovers Location through LocationServiceMap, so hoisting it through the runner reintroduced a global-to-Location construction cycle. Core typechecking exposed the recursive graph and the real runtime fixture failed during Location construction. This is the same dependency-direction mistake as the original mode service, not a missing public output.

The runner and compaction service now depend only on a dependency-light `SessionMemoryObserver` capability. Process-global ExecutionLocal supplies callbacks bound to the exact original lifecycle claim; the controller continues to discover placement globally. Location code never constructs global routing. The corrected real lifecycle gate passed seven tests / 51 assertions and Core typechecking passed; the expanded final gate and real CLI verification are recorded in the Stage 1 feature document. There are two independently verified occurrences, below the rule-promotion threshold.
