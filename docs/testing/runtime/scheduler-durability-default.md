# BUG-20261015-219: Native Scheduler implicitly saved recurring intent

- Status: Fixed and verified in the private backend amendment; shared integration pending.
- Scope: Native scheduler_create tool admission, before shared integration of the frozen Scheduler backend.
- Occurrences: One reproduced implementation mismatch.
- Observed: Omitting durable created a receipt with durable=true. Pinned reference create.rs uses input.durable.unwrap_or(false), and Apexo compatibility Scheduler uses input.durable===true. No approved requirement justified the native default difference.
- Expected: Omitted durable is false. Same-Session resources preserve both values; the separate restart-retention correction is recorded in [BUG224](scheduler-session-restart-intent.md). Saved intent still never authorizes replay of interrupted provider work.
- Root cause: Native tool input normalization used input.durable??true despite an optional boolean contract. Store behavior was correct for the supplied resolved value.
- Fix: Normalize omitted durable to false and state the default in the native tool description. Preserve explicit true and existing explicit-true restart acceptance. Update the feature contract description.
- Reproduction: From packages/apexo on pinned Bun1.3.14, run `bun test --timeout 30000 test/v2/schedule-tools.test.ts --test-name-pattern 'origin.*omitted'`. With the old normalization, the real provider/tool test reaches the persisted updated/deleted own receipt and fails expected false versus actual true (0 passed / 1 failed / 10 assertions).
- Verification: The corrected complete `bun test --timeout 30000 test/v2/schedule-tools.test.ts` passes four tests / 42 assertions. Two actual provider-driven origin scenarios verify omitted false and explicit true, including preservation across an own-schedule update and delete; existing permission-denial scenarios remain green. Each origin case uses eight provider turns; no executor was substituted or mocked. Shared CLI/Desktop restart evidence remains a separate integration gate.
