# BUG-20261015-037: Installed Hooks audit fixture used the wrong extension contract

- **Scope:** The isolated installed-runtime persistent Hooks audit fixture, before any Apexo implementation.
- **Observed:** The initial off-tree script could not resolve the package-local ACP SDK. After resolving that setup issue, successive calls failed with Method not found, attempted to treat the wrapped response as an array, and sent an action request with the wrong Session field casing. These failures occurred before the intended enable/disable behavior was exercised.
- **Expected:** The fixture loads the SDK from its owning package and uses the installed extension's actual wire request/response contract.
- **Root cause:** Fixture construction mixed Rust/internal identifiers with the public ACP wire contract and assumed repository-root dependency resolution. The SDK belongs to the Apexo package. Extension methods use the `_x.ai` wire prefix, responses contain `result`, and the outer action request uses `sessionId` even though its Rust field is `session_id`. The tagged action's hook field is `hook_name`.
- **Fix:** Resolve dependencies through the owning package; call `_x.ai/hooks/list` and `_x.ai/hooks/action`, unwrap `result.hooks`, and send `{sessionId, action: {type, hook_name}}`.
- **Reproduction:** Launch the isolated fixture with a repository-root-only dependency link, or use the uncorrected method prefix, response shape, or outer field casing. The failures are startup module resolution, ACP -32601, a local non-array access, or ACP -32602 respectively.
- **Verification:** The corrected installed-runtime probe completed and reaped successfully. Eight explicit assertions verified target-Session disable/enable, retained choices in other captured Sessions, fresh-Session behavior, held-dispatch continuity, the next-dispatch disabled state, and persistence across a full process restart. The held control settled before the blocked hook was released and caused zero provider requests during that interval. Actions reported no required reload or restart.
- **Status:** Fixture repair verified. No Apexo product behavior is claimed by this comparison.
- **Occurrences:** Two independent dependency-root mistakes (the audit and later Workflow probe). Extension-contract mistakes occurred in one audit authoring episode. Repeated launches inside an episode are not additional occurrences; no rule promotion is warranted.

The reusable repository comparison `bun script/grok-hook-preferences-official.mjs` now runs from `packages/apexo`. Its integrated rerun passed ten checks with eight provider requests, including explicit held-control settlement and zero model-work assertions. The child is joined on normal shutdown and after forced termination; private HOME and XDG directories isolate reference state. This rerun adds verification, not a new occurrence.

A second independent dependency-resolution mistake occurred in a later isolated
Workflow child-admission probe: linking only the repository-root node_modules
could not resolve package-local drizzle-orm. Pointing the probe at the owning
Apexo package's installed dependency directory corrected startup; the next
product run reached and reproduced [BUG077](../permissions/workflow-managed-child-admission.md).
A copied reference to an unintegrated Task-only sandbox module was also removed
before that product run. These are fixture setup corrections, not additional
Workflow runtime failures. The dependency-root mistake now has two independent
episodes; the earlier extension wire mistakes still have one. No rule is promoted.
