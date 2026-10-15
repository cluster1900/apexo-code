# Empty Session restoration must preserve placement without binding timers

- Bug ID: BUG-20261015-280.
- Status: Integrated; shared focused and type checks pass.
- Scope: Explicit restoration of an ordinary or historically managed Session with no schedule intents.
- Independent occurrences: 1.

Source review found that restoration called the Scheduler owner-binding path even when the owned intent list was empty. That path rejects managed children. With explicit Session selection now invoking restoration, opening an empty managed child could therefore display a restoration failure despite there being no intent to activate. Binding an empty ordinary Session also creates unnecessary Scheduler ownership.

The repair reuses the actual parent lookup and directory/workspace placement validation before the empty success. It then returns `schedules: []` without binding timers. It must not bypass missing/replaced Session identity or wrong-Location checks. Managed children with actual schedule intent continue to use the existing authority restrictions.

The focused cases extend `test/e2e/v2-session-restore.e2e.test.ts` with real historical managed-child creation and HTTP restoration, and `test/v2/schedule-restore-runtime.test.ts` with direct wrong-Location calls for an empty Session. The historical marker is used only to prove the existing quarantine classification; it grants no execution authority. The original implementation returned HTTP 400 instead of 200 for the real historical managed child: zero passes, one failure and nine assertions. After the amendment, the combined five-file restoration suite passed 18 tests and 181 assertions, including the wrong-Location guard, ordinary/managed empty results, missing identity and zero provider calls. The earlier fixture graph setup failure is separate from this product boundary and belongs to [BUG003](../test-fixtures/native-session-lifecycle-fixture.md).

Commands from `packages/apexo`: the red case used `bun test test/e2e/v2-session-restore.e2e.test.ts`; the green batch used `bun test test/v2/schedule-restore-store.test.ts test/v2/schedule-restore-owner.test.ts test/v2/schedule-restore-runtime.test.ts test/v2/schedule-restore-races.test.ts test/e2e/v2-session-restore.e2e.test.ts`.

## Shared verification

The reviewed correction is integrated. From `packages/apexo`, `bun test --timeout 30000 test/v2/schedule-restore-store.test.ts test/v2/schedule-restore-owner.test.ts test/v2/schedule-restore-runtime.test.ts test/v2/schedule-restore-races.test.ts test/e2e/v2-session-restore.e2e.test.ts` passes18 tests/181 assertions. The refreshed repository `bun turbo typecheck --concurrency=2` passes all21 tasks. Shared source CLI passes four checks/eleven provider calls, including actual restart and future recurrence. Its first startup attempt is retained under [BUG163](../test-stability/native-terminal-backend-readiness.md); that separate delay has no established fix. Shared rebuilt Desktop acceptance also passes four checks/eleven provider calls. Production browser and actual native window each pass four checks in both eligible and permission-required branches across en/zh/zht; mini/fullscreen at80×24 each pass five ordinary checks and one permission-consent check.
