# BUG-20261028-401: V2 durable execution recovery and background job takeover fencing

- **Scope:** `SessionExecutionStore`, `SessionExecutionLocal`, `SessionRunner`, `BackgroundJob`, `plugins.reload`, `TaskTool`, and `wait_tasks`.
- **Observed:**
  1. `SessionExecutionLocal.drain` claimed a new `SessionExecutionStore` generation before checking whether an advisory wake had eligible work, allowing no-op coalesced wakes or post-promotion startup recovery wakes to overwrite prior receipts with `"completed"`.
  2. When a session crashed after promoting its input (`promoted_seq IS NOT NULL`) or belonged to a managed child, startup recovery either left `session_execution.status` as `"running"` indefinitely or overwrote it with `"completed"`.
  3. A fenced `SessionRunner` owner failing with `SessionExecutionStore.Failure` still ran `settleInput` and `goalCleanup.terminal` in `Effect.onExit`/`Effect.ensuring`, risking mutation of the replacement owner's state.
  4. In `BackgroundJob.makeDurable`, a superseded owner instance continued returning its stale in-memory entry from `get`/`list` and mutating its local entry in `report`/`extend`/`promote`/`cancel`; `settle` and `cancel` resolved `done` before `onSettled` finished persisting to SQLite; `makeOwnedFor.resume` did not bind resumed jobs to `SessionLifecycle` claims; and `plugins.reload`, `TaskTool`, and `wait_tasks` did not account for `blockedReason === "process_restart"`.
- **Expected:**
  1. `SessionExecutionLocal` claims a `SessionExecutionStore` lease lazily when `SessionRunner` begins actual execution and asserts ownership before mutating durable state or starting `llm.stream`.
  2. Startup recovery wakes ordinary sessions with pending unpromoted inputs via `prepare(sessionID)` and marks stale `"running"` rows from prior owners without pending unpromoted inputs (or managed children) as `"interrupted"` via `interruptStale`.
  3. Stale `SessionRunner` owners exiting with `SessionExecutionStore.Failure` skip `settleInput` and `goalCleanup.terminal`.
  4. `BackgroundJob.makeDurable` fences stale owners across `get`, `list`, `report`, `extend`, `promote`, `cancel`, and `resume`, awaits `onSettled` before resolving `done`, binds `makeOwnedFor.resume` to `SessionLifecycle`, and handles `blockedReason === "process_restart"` in `plugins.reload`, `TaskTool`, and `wait_tasks`.
- **Root cause:** Initial durable execution store and background job takeover wiring claimed session leases eagerly outside the runner work check, lacked stale-row interruption for post-promotion crashes, did not filter `SessionExecutionStore.Failure` in runner exit cleanup, and did not compare in-memory job generations against the database owner generation after takeover.
- **Fix:**
  - Updated `packages/core/src/session/execution-store.ts` to use atomic `update(...).returning().get()` in `assert`, `.onConflictDoUpdate` in `claim`, and added `interruptStale`.
  - Updated `packages/core/src/session/execution/local.ts` to claim lazily on first `SessionExecutionStore.Current` assertion and reconcile stale `"running"` rows on startup.
  - Updated `packages/core/src/session/runner/llm.ts` to assert `SessionExecutionStore.Current` before durable side effects and `llm.stream`, and skip `settleInput` and `goalCleanup.terminal` on `SessionExecutionStore.Failure`.
  - Updated `packages/core/src/background-job.ts`, `packages/apexo/src/server/routes/instance/httpapi/handlers/plugins.ts`, `packages/apexo/src/tool/task.ts`, and `packages/apexo/src/tool/grok-build.ts` to fence stale owners, persist before resolving `done`, attach `SessionLifecycle` on `resume`, and handle `blockedReason === "process_restart"`.
- **Reproduction:** Run `bun test test/session/execution-store.test.ts test/background/durable-job.test.ts` from `packages/apexo`.
- **Verification:** `bun test test/session/execution-store.test.ts test/background/durable-job.test.ts test/background/job.test.ts test/tool/task.test.ts` in `packages/apexo` and `bun turbo typecheck --concurrency=2` from the repository root.
- **Status:** Verified in branch `v2-recovery`.
