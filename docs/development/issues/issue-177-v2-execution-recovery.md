# Issue #177 — V2 Persistent Execution Recovery, Event Cursors, Background Jobs, and Owner Fencing

**Issue:** [#177](https://github.com/cluster1900/apexo-code/issues/177)
**Priority:** P0
**Status:** Closed as completed on GitHub; this document is the post-implementation gap analysis and follow-up specification.
**Scope:** V2 Session execution, provider-attempt recovery, durable event replay, BackgroundJob, and stale-owner fencing.
**Reviewed revision:** `1824c8e83d749c0c9014dacaa263a02a5d210b46`

## 1. Executive decision

Issue #177 established important primitives, but the product contract is broader than the current implementation. The next implementation must keep durable prompt admission separate from model execution, keep one process-local `SessionExecution` coordinator per Session ID, and make every recovery decision explicit. The system must never infer that a provider request is safe to repeat merely because the process disappeared.

The current branch is strongest in three areas:

- admitted V2 inputs and their execution settlement are durable;
- durable EventV2 rows have per-aggregate sequence numbers and replay helpers;
- local Session lifecycle claims, task ownership records, and schedule files reject several stale-incarnation writes.

The remaining gaps are material:

- provider dispatch boundaries are not represented by a first-class durable `Attempt` record;
- the public event SSE endpoint is live-only and does not accept a replay cursor;
- generic `BackgroundJob` state is explicitly process-local, so a restart loses live execution state;
- fencing is currently split between lifecycle claims, input-owner stamps, task-incarnation checks, and scheduler file locks rather than one execution-generation contract;
- recovery is explicit for selected input and schedule paths, but there is no server-wide scan and operator workflow for unknown provider attempts.

## 2. Existing implementation map

| Concern | Current source | Current behavior | Assessment |
| --- | --- | --- | --- |
| Prompt admission | [`packages/core/src/session/input-admission.ts`](../../../packages/core/src/session/input-admission.ts), [`packages/core/src/session/input-execution.ts`](../../../packages/core/src/session/input-execution.ts) | Persists an input before an advisory wake; records admitted/promoted/started/ended sequence evidence and settlement reason | Implemented for input-level execution |
| Local Session execution | [`packages/core/src/session/execution.ts`](../../../packages/core/src/session/execution.ts), [`packages/core/src/session/execution/local.ts`](../../../packages/core/src/session/execution/local.ts), [`packages/core/src/session/run-coordinator.ts`](../../../packages/core/src/session/run-coordinator.ts) | Process-global, Session-ID based coordinator; same Session joins/coalesces, different Sessions may run concurrently | Implemented for local ownership |
| Input owner fencing | [`packages/core/src/session/input-execution-owner.ts`](../../../packages/core/src/session/input-execution-owner.ts), [`packages/core/src/session/lifecycle.ts`](../../../packages/core/src/session/lifecycle.ts) | Captures process PID/token and invalidates local capability when the Session incarnation changes | Partial; not a provider-attempt lease |
| Durable event sequence | [`packages/core/src/event.ts`](../../../packages/core/src/event.ts), [`packages/core/src/event/sql.ts`](../../../packages/core/src/event/sql.ts), [`packages/schema/src/event.ts`](../../../packages/schema/src/event.ts) | Writes ordered durable events per aggregate and can read an aggregate after a numeric sequence | Implemented as a core primitive |
| Event HTTP stream | [`packages/protocol/src/groups/event.ts`](../../../packages/protocol/src/groups/event.ts), [`packages/server/src/handlers/event.ts`](../../../packages/server/src/handlers/event.ts) | Sends a live SSE stream with a connected marker and bounded subscriber queue | Missing durable cursor handshake/replay |
| Input execution API | [`packages/protocol/src/groups/session.ts`](../../../packages/protocol/src/groups/session.ts), [`packages/server/src/handlers/session.ts`](../../../packages/server/src/handlers/session.ts) | Exposes execution status, wait, interrupt and prompt admission; maps lifecycle conflicts | Implemented for headless input |
| Generic BackgroundJob | [`packages/core/src/background-job.ts`](../../../packages/core/src/background-job.ts) | Typed lifecycle, output tail, wait, promote, extend and cancel backed by an in-memory map | Explicitly process-local; not durable |
| Scheduler | [`packages/core/src/scheduler.ts`](../../../packages/core/src/scheduler.ts), [`packages/core/src/scheduler-store.ts`](../../../packages/core/src/scheduler-store.ts) | Durable interval schedule files, per-owner flock, admission-before-fire, future-only restore | Useful schedule-specific recovery, not a general job store |
| Child task ownership | [`packages/core/src/session/task-store.ts`](../../../packages/core/src/session/task-store.ts), [`packages/core/src/session/task.sql.ts`](../../../packages/core/src/session/task.sql.ts) | Durable parent/child records, incarnation checks and bounded delegation depth | Implemented for managed tasks |
| CLI/Desktop views | [`packages/apexo/src/cli/cmd/run/session-replay.ts`](../../../packages/apexo/src/cli/cmd/run/session-replay.ts), [`packages/app/src/context/global-sync/event-reducer.ts`](../../../packages/app/src/context/global-sync/event-reducer.ts) | Consume event streams and session projections; recovery states are not shown consistently | Partial |

## 3. Current end-to-end behavior

### 3.1 Normal prompt execution

1. `SessionV2.prompt(...)` admits one `session_input` row and commits the durable admission evidence.
2. Unless `resume: false` is requested, the caller schedules `SessionExecution.wake(sessionID)`.
3. The local execution service captures a Session lifecycle claim and joins the process-local `SessionRunCoordinator`.
4. The runner promotes eligible inputs at a safe provider-turn boundary and reloads projected history from storage.
5. Provider/tool/message events are published through EventV2 and projections update the durable transcript.
6. `SessionInputExecution` settles the canonical input as completed, failed, interrupted, or superseded.
7. A client can read the input execution receipt and listen for live events.

### 3.2 Crash before or during a provider request

The input row remains durable, but the current input-level evidence cannot prove whether an external provider request was accepted. The owner stamp can classify a local process owner as dead in some cases, but it does not identify a provider request ID or an exact dispatch boundary. The correct result is therefore `recoverable`/`unknown`, followed by an explicit retry or abandon decision. Automatic replay must be restricted to requests that the provider contract declares idempotent.

### 3.3 Event reconnect

`EventV2.readAggregate` can read durable rows after a numeric sequence for a known aggregate. The public `/api/event` SSE route currently installs a live bounded subscriber and emits a `server.connected` marker; it does not accept `after`, return `earliest/head`, or replay the gap before installing the live stream. A reconnecting Desktop must therefore use domain-specific routes or refetch projections rather than treating the global SSE stream as a lossless cursor channel.

### 3.4 Background and scheduled work

`BackgroundJob` starts an Effect in a scoped in-memory registry. It can extend a job with ordered tails and can cancel the local scope. `SchedulerStore` persists interval intent to per-workspace JSON files and uses flock leases, then admits a fire before running it. A process restart can restore future schedules, but it cannot restore a generic Bash process, an in-flight provider attempt, or the output tail of a non-scheduler job.

## 4. Target contract

### 4.1 Durable execution state

Persist these separate concepts:

```text
SessionExecution
  sessionID
  state: admitted | promoting | running | awaiting_tool | idle |
         recoverable | failed | abandoned
  generation
  activeInputID?
  ownerID?
  ownerGeneration?
  lastEventSeq
  updatedAt

ProviderAttempt
  attemptID
  sessionID
  inputBatchID
  providerID / modelID
  requestHash
  idempotencyKey
  dispatchState: prepared | dispatched | acknowledged | unknown | settled
  outcome: success | failure | unknown | cancelled
  providerRequestID?
  retryCount / nextRetryAt?
  createdAt / dispatchStartedAt? / dispatchFinishedAt?
  lastErrorCode?

BackgroundJob
  jobID
  parentSessionID?
  childSessionID?
  kind: bash | agent | scheduler
  status: queued | running | succeeded | failed | cancelled | stalled | unknown
  ownerID / ownerGeneration
  location / command or child admission reference
  outputSegments / artifact references
  cancelRequestedAt?
  retryPolicy / attemptCount
```

`SessionExecution` is the durable projection of a Session's ability to continue. `ProviderAttempt` is the evidence boundary for an external request. `BackgroundJob` is the durable lifecycle of work that may outlive a UI or process. They must not be collapsed into one `Session` row or one in-memory `BackgroundJob.Info` object.

### 4.2 State transitions

```text
admitted -> promoting -> running -> awaiting_tool -> running
running -> idle
running -> recoverable        (dispatch/result boundary unknown)
running -> failed             (known non-retryable or exhausted)
recoverable -> running        (explicit safe retry only)
recoverable -> abandoned      (explicit user decision)
any nonterminal -> cancelled  (idempotent cancellation)
```

Every transition must include the Session ID, owner generation, operation ID, durable event sequence, timestamp, and reason. An old generation cannot append a transition or settle an attempt. Invalid transitions return a stable conflict error rather than being silently ignored.

### 4.3 Cursor contract

For each aggregate, expose:

```text
GET /api/session/:sessionID/events?after=<seq>&limit=<n>
200 {
  events: [...],
  cursor: { earliest: <seq>, head: <seq>, next?: <opaque-token> }
}
```

The server must install the live subscription and capture the head under one ordering boundary, replay events after `after`, then drain live events newer than the captured head. If `after` is older than retention, return `cursor_expired` with `earliest` instead of silently truncating. SSE/ACP clients use the same cursor semantics; Client SDK types are regenerated from Protocol changes.

### 4.4 Owner fencing

Use an explicit `ownerID` plus monotonically increasing `generation` for each durable execution aggregate. Acquisition is conditional on the stored generation. Every write includes both values. On loss of the lease, the old process:

1. stops provider/tool work through the local cancellation chain;
2. rejects late settlement with `owner_fenced`;
3. emits a durable owner-fenced event if it still has a valid write;
4. leaves admitted inputs and unprocessed job records intact;
5. lets the recovery scanner classify them as retryable, unknown, or abandoned.

PID/token stamps remain useful local evidence, but are not a substitute for the durable generation.

## 5. API and package changes

### Schema

- Add branded `ExecutionID`, `AttemptID`, `BackgroundJobID`, `OperationID`, and an opaque cursor format.
- Add schemas for execution state, attempt state, job state, owner lease, recovery outcome, and cursor page.
- Keep `SessionInput.Execution` as input evidence; add references to the execution/attempt IDs rather than changing its meaning.

### Protocol and Server

- Add Session execution status/recover/abandon endpoints.
- Add attempt status, retry, and abandon endpoints with idempotency keys.
- Add BackgroundJob list/get/wait/cancel/events endpoints scoped by Session/Location.
- Add cursor-based replay endpoints and cursor-aware SSE/ACP handshake.
- Classify errors: `owner_fenced`, `cursor_expired`, `attempt_unknown`, `retry_exhausted`, `job_not_cancellable`, `operation_conflict`.
- Server derives destructive/recovery authority from the authenticated Session/Project policy; it does not trust caller-supplied safety flags.

### Core

- Introduce a durable execution store and recovery scanner.
- Keep `SessionExecutionLocal` as the local runner adapter; it should claim the durable generation before draining.
- Adapt `BackgroundJob` to a durable record plus a process-local worker handle. A restart rehydrates records, not old Effect fibers.
- Add bounded output segment storage and artifact references instead of unbounded in-memory tails.

### Client, CLI, and Desktop

- Run `bun run generate` in `packages/client` after public Protocol/Server changes; never edit generated files.
- Expose a persistent execution activity surface with `recoverable`, `unknown`, `owner_fenced`, `reconnecting`, and `cancelled` states.
- CLI commands should include status, retry, abandon, cancel, and cursor-aware event replay.
- Desktop should reconnect using the last acknowledged cursor, deduplicate by durable event ID, and show a recovery decision rather than auto-submitting a duplicate prompt.

## 6. Compatibility and migration

1. Add nullable columns/tables and read old rows as `legacy`/`unknown`; do not reinterpret historical input sequence fields.
2. Backfill execution projections from existing `session_input` and durable EventV2 rows where the boundary is provable.
3. Mark provider attempts without dispatch evidence as `unknown`, never `success`.
4. Keep the current event SSE route for old clients, but add cursor endpoints and advertise capability via server metadata.
5. Keep process-local `BackgroundJob` as a compatibility adapter while all new jobs write durable records. Old jobs disappear on restart with an explicit `unknown` result.
6. Version persisted job and scheduler records. Use atomic temp-file/database transactions and preserve the existing scheduler file lease behavior.

## 7. Implementation sequence

### Phase 0 — Contract and failure fixtures

1. Add schemas and transition tables.
2. Add deterministic crash injection at prepared, dispatched, acknowledged, and settled boundaries.
3. Add cursor gap/replay fixtures and duplicate-request fixtures.
4. Add owner generation conflict fixtures.

### Phase 1 — Attempt and execution durability

1. Persist `SessionExecution` projection and `ProviderAttempt` before the provider call.
2. Record dispatch start/finish and provider request ID when available.
3. Reconcile settlement only under the owning generation.
4. Add recovery scanner and explicit retry/abandon commands.

### Phase 2 — Cursor replay

1. Add aggregate event page endpoint with earliest/head/next cursor.
2. Implement replay-then-live SSE ordering.
3. Add reconnect/deduplication to Client, CLI, Desktop, and ACP.
4. Add retention and `cursor_expired` behavior.

### Phase 3 — Durable BackgroundJob

1. Persist job admission and owner generation.
2. Add Bash adapter with process ID, output segments, timeout, cancellation, and exit classification.
3. Add Agent adapter that references child Session admission and continuation policy.
4. Rehydrate nonterminal jobs as `stalled`/`unknown` after restart and expose recovery actions.

### Phase 4 — fencing and operational UX

1. Replace implicit process-local writes with conditional generation checks.
2. Add owner-fenced events and metrics.
3. Add CLI/Desktop recovery queue and audit timeline.
4. Document retention, redaction, and support-bundle behavior.

## 8. Test matrix

| Area | Required cases |
| --- | --- |
| State machine | Every legal transition, illegal transition, duplicate retry/cancel/abandon, terminal idempotency |
| Provider attempts | Crash before dispatch, after dispatch, after provider acknowledgment, before result persistence, unknown provider request ID |
| Fencing | Two owners, stale generation write, lease loss during tool call, late provider result, owner restart |
| Cursor | Empty stream, first page, exact boundary, concurrent publish, reconnect gap, expired cursor, duplicate replay, out-of-order rejection |
| Background jobs | Bash success/failure/timeout/cancel, output truncation, restart, unknown process, Agent child completion, parent Session cancellation |
| Scheduler | Admission before fire, restart, missed interval, duplicate wake, expired schedule, owner claim conflict |
| API | HTTP/SSE/ACP parity, generated SDK, permission denial, Session ownership, idempotency key reuse |
| UI | CLI/Desktop reconnect, visible recovery state, no duplicate message, retry/abandon/cancel confirmation, composer remains usable |
| Repository gates | Package-local `bun typecheck`, package tests, `packages/client`/`packages/sdk/js` generated checks, `packages/apexo` `bun run test:httpapi` |

## 9. Definition of done

- A crash at each provider boundary produces either a proven terminal result or an explicit recoverable/unknown state.
- Two concurrent owners cannot produce duplicate visible promotion or provider turns.
- Cursor reconnect returns every durable event once, in sequence order, or explicitly reports retention expiry.
- Background Bash and Agent jobs have durable status, bounded logs, cancellation, restart classification, and audit events.
- Old owner writes are rejected with a typed error and observable event.
- CLI, Desktop, HTTP, SSE, ACP, and generated SDK expose the same recovery vocabulary.
- Existing Session, TUI, Web, Desktop, and SDK behavior remains compatible through migration.

## 10. Dependencies and follow-up

- **#177 is foundational** for #179 Control Center, #181 Automations, #182 Session tree/fork, #184 Remote/IDE sync, #185 Artifact workspace, and #189 Observability.
- Browser/Computer Use must consume the same event, approval, cancellation, and artifact semantics; it must not create a second execution state machine.
- The current branch has enough local primitives to start the next phase, but the missing attempt store, cursor handshake, and durable job store must be tracked as separate implementation PRs.
