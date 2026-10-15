# BUG-20261015-324: HTTP regression retained the old unsupported legacy flush contract

- Scope: Pure native and mixed Memory operation HTTP regression tests.
- Observed: The complete unit gate failed two assertions expecting HTTP 403 from an empty legacy flush; the implemented endpoint correctly returned 200.
- Expected: Legacy flush now admits a durable operation and settles an empty source as no_work without inference. V2 recovery preview remains unsupported for the legacy backend and must reject without admission.
- Root cause: The earlier unsupported-operation regression continued using flush after native legacy flush was implemented. Its capability assumption was stale; this is separate from the earlier HTTP error-mapping defect.
- Reproduction: Run `GITHUB_ACTIONS=false bun turbo test --concurrency=2` from the repository root, or the earlier `test/e2e/v2-memory-operation.e2e.test.ts` from packages/apexo.
- Fix: Keep unsupported V2 recovery preview rejection, empty receipt-list and missing-operation assertions. Add empty legacy flush admission, terminal no_work, exact retry, one retained receipt and zero-provider checks through both real HTTP hosts.
- Verification: The corrected pure and mixed HTTP hosts pass in the shared 12-file Task/Memory gate: 54 tests, zero failures and 495 assertions. Run `bun test --timeout 30000 test/e2e/v2-memory-operation.e2e.test.ts` from packages/apexo to exercise this regression. The earlier failing aggregate retained 4398 passes, nine failures and one unhandled error across 431 files; only two failures belong to this stale contract. A new complete unit gate remains required.
- Independent occurrences: One fixture maintenance omission observed on two hosts. No recurring constraint is promoted.

The historical mapping correction remains in [BUG-20261015-242](../runtime/memory-operation-unsupported-status.md).

The first repair attempt assumed a public capture endpoint that does not exist, producing 404 in both hosts. Inspection of the canonical Protocol group corrected the regression to use its published V2 recovery preview endpoint. The surrounding Memory/lock gate passed 70 tests; only those two fixture route assertions failed. This is retained as part of the same maintenance episode, not hidden by the final rerun.
