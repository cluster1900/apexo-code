# BUG-20261014-253: Valid-role fixture also denied its assigned report writes

- **Scope:** CLI/Desktop role-pair acceptance fixture reviewer permissions.
- **Status:** Verified on CLI and Desktop.
- **Observed:** The valid pair selected `reviewer` and the alternate model correctly,
  but planning paused with `infra_paused`. The durable child transcript recorded
  `goal_report_write` as an error, and both actual provider turns were billed.
- **Expected:** The success fixture denies workspace edits while permitting the
  assigned Goal report outside the workspace. Runtime permission enforcement remains.
- **Reproduction:** Run `bun script/grok-goal-role-selection.mjs cli` with reviewer
  permission `edit: "deny"`, then inspect the persisted planner tool receipt.
- **Root cause:** The fixture's global edit denial covered the private report path
  as well as workspace files. `SessionGoalRole` correctly checks edit permission
  before writing an assigned report; file ownership alone does not bypass policy.
- **Fix:** Narrow the fixture denial to `**/workspace/**`. Preserve actual report
  permission checks and add the Goal state and evidence location to failure output.
- **Verification:** Corrected CLI and Desktop runs each passed six scenarios with
  84 provider requests and exact per-case token accounting. This differs from the
  older filename-pattern fixture error, which failed to match a protected workspace file.
