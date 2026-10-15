# BUG-20261015-075: Cancellation accepted before Task worker registration

- **Scope:** Isolated native Task draft; no shipped regression claimed.
- **Status:** Verified in the isolated composed runtime; final integration acceptance pending.
- **Observed:** A real durable running launch existed before its BackgroundJob registration. Cancellation returned success before settlement registration. With a settlement latch present but still no job, cancellation waited until the fixture deadline instead of cancelling execution.
- **Expected:** Cancellation either joins the registered owned worker or rejects the not-yet-cancellable launch explicitly. It must not report accepted cancellation while future provider work remains authorized.
- **Root cause:** TaskControl treated `BackgroundJob.cancel` returning no job as successful cancellation, then optionally waited on a latch whose worker could still start normally.
- **Fix:** If no worker was cancelled and the durable launch remains running, return the existing typed `busy` conflict. The HTTP handler maps it to 409; callers may retry once registration completes. Registered workers retain the shared joined terminal receipt path.
- **Reproduction:** `bun test test/v2/task-store.test.ts` uses the real SQLite store and TaskControl, stopping after launch commit and then after settlement registration. Before correction the two results were success and a one-second timeout, rather than two busy errors. No provider or private HTTP route is fabricated.
- **Verification:** The corrected composed native Task gate passed 10 tests/162 assertions, retaining concurrent two-cancel plus wait and exactly one cancelled parent continuation. Expanded boundary checks passed 2 tests/39 assertions: both pre-registration windows return busy without changing the launch; missing terminal receipts and closed settlement owners fail stale rather than hanging.
