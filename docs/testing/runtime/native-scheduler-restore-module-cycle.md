# Native Scheduler restoration eager module cycle

- Bug ID: BUG-20261015-267.
- Status: Integrated; shared focused and type checks pass.
- Scope: Native Session facade startup and the explicit Scheduler restoration branch.
- Independent occurrences: 1.

The first restoration test process failed before reaching behavior assertions: zero tests passed, four failed, and three initialization errors reported `Cannot access 'node' before initialization` at the Task permission dependency. Core typechecking had passed.

An eager Session facade import of the Scheduler runtime introduced a service graph cycle through Task, Permission and Session. The runtime dependency is intentional, but most Session operations do not need it during module initialization. The fix keeps schema/error references type-only and dynamically imports the Scheduler service inside the explicit restore operation, before resolving its Location layer. It does not move orchestration into the client or change ordinary Session resume.

Verification from `packages/apexo` with Bun 1.3.14:

- `bun test test/v2/schedule-restore-store.test.ts test/v2/schedule-restore-owner.test.ts test/v2/schedule-restore-runtime.test.ts`: 8 passed, 79 assertions after the lazy import correction.
- `bun test test/e2e/v2-session-restore.e2e.test.ts`: a fresh test process starts the real native HTTP host, creates and reads a Session, sends the bodyless restore request, deletes it and verifies restore returns 404. 1 passed, 10 assertions; zero provider calls.
- `bun typecheck` in `packages/apexo`: passed.

Related: [BUG-20261015-063](native-task-authority-module-cycle.md). That earlier defect unnecessarily coupled a serializable authority codec to runtime services; this defect is an intentional runtime edge loaded too early. They are not counted as repeated instances of the same cause.

## Shared verification

The reviewed correction is integrated. From `packages/apexo`, `bun test --timeout 30000 test/v2/schedule-restore-store.test.ts test/v2/schedule-restore-owner.test.ts test/v2/schedule-restore-runtime.test.ts test/v2/schedule-restore-races.test.ts test/e2e/v2-session-restore.e2e.test.ts` passes18 tests/181 assertions. The refreshed repository `bun turbo typecheck --concurrency=2` passes all21 tasks. Shared source CLI passes four checks/eleven provider calls, including actual restart and future recurrence. Its first startup attempt is retained under [BUG163](../test-stability/native-terminal-backend-readiness.md); that separate delay has no established fix. Shared rebuilt Desktop acceptance also passes four checks/eleven provider calls. Production browser and actual native window each pass four checks in both eligible and permission-required branches across en/zh/zht; mini/fullscreen at80×24 each pass five ordinary checks and one permission-consent check.
