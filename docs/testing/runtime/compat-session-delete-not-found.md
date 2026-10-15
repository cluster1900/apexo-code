# Compatibility Session deletion lost its missing-session response

- **ID:** BUG-20261015-029.
- **Status:** Fixed; focused verification passed.
- **Occurrences:** One confirmed integration failure.
- **Scope:** Compatibility `DELETE /session/:sessionID`.
- **Observed:** The complete unit run returned HTTP 200 for a missing Session where the existing compatibility API promises HTTP 404 with a `NotFoundError` body.
- **Expected:** Preserve that compatibility response. Native `DELETE /api/session/:sessionID` remains idempotent with HTTP 204 for an absent Session.
- **Reproduction:** From `packages/apexo`, run `bun test test/server/httpapi-session.test.ts -t 'returns declared not found errors for read routes'` with the shared removal service but without the compatibility handler's existence check.
- **Root cause:** Replacing the old removal implementation with the shared, idempotent lifecycle removal service removed the implicit lookup that previously produced the compatibility error. The HTTP adapter relied on that old internal behavior.
- **Fix:** Validate existence through the compatibility handler's existing `requireSession` boundary before invoking shared removal. Keep the shared lifecycle and native endpoint idempotent.
- **Verification:** The original complete gate had 3,997 passed and two failures; this record describes only the missing-session response failure. The complete compatibility Session HTTP file subsequently passed 21 tests / 111 assertions with pinned Bun 1.3.14. The final aggregate rerun passed 4,017 tests with zero failures, including this regression, and all six Turbo tasks exited successfully.
- **Constraint:** None; one confirmed occurrence.
