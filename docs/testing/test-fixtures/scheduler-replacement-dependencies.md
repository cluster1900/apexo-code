# BUG-20261015-192: Scheduler delay fixture replaced a node with an unbound layer

- **Scope:** Private Scheduler asynchronous-claim fixture; no product defect.
- **Occurrences:** One authoring episode.
- **Observed:** All four cases failed before assertions with `Service not found: @apexo/v2/storage/Database` after the fixture replaced the ScheduleStore node with a raw Effect layer. Additional interruption diagnostics followed the failed construction and are not separate causes.
- **Expected:** Controlled delay instrumentation runs the real ScheduleStore against the same Database and TaskStore owner as the application.
- **Cause:** A raw replacement layer replaces the node's declared dependency graph. Consuming Database and TaskStore inside that layer does not preserve the original node dependencies.
- **Fix:** Use a real global replacement node explicitly depending on Database and TaskStore. Construct the actual store and delay only its actual claim result with Deferred barriers; do not mock durable receipts or duplicate claim logic.
- **Verification:** From `packages/apexo`, `bun typecheck` passed. `bun test test/v2/schedule-execution.test.ts test/v2/schedule-store.test.ts` passed five tests / 77 assertions after the separate missing-Task lookup expectation correction. The held-claim case proves accepted Stop and explicit Resume cannot publish the old claimed child. Shared integration is not yet claimed.

This is distinct from a transitive service omitted from a fixture's public outputs (BUG134), and from a production service missing a declared dependency (BUG103).
