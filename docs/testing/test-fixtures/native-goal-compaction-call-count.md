# Goal Pause Fixture Awaited the Previous Provider Count

- **Bug ID:** BUG-20261014-147
- **Scope:** `packages/apexo/test/e2e/v2-goal.e2e.test.ts`
- **Status:** Verified
- **Independent occurrences:** 1

Adding a real manual summary stream to the earlier Goal scenario increased its
provider-call count by one. The later pause scenario still awaited call 10,
which had already finished in the preceding budget scenario. Its next active
Session snapshot raced child creation and observed one owner instead of two.
Reproduce by retaining `llm.wait(10)` before the final pause assertion after
inserting the summary call. Await call 11, the actual held planning request,
before asserting ownership. The successful Goal's summary usage is independently
asserted at 21 total tokens instead of 14.

Verification: from `packages/apexo`, pinned Bun 1.3.14,
`bun test test/e2e/v2-compaction.e2e.test.ts test/e2e/v2-goal.e2e.test.ts`:
2 tests passed, 76 assertions, no failures. The pause scenario still verifies two
active owners, interruption of both, and no extra provider call.
