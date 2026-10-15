# Observe restoration interruption through Exit

- Bug ID: BUG-20261015-275.
- Status: Integrated; shared restoration18/181 and CLI/Desktop acceptance pass.
- Scope: Held native restoration tests for accepted Stop and Session deletion.
- Independent occurrences: 1.

The new race fixture wrapped its child restoration operation in `Effect.result` and then joined it as if cancellation were a typed failure. Stop and deletion intentionally interrupt ownership. `Effect.result` captures typed errors, not interruption, so the interruption escaped before the fixture could inspect the saved intent. The first run reported 6 passes, 3 failures and 51 assertions with `All fibers interrupted without error`.

The fixture now observes `Effect.exit` for the operation being deliberately cancelled. It still invokes the real Session interruption/deletion methods and joins the child; it neither suppresses production failures nor replaces ownership services.

From `packages/apexo`, `bun test test/v2/schedule-restore-races.test.ts` then reached all nine actual behavior cases: 7 passed, 2 failed and 69 assertions. Session deletion completed with no provider call. The two remaining failures accurately exposed a product gap: the accepted Stop left the saved restoration intent as `restart_required` rather than `stopped`. That separate cause is tracked in [BUG-20261015-274](../runtime/native-scheduler-restoration-stop-fence.md). The result is not a claim that the entire race suite passed.

After the separate BUG274 product repair, the combined five-file restore batch passed 18 tests and 167 assertions, including all nine held-authority race cases. This verifies the fixture correction in the corrected private implementation; shared integration remains pending.

## Shared verification

The reviewed correction is integrated. From `packages/apexo`, `bun test --timeout 30000 test/v2/schedule-restore-store.test.ts test/v2/schedule-restore-owner.test.ts test/v2/schedule-restore-runtime.test.ts test/v2/schedule-restore-races.test.ts test/e2e/v2-session-restore.e2e.test.ts` passes18 tests/181 assertions. The refreshed repository `bun turbo typecheck --concurrency=2` passes all21 tasks. Shared source CLI passes four checks/eleven provider calls, including actual restart and future recurrence. Its first startup attempt is retained under [BUG163](../test-stability/native-terminal-backend-readiness.md); that separate delay has no established fix. Shared rebuilt Desktop acceptance also passes four checks/eleven provider calls. Production browser and actual native window each pass four checks in both eligible and permission-required branches across en/zh/zht; mini/fullscreen at80×24 each pass five ordinary checks and one permission-consent check.
