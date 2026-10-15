# Native legacy Goal report recovery

Terminal Goals created before durable report registration can retain flat report directories without an owner catalog or cleanup intent. Existing report listing and downloads already support these directories through the Goal's persisted file references. This change adds bounded maintenance discovery and conditional scratch cleanup; it does not replace those references or their hashes.

## Recovery contract

- Startup and periodic Goal maintenance inspect at most 100 Goal rows per discovery page. A seek cursor advances across pages so active Goals cannot starve later terminal records. Modern managed terminal Goals skip filesystem discovery.
- Only the current database's complete or budget-limited Goals qualify. Validated report IDs are frozen in explicitly decoded private Goal state as `terminalReportRecovery`, with at most 10,000 IDs. Public Goal revision, timestamps, usage, summary, original plan and transcript stay unchanged.
- `unverified` records an ownership gap. It creates no executable cleanup job. Ordinary reads, restart, local idleness, elapsed time, and subsequent report registration cannot convert it into teardown authority.
- `scheduled` records a committed terminal intent. It requires an independently persisted retention receipt for the same Session, Goal ID, creation time and terminal status, with an unambiguous PID/token owner. Maintenance copies that barrier into the frozen cleanup intent. Scheduled does not mean that cleanup has finished.
- A live process continues to protect its scratch. Existing cleanup rules allow removal only after the matching executor finalizer releases the barrier or the recorded process is verified absent. PID reuse fails closed. Conflicting owner receipts remain unverified.
- Cleanup removes only private worker scratch for the frozen report IDs. It retains report files and original hashes, respects filesystem identity protections, and retries interrupted scratch renames. Existing explicit retention deadlines remain authoritative; migration does not infer a new retention policy from current configuration or file age.
- Discovery failures defer that row. Interruption remains interruption. Private recovery metadata survives normal Goal encoding, writes and database reopening without changing the public wire contract.

Unknown historical ownership cannot be reconstructed safely from a terminal status. Such reports remain readable and scratch remains untouched by automatic recovery. Existing explicit Goal/Session cleanup paths retain their own ownership and teardown requirements; this migration does not widen them. No model request, prompt, or completed Goal retry is part of recovery.

## Verification and evidence boundaries

The legacy states below are explicitly synthetic compatibility fixtures, not captured historical databases. They use the actual supported ownerless report writer and its returned SHA-256 hashes. The focused tests exercise real SQLite persistence, actual exited child processes, live owner barriers, database reopening, interrupted scratch removal, stale revisions, bounded pagination, transcript preservation and isolation from another database sharing the data root.

From `packages/apexo`, using pinned Bun 1.3.14:

- `bun test test/session/goal-cleanup.test.ts test/session/goal-reports.test.ts test/session/goal-files.test.ts test/session/goal.test.ts`: 100 passed, 658 assertions. After the test payload typing repair, `bun test test/session/goal-cleanup.test.ts` passed 14 tests with 96 assertions; no expectations changed.
- `bun script/grok-goal-legacy-reports.mjs cli`: four checks passed, zero provider requests. It creates Sessions and Goals through the real server API, stops the backend before constructing labeled synthetic legacy state, then exercises actual server startup maintenance and a second restart. Unknown, live and verified-dead owner cases preserve public Goal state and report hashes; only the verified-dead case loses worker scratch.
- `bun script/grok-goal-legacy-reports.mjs desktop`: four checks passed, zero provider requests against the coordinated packaged Desktop artifact. It exercises the same synthetic compatibility states through actual packaged backend startup maintenance and restart.
- Core and Apexo `bun typecheck`: passed. Apexo's final check ran after coordinated Client/SDK generation.

The installed Grok Build 1.0.52 comparison uses `bun script/grok-goal-official.mjs --execute --workspace --retention`: four checks passed with 22 provider requests. It observes real role-written report paths, confirms their scratch roots are absent after completion, and reads retained classifier details from the terminal snapshot's persisted path. Pinned source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` implements that rescue-before-removal contract in `goal_tracker.rs`. Neither the installed run nor the source audit verifies Apexo-specific migration, database ownership, or crash recovery.
