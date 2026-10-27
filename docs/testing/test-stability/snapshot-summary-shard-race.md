# BUG-20261027-001: Snapshot summary assertion raced concurrent test batches

- **Status:** Stabilized; production root cause remains unconfirmed.
- **Affected scope:** `packages/apexo/test/session/snapshot-tool-race.test.ts` when the Apexo test runner executes multiple batches concurrently.
- **Observed behavior:** PR #171's Linux `apexo tests (1/6)` job failed the snapshot race test while other batches passed. The test observed an empty persisted Session diff after the prompt completed; the batch also reported an EPIPE while forwarding the failed worker output.
- **Expected behavior:** The test waits for the fire-and-forget `SessionSummary.summarize` projection to settle, then asserts a non-empty diff for the created file within a bounded deadline.
- **Reproduction:**
  1. From `packages/apexo`, run the CI-style shard with Bun 1.4.4: `APEXO_TEST_SHARD=1/6 GITHUB_ACTIONS=false bun run script/run-tests.ts`.
  2. Run under concurrent batch load; the affected test is in batch 1 and the same shard also executes batches 7 and 13.
  3. The historical CI failure was `tool execution produces non-empty session diff (snapshot race)` with an empty diff and an EPIPE in the batch output.
- **Root cause:** The summary projection is intentionally asynchronous and its completion latency under concurrent batch load was not established. The failure does not prove that the production snapshot capture is incorrect; the original test had only a five-second observation window.
- **Fix:** Extend the bounded diff observation from 5 seconds to 15 seconds and document that the summary may settle after prompt completion under shared runner load. The non-empty diff assertion remains required.
- **Verification:** The focused test passed with Bun 1.3.14 and Bun 1.4.4. The CI-style `APEXO_TEST_SHARD=1/6` run with Bun 1.4.4 passed all three selected batches (1, 7 and 13) after the change.
- **Linked issue/PR:** [PR #171](https://github.com/cluster1900/apexo-code/pull/171); the original workflow failure was reported there.
- **Linked constraints:** None; this is the first observed occurrence of this exact test timing failure.
