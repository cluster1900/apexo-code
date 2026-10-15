# BUG-20261015-250: Schedule Resume returned an empty 500 after permission refusal

- Status: corrected; real pure/mixed HTTP regression and refreshed types passed.
- Scope: native Scheduler management Resume and task permission refusal.
- Independent occurrences: one product episode, reproduced on both HTTP hosts.

## Observed and expected behavior

The Desktop permission flow exposed an empty HTTP 500 when the user rejected a task permission requested by Schedule Resume. The saved schedule remained paused. The API should return the declared typed denial response, preserve paused intent, and permit a later independently approved Resume without provider work.

## Reproduction and cause

Run `bun test test/e2e/v2-schedule-permission.e2e.test.ts` from `packages/apexo`. Create a real schedule through a native model/tool turn with task permission set to ask, approve its creation once, pause it, and reject the next Resume permission. Before the correction, both real HTTP hosts failed at expected 400 versus actual 500: zero passes, two failures, 26 assertions.

`PermissionV2.assert` intentionally raises a declined permission as a defect to stop a model turn. Schedule Resume mapped typed permission errors but allowed that specific defect to escape the management boundary. The generic HTTP defect handler consequently returned 500. This is independent of the Desktop component-owner cancellation issue.

## Fix

At the schedule management permission boundary, convert only `PermissionV2.DeclinedError` into the existing typed schedule denial. Preserve all unrelated defects and interruption behavior. The declared `InvalidRequestError` response remains 400; no public API shape changes. The mutation still occurs only after permission succeeds.

## Verification

The regression covers refusal followed by one-time approval, exact schedule state after each response, cleared permission requests, and unchanged provider-call count. After correction, `bun test test/e2e/v2-schedule-permission.e2e.test.ts test/v2/schedule-store.test.ts test/v2/schedule-execution.test.ts test/v2/schedule-late-authority.test.ts test/v2/schedule-tools.test.ts test/v2/headless-scheduler.test.ts` passed 18 tests / 345 assertions. Refreshed workspace typechecking passed all 21 tasks, and the shared Desktop build passed. No recurring constraint is warranted by one root-cause episode.
