# Issue #184 — Remote Session, IDE Context and Offline Reconnect

**Status:** development design and implementation audit
**Priority:** P1
**Scope:** recoverable remote Session access, ACP/IDE context, offline replay and reconnect

## 1. Outcome

Apexo already has workspace routing, global sync projections and an ACP service. The missing product contract is a resumable remote connection: a Desktop, CLI, IDE or ACP client must be able to disconnect, reconnect with a cursor, learn whether work continued, and avoid replaying a prompt or tool mutation twice. Remote/IDE sync is an access layer over Apexo's authoritative Session and Event V2 stores; it is not a second execution engine.

## 2. Current implementation audit

### Done

- Event V2 has persisted IDs, aggregate sequence numbers and replay support in [`packages/core/src/event`](../../../packages/core/src/event) and [`packages/schema/src/event.ts`](../../../packages/schema/src/event.ts).
- Workspace sync APIs expose start, replay, steal and history in [`packages/apexo/src/server/routes/instance/httpapi/groups/sync.ts`](../../../packages/apexo/src/server/routes/instance/httpapi/groups/sync.ts) and [`packages/apexo/src/server/routes/instance/httpapi/handlers/sync.ts`](../../../packages/apexo/src/server/routes/instance/httpapi/handlers/sync.ts).
- Workspace ownership and routing are represented by [`packages/schema/src/workspace.ts`](../../../packages/schema/src/workspace.ts), [`packages/apexo/src/control-plane/workspace.ts`](../../../packages/apexo/src/control-plane/workspace.ts) and the workspace routing middleware.
- Desktop maintains a global sync projection, queue and session cache under [`packages/app/src/context/global-sync`](../../../packages/app/src/context/global-sync).
- ACP has session, permission, event, tool and lifecycle modules under [`packages/apexo/src/acp`](../../../packages/apexo/src/acp), with focused tests in [`packages/apexo/test/acp`](../../../packages/apexo/test/acp).
- HTTP/ACP tests cover workspace routing, event replay and basic reconnect-like flows.

### Partial

- Replay/history is an event transport, not a complete client subscription protocol: there is no durable client lease, heartbeat, last-seen operation state or server-side stream checkpoint.
- `sync.steal` changes workspace ownership but does not provide a general remote Session handoff protocol with owner fencing and user-visible conflict states.
- Desktop cache rebuilding is strong for local projections, but remote clients do not have one shared cursor/ack model.
- ACP supports cancellation and permissions in its own vocabulary; mapping to V2 `operationID`, `eventCursor`, `BackgroundJob` and recovery states is incomplete.
- IDE context is currently mostly directory/workspace context; file revision, selection, diagnostics and editor identity are not consistently bound to a Session input.

### Missing

- Authenticated remote connection records with capability negotiation and protocol versions.
- SSE/WebSocket/ACP subscriptions that resume from a cursor without duplicating events.
- Explicit offline states and a mutation queue that distinguishes safe retry from unknown execution.
- IDE context sources with revision and freshness fences.
- Remote Session ownership lease and stale-owner fencing across server instances.

## 3. Target model

```text
RemoteConnection
  id, clientID, userID, projectID, workspaceID
  protocol: http-sse | websocket | acp
  version, capabilities, status, lastHeartbeatAt
  accessTokenRef, createdAt, expiresAt

Subscription
  id, connectionID, aggregateFilter, cursor, acknowledgedCursor
  status: connecting | live | catching_up | offline | expired | closed

RemoteOperation
  id, sessionID, connectionID, idempotencyKey
  kind: prompt | approve | cancel | tool_result | workspace_change
  status: admitted | executing | completed | failed | unknown | rejected
  admittedEventID, resultEventID, ownerGeneration

IdeContext
  sourceID, workspaceID, editorID, filePath, fileRevision
  selection, diagnosticsCursor, capturedAt, expiresAt
```

Connection and subscription state is advisory; Session/Execution state remains authoritative. A client may acknowledge an event only after it has persisted the event locally. The server can resend events after a lost acknowledgement. Each mutation has an idempotency key and returns an operation status, never an ambiguous empty response.

## 4. Protocol and API design

Extend the public Protocol/Server HttpApi in `packages/protocol` with:

- `connection.open`, `connection.heartbeat`, `connection.close`, `connection.capabilities`.
- `events.subscribe`, `events.replay`, `events.ack`, `events.snapshot`.
- `operation.submit`, `operation.status`, `operation.cancel`.
- `session.attach`, `session.detach`, `session.recover`.
- `ide.context.publish`, `ide.context.get`.

Use `Last-Event-ID`/cursor values only as hints; validate the aggregate and owner scope server-side. Return `cursor`, `nextCursor`, `earliestCursor`, `headCursor`, `hasMore`, and `reconnectAfterMs` in every replay response.

ACP adapters in [`packages/apexo/src/acp/service.ts`](../../../packages/apexo/src/acp/service.ts), [`packages/apexo/src/acp/event.ts`](../../../packages/apexo/src/acp/event.ts) and [`packages/apexo/src/acp/session.ts`](../../../packages/apexo/src/acp/session.ts) should translate this model, not invent a parallel lifecycle. Generated client files must be regenerated with `bun run generate` from `packages/client` after public API changes.

## 5. Reconnect and mutation semantics

1. Client authenticates and sends protocol/version/capability set.
2. Server returns connection ID, owner generation and current head cursor.
3. Client subscribes with its last durable cursor.
4. Server sends a bounded catch-up page, then live events.
5. Client persists events and acknowledges the highest contiguous cursor.
6. On disconnect, the client marks the subscription offline and stops issuing non-idempotent mutations.
7. Reconnect resumes from the last acknowledged cursor; duplicate events are deduplicated by event ID/aggregate sequence.
8. A mutation submitted before disconnect is resolved through `operation.status`; the client never blindly resubmits an unknown mutation.
9. Session ownership changes require an explicit attach/transfer operation and owner generation check.

Offline prompts may be admitted only when the client has a durable local queue and the operation is explicitly safe to retry. Tool results, approvals, commit/push and other side effects must remain pending/unknown until the server confirms the operation ID.

## 6. IDE context contract

IDE context must be small, typed and revision-bound. A context source publishes file path, workspace, revision/hash, language, selection and diagnostics cursor; it does not upload an entire repository by default. The server stores the latest context with expiry and source identity, and Session history records only a reference plus a sanitized summary.

Context merge order should be: explicit user attachment, current editor selection, active workspace, project defaults. A stale file revision produces a warning and forces a fresh read before a mutating tool uses it. ACP clients can request context by source ID and receive a freshness state.

## 7. Security and privacy

- Use short-lived connection tokens scoped to project/workspace/session; store refresh credentials as references.
- Enforce tenant/project ownership on every replay, operation and context endpoint.
- Never treat a client cursor or workspace ID as proof of ownership.
- Redact tokens, full prompt bodies and sensitive file contents from connection diagnostics.
- Apply network, filesystem and model permissions to remote operations exactly as local operations.
- Revoke connections on logout, workspace deletion or credential rotation.
- Require explicit approval for remote takeover, session steal, destructive tools and code upload.

## 8. Implementation phases

### Phase 0 — Contract fixtures

1. Define connection, subscription, operation and IDE context schemas.
2. Add protocol version/capability negotiation and stable error codes.
3. Add tests for duplicate event, cursor gap, unknown operation and stale owner.

### Phase 1 — HTTP/SSE recovery

1. Add authenticated connection registry and heartbeat expiry.
2. Implement replay pages, acknowledgement and SSE resume.
3. Project connection/subscription states into Desktop and CLI.
4. Add operation status lookup and safe retry policy.

### Phase 2 — ACP and IDE context

1. Map ACP lifecycle to the V2 operation/event contract.
2. Implement editor context publish/get with revision fences.
3. Add cancellation and approval forwarding.
4. Add reconnecting ACP fixture with server restart.

### Phase 3 — Remote workspace ownership

1. Add attach/detach/transfer with owner generation.
2. Reuse workspace sync events; remove ad-hoc `steal` semantics from new clients.
3. Add remote background job visibility and recovery UI.

## 9. Test matrix and acceptance criteria

- Replay from zero, middle cursor, head cursor, pruned cursor and invalid cursor.
- Disconnect during event page, prompt admission, approval, tool call and cancellation.
- Duplicate mutation with same idempotency key returns one operation/result.
- Two clients competing for ownership cannot both execute a Session action.
- Server and Desktop restart rebuild the same projection and unread count.
- ACP client negotiates versions, receives progress, resumes after reconnect and does not duplicate tool results.
- IDE file revision mismatch is detected before a write; diagnostics are correlated to the correct revision.
- Auth expiration, revoked connection, workspace deletion and permission denial are explicit and recoverable.

Definition of done: a remote client can reconnect after process/network failure, catch up from a cursor, determine the outcome of every prior mutation, and continue a Session without duplicate execution or stale IDE context.

## 10. Dependencies and risks

- Depends on #177 for Event V2 cursor/replay, BackgroundJob and owner fencing.
- Depends on #183 for remote credential/capability negotiation.
- Depends on #188 for ACP protocol conformance.
- Mobile/IDE clients may support only read/approve initially; advertise capability limits instead of failing late.
- Cursor retention and privacy require an explicit pruning policy that cannot delete events still needed by active clients.
