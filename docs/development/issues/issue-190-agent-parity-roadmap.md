# Issue #190: Agent Parity and Desktop Workflow Roadmap

**GitHub issue:** [#190](https://github.com/cluster1900/apexo-code/issues/190)
**Status:** roadmap design
**Priority:** cross-cutting
**Date:** 2026-10-30

## Purpose

Issue #190 is a release roadmap, not a single runtime feature. It coordinates the individual work packages needed to move Apexo from a reliable local Session engine to a complete Desktop workflow: durable execution, parallel run management, Git shipping, automation, provider/auth expansion, remote synchronization, artifact handling, plugin compatibility and operational diagnostics.

Apexo remains authoritative for Session lifecycle, model execution, permissions, tools, persistence, CLI and Desktop. Pi Agent, OpenCode and Codex Desktop are behavioral references. Their orchestration runtimes must not become Apexo dependencies.

The roadmap has one rule that prevents most integration regressions: later surfaces may consume an earlier contract, but they may not create a parallel in-memory version of it. A Desktop run card must be a projection of durable events; an automation run must be a BackgroundJob/SessionExecution admission; a PR action must use the same permission and operation records as a CLI action.

## Current baseline

The repository already has the following foundations:

- V2 Session prompt admission, projected history, SessionExecution and Location-scoped runners.
- Session, Project, Task, Workflow, Goal, Memory, MCP, LSP, Skills, ACP and HTTP API domains.
- TUI, Web, Electron Desktop, terminal, worktree and review foundations.
- Provider hooks, tool hooks, auth hooks, plugin APIs and multi-source skill discovery.
- Browser/Computer Use transport and deterministic acceptance harnesses; the remaining gaps are documented in [`../browser-computer-use.md`](../browser-computer-use.md).

The baseline is not yet a complete product because the durable execution state is not projected consistently into every client, and several mutations still have surface-specific permission and retry behavior.

## Dependency graph

```text
                         ┌───────────────┐
                         │ #177 V2 core  │
                         │ recovery      │
                         └──────┬────────┘
              ┌─────────────────┼──────────────────┐
              │                 │                  │
      ┌───────▼──────┐  ┌───────▼──────┐   ┌───────▼──────┐
      │ #179 Control │  │ #181         │   │ #182 Session │
      │ Center       │  │ Automations  │   │ tree/fork    │
      └───────┬──────┘  └───────┬──────┘   └───────┬──────┘
              │                 │                  │
      ┌───────▼──────┐          │          ┌───────▼──────┐
      │ #180 Git     │          │          │ #184 Remote/ │
      │ shipping     │          │          │ IDE sync     │
      └──────────────┘          │          └──────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        │                       │                        │
 ┌──────▼───────┐       ┌───────▼────────┐       ┌───────▼───────┐
 │ #183 Provider│       │ #187 Plugin    │       │ #188 Protocol │
 │ /Auth        │       │ ecosystem      │       │ parity        │
 └──────┬───────┘       └────────────────┘       └───────────────┘
        │
 ┌──────▼────────────────────────────────────────────────────────┐
 │ #185 Artifacts   #186 Desktop platform   #189 Observability   │
 └────────────────────────────────────────────────────────────────┘
```

Issue #178 is intentionally omitted from this document's implementation scope. Its Browser/Computer Use design is maintained separately and consumes #177 event, artifact, approval and recovery semantics.

## Release phases

### Phase 0: contract and evidence baseline

Before implementing a new user-facing surface:

1. Freeze the existing Schema and Protocol identities for Session, Execution, Attempt, Event cursor, BackgroundJob, Location and Permission.
2. Define operation IDs, idempotency keys, event sequence ordering and owner generations.
3. Add conformance fixtures for HTTP, SSE, ACP and generated Client SDK behavior.
4. Add correlation and latency events without recording prompts, tokens, source code or sensitive artifacts.
5. Write migration and rollback notes for each new persisted table/record.
6. Record a known-good source revision before running parallel acceptance work.

**Exit gate:** a local crash, duplicate request, reconnect and stale-owner scenario produces a typed, inspectable result.

### Phase 1: reliable execution (#177)

1. Persist execution/attempt state and recoverable outcomes.
2. Implement event cursor/replay as a first-class read contract.
3. Add BackgroundJob admission, cancellation and terminal projection.
4. Add owner fencing so a replacement process cannot settle an old attempt.
5. Surface `recoverable`, `unknown`, `failed` and `cancelled` states in TUI, Web and Desktop.
6. Run package typechecks, tests, generated checks and `test:httpapi` before downstream work.

**Exit gate:** restart, duplicate wake, owner replacement, cursor reconnect and high-throughput tool settlement tests pass.

### Phase 2: Desktop delivery loop (#179 and #180)

1. Build server-side run summary and Review Queue projections.
2. Add Control Center overview, run detail, transcript, terminal, diff, artifacts and approvals.
3. Add worktree status, file/hunk staging, commit and push operations.
4. Add GitHub PR creation/update, checks and review thread ingestion.
5. Route review comments back to the owning Session as durable input.
6. Test five or more parallel Sessions and Desktop restart/reconnect.

**Exit gate:** a user can start multiple runs, inspect a diff, stage selected hunks, commit, push, create/update a PR and handle a failed check without leaving Desktop.

### Phase 3: durable time and branch exploration (#181, #182 and #184)

1. Add Project/Thread/Skill automation records, scheduler admission and heartbeat checkpoints.
2. Add durable Session fork/tree records and compareable history projections.
3. Add remote Session/ACP reconnect, offline cursor catch-up and operation status recovery.
4. Connect all long-running operations to the Control Center and diagnostics surface.

**Exit gate:** scheduled jobs, forked Sessions and remote subscriptions survive process/client restart with no duplicate execution.

### Phase 4: ecosystem contracts (#183, #187 and #188)

1. Add provider capability discovery and credential references.
2. Add subscription/OAuth flows without putting provider tokens in Session or event payloads.
3. Version plugin manifests, SDK ranges, capabilities, permissions, lockfiles and rollback.
4. Add LSP/MCP/ACP health, reconnect and compatibility matrix tests.
5. Keep OpenCode Go and third-party adapters opt-in; their runtimes must not own Apexo orchestration.

**Exit gate:** a new provider, plugin or protocol client can be validated against public contracts without modifying Session core, and compatibility failures are visible before enablement.

### Phase 5: artifacts, platform and operations (#185, #186 and #189)

1. Add artifact manifests, MIME/size/sensitivity metadata and preview adapters.
2. Add Desktop voice, pop-out windows, updater and platform capability checks.
3. Add correlation IDs, diagnostic checks, metrics and sanitized support bundles.
4. Run cross-platform packaging and upgrade interruption tests.

**Exit gate:** a user can inspect results, recover from a failed update or connection, and export enough redacted evidence for a developer to reconstruct the execution timeline.

## Cross-issue contracts

### Execution and operation identity

Every asynchronous mutation must carry:

```text
operationID       unique idempotent mutation identity
sessionID         logical conversation owner
runID             execution attempt or BackgroundJob run
parentOperationID causal parent, when nested
ownerGeneration   fencing generation for settlement
eventCursor       last durable event observed by the caller
```

The caller may retry with the same `operationID`. The server must return the existing result or a typed `in_progress` response; it must never create a second commit, job, approval or provider attempt.

### Event and projection contract

Domain services publish durable events. Read models such as Control Center cards, automation history and diagnostics are projections. A projection may lag and must expose its cursor/observed-at time. It must not report a stale `running` state as current after a disconnect or owner loss.

Every event needs a stable type, aggregate identity, sequence, timestamp, source operation and redaction policy. Cursor APIs must support initial snapshot, incremental replay, gap detection and reconnect.

### Permission and credential contract

Permission is classified at the authoritative service boundary. Clients may request an action, but they cannot declare it safe by setting a boolean. The approval record is bound to action class, target, origin/repository/application, Session and owner generation. Credentials are referenced by ID and loaded only inside the owning service or connector.

### Client generation and dependency direction

Any public Protocol or Server `HttpApi` change requires `bun run generate` in `packages/client`. Generated files are outputs. Runtime Client code may depend on Schema and Protocol, never Core or Server. Desktop and TUI consume Client/SDK contracts instead of importing server internals.

### Verification contract

Each phase must include:

- package-focused unit and protocol tests;
- restart, cancellation, timeout, duplicate and stale-owner tests;
- actual CLI PTY coverage where CLI behavior changes;
- Playwright Desktop coverage as a UI test driver, asserting both UI and backend state;
- a live or isolated connector fixture for external systems;
- typecheck, test, generated checks and `test:httpapi` required by `AGENTS.md`.

## Release sequencing rules

1. Do not start broad Desktop UI work until #177 event and recovery contracts are stable.
2. #179 and #180 may proceed in parallel after #177, but Git operations must use the #179 review queue and workspace identity.
3. #181, #182 and #184 may share cursor and ownership infrastructure but must keep scheduler, fork and remote transport state separate.
4. #183, #187 and #188 may add adapters, but none may bypass Apexo permission, Location, Credential or audit layers.
5. #185, #186 and #189 can iterate independently after the core operations are correlated and redacted.
6. Browser/Computer Use (#178) must consume these shared contracts rather than introducing a separate approval or event system.

## Roadmap-level acceptance

The roadmap is complete when all of the following are true:

- A Session can be admitted, executed, interrupted, recovered, replayed and observed consistently from CLI, Desktop and an external client.
- Multiple runs can be listed, filtered, approved, cancelled, resumed and reviewed after a Desktop restart.
- Git changes can be staged, committed, pushed and associated with one PR without duplicate mutation or branch-protection bypass.
- Scheduled, forked and remote executions preserve operation identity and do not duplicate provider work after retries.
- Providers, plugins and protocol adapters advertise capabilities and permissions before use and fail closed on incompatibility.
- Artifacts are typed, redacted, previewable and linked to the run that produced them.
- Diagnostics can explain queueing, approval, retry, disconnect and recovery states without exposing secrets.
- The repository CI gates are green and each issue has an implementation PR, test commands, known limitations and follow-up links.

