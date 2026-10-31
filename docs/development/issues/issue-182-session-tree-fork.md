# Issue #182 — Persistent Session Tree, Fork, Resume, and Comparable History

**Issue:** [#182](https://github.com/cluster1900/apexo-code/issues/182)
**Priority:** P1
**Status:** Open; design specification based on the current V1 fork, V2 projected history, and managed-child resume implementation.
**Scope:** Durable Session lineage, checkpoint-based fork, branch navigation, resume/retry semantics, and cross-client comparison.

## 1. Product decision

Apexo must treat a conversation branch as a new durable Session with an explicit lineage record and a checkpoint reference. A fork is not a second in-memory view of the same Session and must not duplicate a still-uncertain provider attempt. The source and child have independent inboxes, execution ownership, permissions, events, and future prompts; immutable historical context may be shared by reference or copied lazily.

The implementation must preserve the existing V2 rules:

- reusing a Session ID adopts the existing Session;
- reusing a prompt message ID is an exact retry only when Session, delivery mode, and prompt match;
- projected history is reloaded from durable storage before continuation;
- Session execution remains process-local and Session-ID based;
- managed child Sessions remain controlled by their Task/Workflow/Goal owner.

## 2. Current implementation audit

| Area | Existing code | Current behavior | Gap for #182 |
| --- | --- | --- | --- |
| V1 Session fork | [`packages/apexo/src/session/session.ts`](../../../packages/apexo/src/session/session.ts) | `Session.fork` creates a new ID and clones V1 messages/parts up to an optional message ID; title gets `(fork #n)` | Copies mutable message rows; no durable event-cursor checkpoint or shared immutable history |
| Session identity | [`packages/schema/src/session.ts`](../../../packages/schema/src/session.ts), [`packages/core/src/session/sql.ts`](../../../packages/core/src/session/sql.ts) | V2 `Info` has optional `parentID`, Location, title, model and timestamps | `parentID` is a broad parent relation, not a fork lineage/checkpoint contract |
| V2 prompt/history | [`packages/apexo/src/session/prompt.ts`](../../../packages/apexo/src/session/prompt.ts), [`packages/core/src/session/input.ts`](../../../packages/core/src/session/input.ts), [`packages/core/src/session/message.ts`](../../../packages/core/src/session/message.ts) | Durable inbox admission and projected history are Session-owned | No general public fork/checkpoint operation |
| Event sequence | [`packages/core/src/event.ts`](../../../packages/core/src/event.ts), [`packages/schema/src/event.ts`](../../../packages/schema/src/event.ts) | Durable events have aggregate sequence and can be replayed internally | No lineage checkpoint table or branch comparison API |
| Managed children | [`packages/core/src/session/task-store.ts`](../../../packages/core/src/session/task-store.ts), [`packages/core/src/session/child-resume.ts`](../../../packages/core/src/session/child-resume.ts) | Task resume can copy selected history into an owned child after validating placement and authority | It is an owner-controlled task path, not user-visible arbitrary Session fork |
| Compatibility/API | [`packages/protocol/src/groups/session.ts`](../../../packages/protocol/src/groups/session.ts), [`packages/server/src/handlers/session.ts`](../../../packages/server/src/handlers/session.ts) | Session list/get/messages and prompt/input operations exist | No tree, lineage, checkpoint, fork, compare, or active-branch endpoints |
| TUI/Desktop | [`packages/apexo/src/cli/cmd/run/session-replay.ts`](../../../packages/apexo/src/cli/cmd/run/session-replay.ts), [`packages/app/src/pages/session/session-lineage.ts`](../../../packages/app/src/pages/session/session-lineage.ts) | Some child/lineage display and compatibility fork affordances exist; native V2 fork is not complete | No durable branch tree and no consistent cross-client controls |

## 3. Lineage model

### 3.1 SessionLineage

```text
SessionLineage
  lineageID
  sourceSessionID
  childSessionID
  kind: root | fork | task_child | workflow_child | goal_child
  sourceCheckpointID
  sourceMessageID?
  sourceEventCursor?
  sourceAttemptID?
  inheritedHistoryDigest
  copyMode: reference | copy_on_write | materialized
  createdBy: user | model | task | automation | api
  createdAt
  title
```

The child Session's existing `parentID` remains useful for broad hierarchy and ownership, but `SessionLineage` is authoritative for a fork's source and checkpoint. A source Session can have many children; a child has exactly one immutable lineage edge for its creation event.

### 3.2 Checkpoint

```text
SessionCheckpoint
  checkpointID
  sessionID
  eventCursor
  projectedMessageBoundary
  inputID?
  attemptID?
  historyDigest
  status: stable | recoverable | unknown | invalidated
  createdAt
```

A checkpoint is valid only at a stable provider-turn boundary or an explicitly recoverable boundary. A checkpoint inside an unknown attempt cannot be used for a silent fork. The API must return a typed `checkpoint_not_forkable` reason and offer retry/abandon before allowing the operation.

### 3.3 Branch summary

```text
BranchSummary
  sessionID / lineageID
  title / depth
  sourceSessionID / sourceCheckpointID?
  lastEventCursor / lastActivityAt
  executionStatus
  unreadCount
  model/agent
  artifactCount / diffSummary
```

Summaries are server-side projections. Desktop refresh must not infer tree state from currently mounted tabs or in-memory child arrays.

## 4. Fork semantics

1. Client requests `fork(sourceSessionID, checkpointID, title?, locationPolicy?, model?)` with an idempotency key.
2. Server reads the source checkpoint, validates Session ownership, permission, Location policy, lineage depth/limits, and attempt stability.
3. In one transaction, create the child Session, lineage row, initial projection reference/materialization metadata, and a durable `session.forked` event.
4. Child starts with an empty durable inbox and no active provider execution. Source future inputs do not enter the child; child inputs do not enter the source.
5. Child history is reconstructed from the checkpoint using immutable references or copy-on-write rows. A materialized fallback is allowed for legacy V1 messages.
6. The child is available for `SessionV2.prompt` and independent `SessionExecution.wake` only after the creation event commits.
7. Repeating the same idempotency key returns the original child. The same source/checkpoint with a different key may intentionally create another branch and receives a different lineage ID.

Fork does not copy every artifact/blob. Artifact references remain immutable and are copied by reference with access checks. Mutable worktree state is handled by an explicit Location/worktree policy, not by copying the conversation alone.

## 5. Resume, retry, and recovery

- **Resume:** continues durable inbox/continuation for one existing Session. It does not create a branch and does not re-run a provider attempt whose outcome is unknown.
- **Retry:** repeats an exact admitted prompt only when Session, prompt ID, delivery mode, and provider-attempt policy match. It creates a new operation/attempt record.
- **Fork:** creates a child Session from a stable checkpoint. Its new prompt and execution are independent.
- **Recover:** classifies an unknown attempt as retryable, abandoned, or requiring user review. It never guesses success from a missing process.

When a checkpoint includes an `awaiting_tool` or provider-unknown boundary, the API must expose the dependency and block fork until the user or recovery policy settles it. A fork may preserve the historical message up to the last stable event but must mark the boundary in the lineage metadata.

## 6. API and package changes

### Schema

- Add branded `LineageID`, `CheckpointID`, and branch/tree summary schemas.
- Add `SessionLineage`, `SessionCheckpoint`, `ForkRequest`, `ForkResult`, `CompareRequest`, and stable errors.
- Add event definitions for `session.created`, `session.forked`, `checkpoint.created`, `branch.archived`, and `branch.active_changed` as appropriate.

### Protocol/Server

```text
GET  /api/session/:sessionID/tree
GET  /api/session/:sessionID/checkpoints
POST /api/session/:sessionID/fork
GET  /api/session/:sessionID/lineage
POST /api/session/:sessionID/checkpoints/:checkpointID/resume
GET  /api/session/compare?left=<id>&right=<id>&cursor=...
POST /api/session/:sessionID/active-branch
```

All endpoints enforce Session/Project ownership and Location permissions. Mutations return operation ID, child/lineage ID, and the final event cursor. Public Protocol/Server changes require generated Client SDK updates.

### Core

- Add a lineage/checkpoint store and transactional fork admission.
- Add a history reader that can combine source immutable history with child events while preserving one ordered projected view.
- Reuse `SessionInputExecution` and `SessionExecution` for child prompts; do not route fork execution through legacy `SessionPrompt.loop`.
- Keep managed Task/Workflow/Goal child creation on its existing owner path, but record a compatible lineage edge.

### CLI/TUI/Desktop

- Show a branch tree with source/child, checkpoint, status, last activity, unread count, and depth.
- Offer fork from a selected stable message/checkpoint with a preview of inherited context and Location policy.
- Show an explicit boundary between inherited history and child messages.
- Provide resume/retry/recover actions with confirmations and idempotent results.
- Add deep links to Session, branch, checkpoint, message, artifact, and diff.

## 7. Comparison semantics

Comparison must be deterministic and bounded:

1. Compare lineage metadata and checkpoint boundaries.
2. Compare projected user/assistant messages by logical position, not by generated message ID.
3. Compare tool calls/results by operation ID and normalized arguments; redact secrets.
4. Compare artifacts by ID/digest and Git changes by Location/worktree revision.
5. Return additions, removals, changed spans, unresolved/unknown attempt boundaries, and cursor evidence.
6. Never merge contexts or imply that one branch's provider output is valid for the other branch.

## 8. Migration and compatibility

1. Treat existing root Sessions as `kind=root` lineage nodes.
2. Convert existing `parentID` child records to `task_child`/`workflow_child`/`goal_child` where the owner record proves the relationship; leave uncertain historical rows as `legacy_parent`.
3. Wrap the current V1 `Session.fork` in the new fork operation using a materialized checkpoint and mark `copyMode=materialized`.
4. Preserve V1 message/part IDs inside a compatibility map; new V2 child IDs use canonical generators.
5. Do not alter exact prompt retry reconciliation or delivery semantics.
6. Invalidate old checkpoint references when compaction or destructive history cleanup removes their evidence; return `checkpoint_invalidated` rather than silently forking a different point.

## 9. Implementation phases

### Phase 0 — Checkpoints and lineage schema

1. Add tables/schemas/migrations and durable event definitions.
2. Generate stable checkpoint IDs at projected history boundaries.
3. Add validation for unknown attempts, ownership, depth, Location, and idempotency.
4. Add fixture builders for source/child/history states.

### Phase 1 — Durable fork API

1. Implement transactional child + lineage + event creation.
2. Implement materialized fallback for legacy V1 history.
3. Add V2 copy-on-write/reference reader.
4. Add child prompt admission and independent execution tests.

### Phase 2 — Tree/navigation and recovery

1. Add tree/lineage/checkpoint list endpoints and projections.
2. Add resume/retry/recover operation contracts.
3. Add cursor-aware source/child subscriptions and deduplication.
4. Add branch archive/delete policy without deleting shared immutable history.

### Phase 3 — Comparison and UI

1. Implement message/tool/artifact/diff comparison.
2. Add CLI/TUI tree and checkpoint selection.
3. Add Desktop tree, deep links, preview, and recovery queue integration.
4. Add branch summaries to the Control Center (#179).

## 10. Test matrix

| Area | Required cases |
| --- | --- |
| Fork admission | Stable message, stable cursor, empty Session, duplicate idempotency key, conflicting reuse, permission denial |
| History | V1 materialized copy, V2 reference/copy-on-write, compaction boundary, source/child isolation, artifact references |
| Recovery | Unknown provider attempt, awaiting tool, stale checkpoint, process restart, retry vs fork distinction |
| Lineage | Root/child/task edge, depth limit, cycle rejection, archived source, deleted/inaccessible source |
| Execution | Concurrent source/child prompts, independent owners, cancellation, event cursor ordering |
| Compare | Message/tool/artifact/diff changes, redaction, bounded output, unknown boundary markers |
| API | HTTP/SDK/ACP parity, generated types, ownership errors, idempotency and stable error codes |
| UI | Tree navigation, branch preview, inherited/new boundary, deep link, restart hydration, resume/retry confirmation |

## 11. Definition of done

- A user can fork from any valid stable checkpoint and receive an independent durable Session.
- Source and child prompts, tools, execution, permissions, artifacts, and cursors remain isolated while immutable history is reusable.
- Process restart preserves tree, checkpoint, active branch preference, and recovery state.
- Invalid/unknown checkpoints fail explicitly and never fork silently from a nearby message.
- TUI, Web, Desktop, HTTP, ACP, and Client SDK share one fork/resume/retry contract.
- Comparison shows message/tool/artifact/Git differences with redaction and cursor evidence.
- Existing V1 fork and managed child behavior remain compatible through migration.

## 12. Dependencies and follow-up

- **#177:** event cursors, attempt recovery, durable execution, and owner fencing are required for checkpoint correctness.
- **#179:** Control Center consumes branch summaries and review queue state.
- **#180:** branch/worktree comparison feeds Git shipping; fork creation must not implicitly stage or push changes.
- **#181:** automations may target a branch only after lineage and checkpoint identity are durable.
- **#189:** comparison and recovery diagnostics should emit correlation IDs and sanitized support evidence.
