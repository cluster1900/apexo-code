# BUG-20261014-020: Session deletion exposes cleanup errors outside its contract

- Status: Fixed and verified. Verified occurrences: 1. No recurring constraint.
- Scope: The compatibility Session.remove Effect error boundary.
- Observed: Adding Goal cleanup introduced database and Goal errors into a method that only exposes NotFoundError, causing TS2322. Expected: preserve NotFoundError from the initial Session lookup and handle internal deletion failures through the existing logging boundary.
- Reproduction: Run `bun typecheck` from `packages/apexo` after adding the cleanup calls inside the old JavaScript try/catch.
- Root cause: JavaScript try/catch inside an Effect generator does not remove typed Effect failures from its error channel.
- Fix: Wrap the internal deletion flow in Effect.gen and Effect.catchCause; keep the initial Session lookup outside that boundary.
- Verification: Package typecheck passed; repository typecheck passed 21/21. The final five-file cleanup/Goal/prompt regression passed 155 tests with one existing skip and no failures.
- Occurrence evidence: On 2026-10-14, the first cleanup typecheck failed at Session.remove with TS2322. The subsequently reproduced corrupt-state deletion bug has a separate cause, recorded as BUG-022.
