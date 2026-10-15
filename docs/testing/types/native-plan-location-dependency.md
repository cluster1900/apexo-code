# BUG-20261015-103: Native Plan draft omitted its Location dependency

- **Status:** Corrected and verified in the isolated native Plan draft.
- **Scope:** New Core SessionPlan service declaration; not a shipped runtime failure or application-fixture public-output omission.
- **Observed:** The initial Core package typecheck rejected the service node with a missing dependency requirement.
- **Expected:** A service that reads Location.Service explicitly declares Location.node in its dependency list.
- **Cause:** The draft consumed Location.Service but omitted its node from the declared dependencies.
- **Fix:** Add Location.node to SessionPlan's own dependency list.
- **Reproduction:** Run `bun typecheck` from `packages/core` with the initial native Plan service draft.
- **Verification:** Core and Apexo package typechecks passed. The real native Plan HTTP suite passed 11 tests and 107 assertions, and the CLI fixture passed six checks with eight local-provider requests.

This is one authoring/typecheck episode. It is not a recurrence of the application-fixture public-service-output rule.

Shared integration verification: the combined native Plan and background Task approval suite passed 14 tests / 153 assertions; all 21 repository typecheck tasks passed. CLI and rebuilt Desktop recovery each passed 13 checks / 10 local-provider calls; the actual crash checkpoints passed 10 checks / six calls. This does not replace the separate pending UI acceptance.
