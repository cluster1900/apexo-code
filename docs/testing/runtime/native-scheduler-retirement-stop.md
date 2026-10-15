# Scheduler retirement must not record user Stop

- Bug ID: BUG-20261015-269.
- Status: Integrated; shared focused and type checks pass.
- Scope: Native Scheduler owner teardown, saved pause reasons and explicit restoration.
- Independent occurrences: 1.

Host or Location teardown joined Scheduler children through the same helper as an accepted user Stop and persisted `paused/stopped`. Explicit Session restoration therefore could not distinguish a normally retired owner from a user instruction to keep the schedule paused.

The isolated red test kept the actual owner/store implementation and reinstated the former `stop(entry.claim)` call in owner close. `bun test test/v2/schedule-restore-owner.test.ts --test-name-pattern 'Joined Scheduler retire '` from `packages/apexo` produced zero passes, one failure and four assertions: expected `restart_required`, received `stopped`.

The draft gives joined retirement a distinct `restart_required` pause reason. Explicit Stop has priority if it arrives during retirement, manual pauses retain their existing reason, and ordinary owner binding does not activate a paused row. Public state projection preserves saved manual/Stop reasons even when the process owner differs. The existing deadline and occurrence receipts are not replayed.

The first corrected owner/store/runtime run passed 8 tests with 79 assertions, including a real Location invalidation and allow/ask/deny restoration. The final combined owner/store/runtime/races/cold-HTTP run passed 18 tests with 167 assertions across five files, including retirement, explicit Stop during retirement and late authority changes. Run from `packages/apexo`: `bun test test/v2/schedule-restore-store.test.ts test/v2/schedule-restore-owner.test.ts test/v2/schedule-restore-runtime.test.ts test/v2/schedule-restore-races.test.ts test/e2e/v2-session-restore.e2e.test.ts`. This is isolated implementation evidence; packaged and shared integration acceptance remain pending.

## Shared verification

The reviewed correction is integrated. From `packages/apexo`, `bun test --timeout 30000 test/v2/schedule-restore-store.test.ts test/v2/schedule-restore-owner.test.ts test/v2/schedule-restore-runtime.test.ts test/v2/schedule-restore-races.test.ts test/e2e/v2-session-restore.e2e.test.ts` passes18 tests/181 assertions. The refreshed repository `bun turbo typecheck --concurrency=2` passes all21 tasks. Shared source CLI passes four checks/eleven provider calls, including actual restart and future recurrence. Its first startup attempt is retained under [BUG163](../test-stability/native-terminal-backend-readiness.md); that separate delay has no established fix. Shared rebuilt Desktop acceptance also passes four checks/eleven provider calls. Production browser and actual native window each pass four checks in both eligible and permission-required branches across en/zh/zht; mini/fullscreen at80×24 each pass five ordinary checks and one permission-consent check.
