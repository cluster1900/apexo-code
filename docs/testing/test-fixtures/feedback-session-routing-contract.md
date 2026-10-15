# BUG-20261014-076: Feedback Fixture Mistook a Directory Hint for Session Authorization

- **Status:** Corrected fixture and verified.
- **Occurrences:** One independently observed contract mistake; no recurring constraint.
- **Scope:** Feedback HTTP routing regression.
- **Observed:** An authenticated request for an existing Session returned its drafts even with a different directory hint; the new test expected 404.
- **Expected:** Match the shared routing contract: the persisted Session directory takes precedence over the request hint. A draft belonging to a different Session must still return 404.
- **Reproduction:** From `packages/apexo`, run the original cross-directory case in `test/server/httpapi-feedback.test.ts`.
- **Root cause:** The fixture treated `x-apexo-directory` as an authorization boundary. `WorkspaceRoutingMiddleware.planRequest` intentionally selects `session.directory` first. The feedback handler therefore correctly executed in its owning Session's directory.
- **Fix:** Assert owner-based routing for an existing Session and retain the independent foreign-draft-ID denial test. No production routing or permission behavior was weakened.
- **Verification:** The final affected four-file regression passed 43 tests with 120 assertions; the isolated corrected routing case also passed with four assertions. Earlier five-second scope-teardown deadlines are recorded in [INVESTIGATION-20261014-004](../test-stability/feedback-http-teardown.md) and are not attributed to this assertion mistake.
