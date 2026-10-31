# Issue 179 — Desktop Control Center: Multi-Agent Runs, Workspaces, and Review Queue

## Status and engineering finding

Issue 179 is a product projection and workflow gap. Apexo already has Sessions, Projects, Tasks, workflows, event replay, worktree helpers, review surfaces, and Desktop routing. It does not yet expose one durable Project-level projection that can answer which runs are active, which run owns a worktree, what is waiting for approval, and what requires review after an application restart.

Current evidence is split across [`packages/app/src/context/server-session.ts`](../../../packages/app/src/context/server-session.ts), session cache/reducer code, [`packages/app/src/utils/worktree.ts`](../../../packages/app/src/utils/worktree.ts), Session V2 event APIs, and Desktop renderer bootstrap. These are reusable sources; the Control Center must not introduce a second execution engine.

| Area | Current state | Target |
| --- | --- | --- |
| Session execution | Implemented in Core/V2 and surfaced by App | Project-level run projection with durable status |
| Worktrees | Helpers and project/workspace state exist | Explicit run-to-worktree ownership and lifecycle |
| Event replay | V2 cursor/replay exists for domain streams | One projection cursor per Project and queue |
| Review/approval | Existing session and permission surfaces | Unified idempotent Review Queue |
| Restart | Session data can be reloaded | Active/waiting/failed summaries reconstructed from server |

## Scope

### Goals

- Add a server-owned `AgentRunSummary` projection grouped by Project.
- Show Local and Worktree execution modes first; keep Remote/Cloud as capability-gated contracts.
- Provide overview, run detail, event timeline, artifacts, terminal, diff, approval, and review views.
- Make queue mutations idempotent and traceable to a source run and operation ID.
- Preserve V2 Session, Location, Permission, event cursor, and ownership semantics.

### Non-goals

- Do not put model orchestration in the Desktop renderer.
- Do not silently migrate an executing Session between worktrees or hosts.
- Do not enable Remote/Cloud execution without an explicit backend capability handshake.
- Do not replace authoritative event history with local UI state.

## Proposed domain model

```text
AgentRunSummary
  runID / sessionID / projectID
  parentRunID? / childRunIDs[] / backgroundJobIDs[]
  mode: local | worktree | remote
  locationID / workspacePath / branch / baseRevision
  status: queued | running | waiting_input | waiting_approval |
          waiting_tool | recovering | succeeded | failed | cancelled | stale
  phase / lastEventID / projectionCursor
  provider / model / usageSummary?
  unreadCount / approvalCount / reviewCount / artifactCount
  createdAt / updatedAt / completedAt?

ReviewQueueItem
  queueItemID / sourceRunID / sourceEventID
  kind: approval | failed_check | review_comment | recovery | diff_ready
  severity / requiredAction / status
  idempotencyKey / createdAt / resolvedAt?
```

The projection is derived from durable events. A Desktop reload must be able to rebuild it from a cursor, and a duplicate event must not create a duplicate queue item.

## State transitions

```text
queued -> running -> waiting_tool -> running
running -> waiting_input | waiting_approval | recovering
waiting_approval -> running | cancelled
recovering -> running | stale | failed
running -> succeeded | failed | cancelled
```

A projection may only move forward using event sequence and generation checks. `stale` means the process or owner is no longer authoritative; it must not be rendered as `running`.

## API and package boundaries

Add public Protocol/Server contracts for:

- `project.runs.list` with filters and `afterCursor`.
- `run.get` returning summary plus latest projection cursor.
- `run.events` replay/subscribe.
- `reviewQueue.list` and `reviewQueue.resolve`/`reviewQueue.retry`/`reviewQueue.cancel`.
- `run.resume`, `run.fork`, `run.cancel`, and `run.open`.

Schema belongs in `packages/schema`; endpoint groups in `packages/protocol`; handlers and projection writes in `packages/server`/Core; generated readers are regenerated from `packages/client`. Desktop uses the public Client only. Follow the dependency direction in `docs/development/README.md` and never import Core/Server runtime from App.

Every mutation returns `operationID`, the resulting event ID, and projection cursor. Queue actions require an idempotency key and source generation.

## Persistence and recovery

1. Persist run summary fields and queue items in the existing Core database rather than renderer storage.
2. Store `lastEventID`/cursor and projection version.
3. On startup, replay from the stored cursor; if history is compacted, rebuild from the earliest available checkpoint.
4. Mark a run `recovering` while ownership is unknown; transition to `running` only after the owner/attempt lease is confirmed.
5. Keep unread counts in durable projection state and acknowledge them with a separate idempotent operation.
6. Reconcile worktree path, branch, and HEAD against the filesystem before showing them as current.

## Security and concurrency

- Project and Session ownership must be checked server-side for every read and mutation.
- Approval items carry the target action and scope; resolving one item must not approve another origin, worktree, or operation.
- Cancel/retry/fork operations use owner fencing and compare-and-set generation.
- Never expose provider credentials, prompt secrets, or raw tokens in summaries or notifications.
- Bulk UI actions are allowed for read/open/acknowledge only; destructive actions remain per-run confirmation.

## UI and CLI behavior

Desktop should provide a Project Control Center with filters for status, branch, mode, approval, review, and unread events. A detail route shows transcript, terminal, diff, artifacts, approvals, checks, and child runs as tabs. The UI subscribes to events and uses cursors; a toast is insufficient for a long-running or blocked run.

CLI/TUI can expose `/runs`, `/run status`, `/queue`, `/run cancel`, and `/run resume` as adapters over the same API. Both surfaces must show `waiting_approval`, `recovering`, and `stale` explicitly and keep the composer usable while unrelated runs execute.

## Implementation sequence

1. Define schemas, status transitions, projection version, cursor and error codes.
2. Implement Core projection writer and server-owned Project/run queries.
3. Add replay/subscribe endpoints and generated Client methods.
4. Implement queue persistence, idempotent resolution, and owner fencing.
5. Add Desktop overview/detail/queue routes and restart hydration.
6. Add CLI/TUI summaries and mutation commands.
7. Add Local/Worktree capability checks; leave Remote/Cloud unavailable with a visible reason.
8. Add migration/backfill from existing Sessions and event history.

## Test matrix and acceptance

- Five or more concurrent Sessions in one Project remain correctly separated.
- Cursor replay reconstructs summaries after Desktop restart and after duplicate delivery.
- Queue approval, cancel, retry, and acknowledge are idempotent.
- Worktree branch/path/dirty state matches actual Git state and detects drift.
- Permission denial, owner fencing, process crash, reconnect, and stale run states are visible and recoverable.
- Desktop Playwright tests cover overview, filters, detail tabs, queue actions, restart hydration, and composer usability.
- Terminal tests cover run/queue commands and cursor continuation through a real PTY.

## Dependencies and risks

Depends on #177 event cursors, BackgroundJob and owner fencing; feeds #180 Git shipping and #181 Automations. The largest risk is projecting a transient process status as durable truth. Keep the server projection conservative: unknown ownership must be `recovering` or `stale`, never a guessed `running`.
