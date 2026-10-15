# Native Goal report error responses

## BUG-20261014-057

- **Scope:** Native V2 Goal report HTTP endpoints and public Protocol errors.
- **Observed:** Review found that missing and invalid report artifacts were mapped to HTTP 503, unlike their compatibility endpoint semantics.
- **Expected:** A missing report returns HTTP 404; a corrupt or invalid report returns HTTP 400. Unclassified infrastructure failures remain HTTP 503.
- **Reproduction:** Complete a native Goal, request a nonexistent report ID, then modify the stored plan artifact and request that report.
- **Root cause:** The initial native handler collapsed all report-store failures into service unavailability.
- **Fix:** Map the existing report-store missing/invalid reasons explicitly and declare the typed report-not-found error in the public Protocol.
- **Verification:** Server package `bun typecheck` passed. From `packages/apexo`, `bun test test/e2e/v2-goal.e2e.test.ts` passed one test and 34 assertions, including typed 404 and invalid-artifact 400 responses. Client regeneration is managed with the shared public API generation gate.
- **Recurrence:** One review finding; no historical recurrence claimed.
