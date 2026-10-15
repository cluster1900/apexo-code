# Native Compaction Fixture Used an Unavailable Resume Route

- **Bug ID:** BUG-20261014-145
- **Scope:** `packages/apexo/test/e2e/v2-compaction.e2e.test.ts`
- **Status:** Verified
- **Independent occurrences:** 1

The initial fixture posted to `/api/session/:sessionID/resume` and received 404
before exercising nonempty compaction. The native HTTP contract exposes prompt
admission and `/wait`; it does not expose that resume path. Reproduce with the
initial seed sequence: admit with `resume: false`, then POST the unsupported path.
The fixture now retries the exact admitted input with `resume: true`, then waits
for the existing drain. This tests the actual native admission contract.

Verification: from `packages/apexo`, pinned Bun 1.3.14,
`bun test test/e2e/v2-compaction.e2e.test.ts test/e2e/v2-goal.e2e.test.ts`:
2 tests passed, 76 assertions, no failures. No product route was added to satisfy
the mistaken fixture.
