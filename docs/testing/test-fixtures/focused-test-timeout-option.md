# BUG-20261014-205: Focused fixture gate omitted the package timeout

- **Scope:** Manual invocation of the migrated HTTP fixture gate.
- **Status:** Invocation corrected; the affected feedback test passed with the explicit timeout.
- **Observed:** A focused `bun test` invocation omitted `--timeout 30000`; the
  cross-directory feedback test was interrupted after approximately five seconds.
- **Expected:** Focused integration gates use the same 30-second per-test timeout
  as the package test script.
- **Reproduction:** Run the eleven migrated HTTP fixture files with plain `bun test`
  under Bun 1.3.14. The observed run reached the default five-second limit.
- **Root cause:** The focused command did not inherit the package script's timeout
  argument. This was an invocation mistake, not evidence of a product deadlock.
- **Fix:** Pass `--timeout 30000` on the focused commands, matching `packages/apexo/package.json`.
- **Verification:** In the corrected eleven-file run, the affected feedback test
  passed in approximately 7.8 seconds. That run had a separate first-request HTTP
  501 response with unknown cause; it is not attributed to this timeout mistake.

