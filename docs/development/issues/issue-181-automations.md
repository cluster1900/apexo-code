# Issue #181 — Project and Thread Automations, Heartbeats, and Background Execution

**Issue:** [#181](https://github.com/cluster1900/apexo-code/issues/181)
**Priority:** P1
**Status:** Open; design specification based on the current SessionSchedule/Scheduler implementation.
**Scope:** Project-, Thread-, and Skill-targeted schedules; interval/cron/one-shot/heartbeat triggers; durable admission; notifications; and BackgroundJob integration.

## 1. Product decision

Apexo already has a useful Session-bound interval scheduler. It persists schedule intent, uses a per-owner file lease, admits a scheduled occurrence before running it, and intentionally restores future intent rather than replaying an interrupted provider turn. Issue #181 must extend that safety model to a first-class automation aggregate without allowing a scheduler to become a second model-execution engine.

The scheduler should only decide **when and what to admit**. `SessionExecution`, `BackgroundJob`, permissions, Location/worktree policy, and EventV2 remain authoritative for execution. A project automation may create a new Session or BackgroundJob; a thread automation may wake or continue a known Session; a skill automation may resolve a versioned skill and then admit a prompt. Every occurrence receives its own run/job ID and immutable configuration snapshot.

## 2. Current implementation audit

| Area | Existing code | Current behavior | Gap for #181 |
| --- | --- | --- | --- |
| Schedule schema | [`packages/schema/src/session-schedule.ts`](../../../packages/schema/src/session-schedule.ts) | `SessionSchedule.ID`, active/paused/deleted/expired status, interval, durable flag, next fire and occurrence status | Requires `sessionID`; no project/thread/skill target, cron/timezone, notification policy, or reentrancy policy |
| Schedule storage | [`packages/core/src/session/schedule-store.ts`](../../../packages/core/src/session/schedule-store.ts), [`packages/core/src/session/schedule.sql.ts`](../../../packages/core/src/session/schedule.sql.ts) | Session-owned durable record and history, migration-backed | Not a general Automation store; schema must preserve current schedule records |
| Scheduler runtime | [`packages/core/src/session/schedule.ts`](../../../packages/core/src/session/schedule.ts), [`packages/core/src/scheduler.ts`](../../../packages/core/src/scheduler.ts) | Interval timer; admission persisted before fire; future-only restore | No cron parser, missed-run policy, heartbeat checkpoint, or project-level owner |
| Scheduler lease | [`packages/core/src/scheduler-store.ts`](../../../packages/core/src/scheduler-store.ts) | Per-workspace file lock and owner claim | Useful local fencing; does not provide clustered scheduling or generic operation generations |
| Schedule HTTP API | [`packages/protocol/src/groups/schedule.ts`](../../../packages/protocol/src/groups/schedule.ts), [`packages/server/src/handlers/schedule.ts`](../../../packages/server/src/handlers/schedule.ts) | List/get/delete/pause/resume under `/api/session/:sessionID/schedule` | Needs project automation endpoints and run/history/action APIs |
| Background jobs | [`packages/core/src/background-job.ts`](../../../packages/core/src/background-job.ts) | In-memory running/completed/error/cancelled jobs with wait/report/extend/cancel | Must become a durable worker projection for automation occurrences |
| Session execution | [`packages/core/src/session/execution.ts`](../../../packages/core/src/session/execution.ts) | Process-local Session-ID coordinator and explicit wake/resume | Correct execution boundary; automation must call it rather than duplicate it |
| CLI/Desktop | [`packages/apexo/src/cli/cmd/run/runtime.ts`](../../../packages/apexo/src/cli/cmd/run/runtime.ts), [`packages/app/src/pages/session/use-session-commands.tsx`](../../../packages/app/src/pages/session/use-session-commands.tsx) | Session-oriented command and activity surfaces | No project automation list/editor, heartbeat state, or persistent notification center |

## 3. Target data model

### 3.1 Automation definition

```text
Automation
  id: aut_<descending-id>
  owner / projectID
  target: project | thread | skill
  targetID: ProjectID | SessionID | SkillID
  prompt or skill reference
  model/provider override?
  locationPolicy: current | isolated_worktree | read_only
  trigger:
    interval { seconds }
    cron { expression, timezone }
    one_shot { runAt }
    heartbeat { interval, checkpointKind }
  status: active | paused | disabled | deleted
  reentrancy: skip | queue | replace
  missedRun: skip | fire_once | catch_up_bounded
  notificationPolicy: all | meaningful_changes | failed_runs_only | none
  maxRuntime / retryPolicy
  nextRunAt / lastRunAt / lastRunID
  version / createdBy / createdAt / updatedAt
```

The definition is immutable for a started occurrence. Updating an automation increments its version and affects only future admissions. A secret or provider credential is a reference, never an embedded prompt or token.

### 3.2 Automation occurrence

```text
AutomationRun
  runID
  automationID / automationVersion
  scheduledFor / admittedAt / startedAt / finishedAt
  status: admitted | queued | running | succeeded | failed |
          cancelled | skipped | stalled | unknown
  sessionID? / backgroundJobID?
  location/worktree reference
  checkpointBefore / checkpointAfter
  changeSummary / artifact references
  notificationDecision
  attemptCount / lastError
```

An occurrence is the durable bridge between scheduling and execution. A duplicate scheduler wake must find the existing occurrence by an idempotency key such as `(automationID, scheduledFor, automationVersion)` and return it rather than create another run.

### 3.3 Heartbeat checkpoint

```text
HeartbeatCheckpoint
  automationID / targetID
  sourceRevision or sessionCursor
  normalizedDigest
  summary
  artifactDigest?
  updatedAt
```

The heartbeat compares the new observation against the last checkpoint. “No meaningful change” is a durable decision, so a restart cannot send duplicate notifications merely because in-memory state was lost.

## 4. Scheduling semantics

1. Validate target, trigger, timezone, policy, permission, and Location before writing the automation.
2. Compute and persist `nextRunAt` using a timezone-aware calendar implementation; never rely on local wall-clock arithmetic for cron.
3. The scheduler claims due definitions under an owner generation, creates an `AutomationRun`, and commits the admission before invoking `SessionExecution` or `BackgroundJob`.
4. `skip` drops a due occurrence when another run is active; `queue` records one bounded pending occurrence; `replace` requests cancellation of the older run before admitting the new one.
5. Missed runs after restart follow `missedRun`; `catch_up_bounded` has a maximum count and cannot create a burst without user policy.
6. A recurring automation computes the next fire from the persisted schedule, not from the completion time of a slow job.
7. Deleting an automation stops future intent but never deletes historical runs, artifacts, or audit records.

## 5. Heartbeat behavior

Heartbeat is a scheduled observation with a notification policy, not a silent infinite model loop.

1. Read the target's last checkpoint, current Session/event cursor, repository revision, or configured external observation.
2. Run the bounded prompt/skill in an isolated Location or read-only mode by default.
3. Normalize volatile fields (timestamps, random IDs, transient token counts) before comparing digests.
4. Persist the new checkpoint and a structured change summary in the same admission/result transaction.
5. Notify only for `meaningful_changes`, completion, failure, or required user action. A `none` policy still records the run.
6. If the target is unavailable, record `blocked`/`failed` with a next action; do not repeatedly notify every poll unless retry policy allows it.

## 6. Permission and isolation

- Automation creation requires permission to invoke the selected skill/model and access the target Project/Session.
- Each occurrence re-evaluates current Project, Location, network, credential, and tool policy; an old approval is not silently reused after a policy or origin change.
- Default repository work is a new worktree or read-only Location. Push, PR creation, destructive Browser/Computer actions, external messages, and credential use require the normal approval coordinator.
- An automation cannot use `resume: false` or a direct scheduler path to bypass durable prompt admission.
- Pause/disable/cancel operations are idempotent and record operator source (CLI, Desktop, HTTP, or API).

## 7. API and UI contract

### Protocol/Server

Add a Project-scoped group, for example:

```text
GET    /api/project/:projectID/automation
POST   /api/project/:projectID/automation
GET    /api/automation/:automationID
PATCH  /api/automation/:automationID
POST   /api/automation/:automationID/pause
POST   /api/automation/:automationID/resume
POST   /api/automation/:automationID/run-now
POST   /api/automation/:automationID/skip-next
DELETE /api/automation/:automationID
GET    /api/automation/:automationID/runs?cursor=...
POST   /api/automation/runs/:runID/cancel
```

Every mutation accepts an idempotency key and returns the automation/run ID plus the final EventV2 cursor. Public Protocol changes require `bun run generate` from `packages/client` and generated checks in CI.

### Desktop

Provide an Automation panel with:

- active/paused/blocked definitions grouped by Project;
- trigger preview in the selected timezone;
- target, skill/model, Location, permissions, notification and reentrancy policy;
- next/last run, current run state, checkpoint/change summary, logs and artifacts;
- pause, resume, run now, skip once, cancel current run, and delete future intent;
- a durable notification/review queue entry for failures or required approval.

Do not replace the composer with scheduler output. A long-running automation belongs in the activity timeline and remains inspectable after app restart.

### CLI/TUI

Add `/automation list`, `/automation show <id>`, `/automation pause`, `/automation resume`, `/automation run`, `/automation skip`, `/automation cancel`, and `/automation events`. Autocomplete must be generated from the same command schema as Desktop. Terminal output must distinguish scheduled intent, admitted run, active job, suppressed heartbeat, and failure.

## 8. Recovery and migration

1. Migrate current `SessionSchedule` rows into `Automation` records with `target=thread`, `targetID=sessionID`, `trigger=interval`, and `notificationPolicy=all`.
2. Preserve the original schedule ID as an external/legacy ID and keep the existing Session schedule endpoints as compatibility adapters.
3. On restart, load active definitions, recompute `nextRunAt`, and classify in-flight occurrences as `unknown`/`stalled`; never replay a provider turn automatically.
4. Reconcile durable `AutomationRun` records with `BackgroundJob` and Session input execution. Missing process-local workers become recoverable jobs with explicit retry/cancel actions.
5. Use workspace/project owner generations so two scheduler processes cannot admit the same occurrence.
6. Retain historical runs when an automation is deleted; redact prompt/artifact content according to the support-bundle policy.

## 9. Implementation phases

### Phase 0 — Definition and migration

1. Add Automation, AutomationRun, and HeartbeatCheckpoint schemas.
2. Add migration and legacy SessionSchedule adapter.
3. Define trigger/timezone/reentrancy/missed-run validation and stable errors.
4. Add deterministic clock and duplicate-admission fixtures.

### Phase 1 — Local scheduler

1. Replace timer-only definitions with a persistent `nextRunAt` index.
2. Implement interval, one-shot, and timezone-aware cron.
3. Add owner generation and bounded missed-run handling.
4. Admit occurrences into BackgroundJob/SessionExecution before execution.

### Phase 2 — Heartbeat and notifications

1. Implement checkpoint normalization/diff.
2. Add notification policy and durable notification decisions.
3. Route failures and approvals into the Review Queue.
4. Add CLI/Desktop list/detail/actions.

### Phase 3 — Isolation and restart recovery

1. Add worktree/read-only Location policy.
2. Recover stalled jobs and expose retry/abandon/cancel.
3. Add event cursor replay and app restart hydration.
4. Add metrics for schedule lag, queue delay, runtime, retries and suppressed notifications.

### Phase 4 — Future clustered adapter

Keep the scheduler interface independent from storage and use owner generations so a future clustered worker can replace the local file lease without changing automation semantics. Cluster scheduling is explicitly out of scope for the first release.

## 10. Test matrix

| Area | Required cases |
| --- | --- |
| Schema | Invalid timezone/cron, target deleted, policy validation, legacy schedule decode |
| Admission | Duplicate run-now, duplicate timer wake, reentrancy skip/queue/replace, idempotency key replay |
| Time | DST transition, clock jump, missed interval, expiry, long-running job, timezone conversion |
| Restart | Before admission, after admission, while running, after completion, scheduler ownership conflict |
| Heartbeat | No change silent, meaningful diff notified once, checkpoint corruption, volatile-field normalization |
| Isolation | Worktree creation/cleanup, read-only refusal, permission change, network/credential policy |
| Execution | Bash/Agent success, failure, timeout, cancel, stale owner, unknown provider attempt |
| UI/API | Project/session ownership, cursor replay, pause/resume/run-now/skip/cancel, Desktop restart, CLI autocomplete |
| Security | Prompt/credential/artifact redaction, no policy bypass, notification content filtering |

## 11. Definition of done

- Existing Session-bound schedules remain compatible while Project/Thread/Skill automations are available.
- Every occurrence has a durable ID, immutable configuration snapshot, status, result, and audit trail.
- Restart cannot duplicate or silently lose a due occurrence.
- Heartbeats remain quiet when state is unchanged and explain meaningful changes with evidence.
- Worktree, permission, approval, cancellation, and artifact policies are inherited from Apexo services.
- CLI, Desktop, HTTP, and EventV2 expose the same automation state and idempotent controls.
- Tests cover normal, failure, cancellation, timeout, restart, clock, concurrency, and permission paths.

## 12. Dependencies

- **#177:** durable BackgroundJob, event cursor, recovery state, and owner fencing are prerequisites.
- **#179:** Control Center and Review Queue provide the durable place to manage runs and approvals.
- **#180:** Git shipping can consume automation-produced diffs, but automation must not bypass Git permission gates.
- **#182:** forked Sessions may be valid Thread targets; lineage must be persisted before automation can target a branch.
- **#189:** scheduler lag, run latency, retries, and notification suppression should feed the observability model.
