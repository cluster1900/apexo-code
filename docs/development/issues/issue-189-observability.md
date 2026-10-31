# Issue #189 — Desktop Observability, Diagnostics and Exportable Support Bundles

**Status:** development design and implementation audit
**Priority:** P2
**Scope:** correlation, runtime state, metrics, diagnostics UI and privacy-preserving support exports

## 1. Problem

Apexo already writes structured logs and can export OTLP logs/traces, but a user cannot reliably answer “what is running, where is it waiting, what failed, and what should I do next?” Developers also lack a safe way to correlate Session, provider, tool, BackgroundJob, Git and Desktop IPC events. This issue adds visibility without changing execution semantics or exporting secrets.

## 2. Current implementation audit

### Done

- Structured file/stderr logging is implemented in [`packages/core/src/observability/logging.ts`](../../../packages/core/src/observability/logging.ts), with a process run ID in [`packages/core/src/observability/shared.ts`](../../../packages/core/src/observability/shared.ts).
- OTLP log and trace export is optional and configured in [`packages/core/src/observability/otlp.ts`](../../../packages/core/src/observability/otlp.ts) and [`packages/core/src/observability.ts`](../../../packages/core/src/observability.ts).
- Event V2 and Session event streams provide a durable source for timeline reconstruction.
- Desktop has global sync/session projections and toast/error surfaces under [`packages/app/src/context`](../../../packages/app/src/context) and [`packages/app/src/utils/toast.tsx`](../../../packages/app/src/utils/toast.tsx).
- Existing tests exercise portions of logging, event replay, sync and HTTP diagnostics indirectly.

### Partial or missing

- `runID` is process-scoped; there is no consistent `sessionID`, `runID`, `operationID`, `attemptID`, `toolCallID` and parent-operation graph across all services.
- Logs contain structured fields, but there is no shared redaction/scrubbing contract for prompt, token, path, artifact and provider payload data.
- No public diagnostics endpoint aggregates connection, storage, provider, permission, plugin, workspace and update health.
- No durable metric projection for queue latency, replay lag, provider first token, tool latency, retries or backpressure.
- Desktop toasts do not provide a persistent timeline, evidence, next action or export flow.
- No user-reviewed support bundle format exists.

## 3. Correlation and event model

Add an `OperationContext` carried through SessionExecution, provider attempts, tool calls, BackgroundJobs, scheduler runs, Git operations, browser/computer actions and Desktop IPC:

```text
sessionID, runID, attemptID?, operationID, parentOperationID?
component, kind, ownerGeneration, startedAt, endedAt?
status, errorCode?, retryCount, eventCursor?
```

Operation events are append-only and contain references, not full prompt/tool payloads. A projection builds an operation graph and summary; it must tolerate missing spans and old events. Correlation IDs are untrusted input at HTTP boundaries and are validated against Session ownership.

## 4. Metrics and health checks

Initial measurements:

- prompt admission-to-start and provider first-token latency;
- provider turn duration, rate-limit/error class and unknown-attempt count;
- tool queue, execution, settlement and backpressure latency;
- event append, replay, reconnect and cursor lag;
- BackgroundJob queue/runtime/cancel/retry;
- Git status/diff/commit/push/check duration;
- plugin load/reload duration and failures;
- Desktop IPC round-trip and renderer/server disconnects.

Health checks are typed `pass`, `warn`, `fail`, `unknown` records with evidence and next action. Long checks run as cancellable operations. Metrics aggregate by project/session and use bounded cardinality; prompt text, token values and source code are never labels.

## 5. Diagnostics API and Desktop UX

Add Protocol/Server groups for `diagnostics.snapshot`, `diagnostics.check`, `diagnostics.operation`, `diagnostics.metrics` and `support_bundle.create/status/download`. A snapshot includes version/platform, runtime/server/renderer connectivity, storage/database, provider/auth, workspace, permissions, plugin, LSP/MCP and update status.

Desktop should provide:

- a persistent activity/diagnostics panel with current state, evidence, timestamp and next action;
- filters by Project, Session, run, operation and severity;
- operation graph linking a user action to provider/tool/job/event IDs;
- restart/reconnect/cancel/retry controls only where the underlying contract supports them;
- a preview of support-bundle fields before export.

CLI should offer `diagnostics`, `diagnostics check`, `diagnostics events` and `support-bundle` with bounded human and JSON output. ACP/remote clients receive sanitized status and cursors, not local file contents.

## 6. Support bundle privacy contract

A support bundle is a versioned manifest plus sanitized JSON/NDJSON and optional screenshots/log snippets. Defaults:

- include versions, platform, feature flags, config key names, status/error codes, timings and correlation graph;
- hash or redact prompt content, source paths, filenames, artifact bytes, credentials, cookies, headers and provider bodies;
- include only selected time range/Project/Session and only artifacts the user explicitly previews;
- run deterministic secret/token/credential/path scrubbers before packaging;
- show the user a field-level preview and allow exclusion; export locally by default;
- mark the bundle sensitivity and integrity hash; never upload automatically.

## 7. Implementation phases

### Phase 0 — Correlation and scrubbing

1. Define `OperationContext`, redaction rules and stable error taxonomy.
2. Instrument Session, provider, tool, event, workspace and Desktop IPC boundaries.
3. Add unit tests proving tokens/prompts/paths are removed from logs and bundles.

### Phase 1 — Health and metrics

1. Add diagnostics service and read-only HTTP/Client API.
2. Persist bounded metric windows and event cursor lag.
3. Add CLI/desktop status surfaces and actionable recovery links.

### Phase 2 — Support bundle

1. Add selection UI and manifest/schema version.
2. Generate locally through a cancellable BackgroundJob.
3. Preview, scrub, validate and export; add offline parser fixture.

### Phase 3 — Operational hardening

1. Add dashboards/OTLP mappings with stable low-cardinality attributes.
2. Add retention and rotation policy.
3. Correlate restart/recovery, owner fencing, Git, plugin, LSP/MCP and remote operations.

## 8. Test matrix and acceptance criteria

- Correlation survives nested provider/tool/job/event operations and remains valid across restart/reconnect.
- Metrics have bounded cardinality and no prompt/token/path labels.
- Each health check returns deterministic status/evidence/next action for healthy, degraded, timeout and unavailable cases.
- Support bundle scrubber removes API keys, OAuth tokens, cookies, headers, prompts and sensitive paths from representative fixtures.
- Bundle creation cancellation, large logs, missing events, renderer disconnect and permission denial are recoverable.
- Desktop/CLI show the same status and cursor; export can be parsed offline into a timeline.
- OTLP disabled/enabled behavior does not change core execution or leak secret attributes.

Definition of done: any failed operation can be traced from Desktop/CLI to Session/run/provider/tool evidence, a user can export a reviewed sanitized bundle, and the bundle is sufficient to diagnose state, latency and recovery without exposing secrets or source.

## 9. Dependencies and risks

- Depends on #177 for operation/attempt/cursor semantics and #179 for the Control Center activity surface.
- Integrates with #183, #184, #187 and #188 status/capability records.
- Redaction is an evolving security boundary; fail closed for uncertain secret-like fields and document exclusions.
