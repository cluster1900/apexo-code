# BUG-20261014-250: Role preflight leaked Location requirements into the child callback

- **Scope:** Native Goal role selection helper and `SessionGoalRunner.review`.
- **Status:** Verified by both package typechecks and the native regression gate.
- **Observed:** Core typechecking rejected the `SessionGoalReview.Execute` callback
  because the new selection helper still required Agent, model resolver, Catalog
  and ToolRegistry services. The callback contract has no remaining environment.
- **Expected:** Location services are captured while the owning runner layer is
  assembled, before creating the environment-free callback.
- **Reproduction:** Run `bun typecheck` in `packages/core` with the initial direct
  `SessionGoalRoleSelection.resolve` implementation.
- **Root cause:** Service acquisition was deferred into the role callback instead
  of occurring at the runner's dependency boundary.
- **Fix:** `SessionGoalRoleSelection.make` captures the four real Location services
  and returns the selection function. The runner acquires it during layer setup.
  No casts, mock services or weakening of the callback environment were introduced.
- **Verification:** Core `bun typecheck` passed. The six-file native Goal regression
  gate passed 104 tests and 713 assertions. Apexo `bun typecheck` also passed after
  the independently owned terminal MCP browser correction.

