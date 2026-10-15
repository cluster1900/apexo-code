# BUG-20261015-174: Complete HTTP exercise timed out reading a compatibility Session

- **Status:** Investigating; no production repair established.
- **Scope:** `packages/apexo` complete HttpApi exercise after native CLI and Memory integration, Effect mode, `session.get` (`GET /session/{sessionID}`).
- **Observed:** Route coverage and authorization modes each passed 309 scenarios over 283 routes. Effect mode passed 308 scenarios and failed `session.get` at the existing 30-second scenario deadline. The command exited 1, with no skipped, missing or extra scenarios.
- **Expected:** Scenario initialization, seeded Session creation, the read request and assertions complete within the existing bound, followed by owned-resource cleanup.
- **Reproduction:** From `packages/apexo`, run `bun run test:httpapi` with pinned Bun 1.3.14. One failing aggregate observation is established.
- **Root cause:** Unknown. The aggregate did not enable phase tracing, so its timeout does not identify a slow HTTP handler. Application logs separately contained Goal cleanup SQLite I/O warnings during fixture resets; their causal relationship to this timeout is unproven.
- **Investigation:** The preserved, phase-traced subset passed 98 scenarios on unchanged sources, including `session.get`. No deadline, assertion or production implementation was relaxed. Its application log reproduced a separate fixture database-reset defect, now corrected as [BUG175](../test-fixtures/httpapi-database-reset-ownership.md). Four focused scenarios also passed after that correction; neither pass establishes the cause or repair of this timeout.
- **Verification:** The original complete gates failed. A later complete three-mode pass is recorded below; scoped passes do not replace it, and that aggregate pass does not establish a causal repair.

## Additional complete-gate observation

A later complete gate passed all 309 coverage and 309 authorization scenarios. Effect mode passed 308 and failed `v2.goal.get` at the unchanged 30-second scenario deadline. This is a different route within the same unresolved stability investigation; no common timeout cause has been established. The aggregate still lacked phase traces, so the elapsed time cannot be attributed specifically to its HTTP handler rather than fixture acquisition, service construction, Session seeding or request execution. The independently isolated Worktree adapter owner in BUG175 explains the repeated SQLite warning only. Neither that causal repair nor an unchanged focused pass proves a timeout fix.

An unchanged, phase-traced isolated `v2.goal.get` exercise subsequently passed its single scenario: temporary fixture acquisition, service/instance initialization, Session seeding, HTTP 200, assertions and cleanup all completed. This does not reproduce the aggregate deadline or establish a repair.

## Later complete pass

After integrating the independently verified Worktree owner repair, `bun run test:httpapi --trace --progress` from `packages/apexo` exited zero. Coverage, authorization and Effect modes each passed all 309 scenarios over 283 routes; no failures, skips or inventory gaps remained. Effect mode kept phase tracing and the original deadlines. Both previously failing queries completed, and the retained application log contained no Goal cleanup recovery or SQLite I/O warnings. This is a successful current aggregate checkpoint. The earlier timeout causes remain unknown; the ownership repair has not been demonstrated to explain them.
