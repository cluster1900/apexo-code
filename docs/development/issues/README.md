# GitHub Issue Development Documents

**Status:** engineering design set for the current Agent parity roadmap
**Date:** 2026-10-30
**Repository:** Apexo (`cluster1900/apexo-code`)
**Scope:** all current roadmap issues except Browser Use and Computer Use (#178), which are documented separately in [`../browser-computer-use.md`](../browser-computer-use.md)

This directory contains implementation-oriented design documents for the GitHub roadmap issues. Each document is written against the current Apexo source tree, not against an abstract product model. It records the existing implementation boundary, the missing contract, the proposed persistence and event semantics, package ownership, client generation impact, UI behavior, tests, and the conditions required before the issue can be considered complete.

These documents are design artifacts. A document may describe a target state that is not implemented yet. The `Current implementation status` section in each issue document is the source of truth for distinguishing **implemented**, **partially implemented**, and **missing** behavior.

## Issue index

| Issue | Priority | Technical area | Document | Main dependency |
| --- | --- | --- | --- | --- |
| [#177](https://github.com/cluster1900/apexo-code/issues/177) | P0, completed baseline | V2 execution recovery, event cursors, BackgroundJob, owner fencing | [`issue-177-v2-execution-recovery.md`](issue-177-v2-execution-recovery.md) | Session V2 core |
| [#178](https://github.com/cluster1900/apexo-code/issues/178) | P0, excluded here | Browser/Computer Use and Appshots | [`../browser-computer-use.md`](../browser-computer-use.md) | #177 event, artifact and approval semantics |
| [#179](https://github.com/cluster1900/apexo-code/issues/179) | P0 | Desktop Control Center, parallel runs and Review Queue | [`issue-179-desktop-control-center.md`](issue-179-desktop-control-center.md) | #177 projections and cursors |
| [#180](https://github.com/cluster1900/apexo-code/issues/180) | P0 | Git shipping workflow and PR lifecycle | [`issue-180-git-shipping-workflow.md`](issue-180-git-shipping-workflow.md) | #179 workspaces and review queue |
| [#181](https://github.com/cluster1900/apexo-code/issues/181) | P1 | Project/Thread automation, heartbeat and scheduler | [`issue-181-automations.md`](issue-181-automations.md) | #177 BackgroundJob, #179 run view |
| [#182](https://github.com/cluster1900/apexo-code/issues/182) | P1 | Session tree, fork, resume and history comparison | [`issue-182-session-tree-fork.md`](issue-182-session-tree-fork.md) | #177 history and event cursors |
| [#183](https://github.com/cluster1900/apexo-code/issues/183) | P1 | Provider capabilities, OAuth and credentials | [`issue-183-provider-auth.md`](issue-183-provider-auth.md) | credential and permission boundaries |
| [#184](https://github.com/cluster1900/apexo-code/issues/184) | P1 | Remote Session, ACP/IDE sync and offline reconnect | [`issue-184-remote-ide-sync.md`](issue-184-remote-ide-sync.md) | #177 cursors, #183 auth |
| [#185](https://github.com/cluster1900/apexo-code/issues/185) | P2 | Artifact workspace for documents and media | [`issue-185-artifact-workspace.md`](issue-185-artifact-workspace.md) | #177 artifacts, #179 artifact panel |
| [#186](https://github.com/cluster1900/apexo-code/issues/186) | P2 | Desktop voice, windows, updater and Windows sandbox | [`issue-186-desktop-platform.md`](issue-186-desktop-platform.md) | Desktop host capability layer |
| [#187](https://github.com/cluster1900/apexo-code/issues/187) | P1 | Plugin SDK, manifest, permissions and compatibility | [`issue-187-plugin-ecosystem.md`](issue-187-plugin-ecosystem.md) | permission and credential contracts |
| [#188](https://github.com/cluster1900/apexo-code/issues/188) | P1 | LSP/MCP/ACP hardening and compatibility matrix | [`issue-188-protocol-parity.md`](issue-188-protocol-parity.md) | public protocol and conformance tests |
| [#189](https://github.com/cluster1900/apexo-code/issues/189) | P2 | Observability, diagnostics and support bundles | [`issue-189-observability.md`](issue-189-observability.md) | #177 correlation and event data |
| [#190](https://github.com/cluster1900/apexo-code/issues/190) | Roadmap | Cross-issue dependency and release gates | [`issue-190-agent-parity-roadmap.md`](issue-190-agent-parity-roadmap.md) | all issues above |

## Reading and implementation order

Read the documents in dependency order rather than issue-number order:

1. [`issue-177-v2-execution-recovery.md`](issue-177-v2-execution-recovery.md) defines the durable execution vocabulary used by every later document.
2. [`issue-179-desktop-control-center.md`](issue-179-desktop-control-center.md) defines the run projection and review queue consumed by Git shipping and automation.
3. [`issue-180-git-shipping-workflow.md`](issue-180-git-shipping-workflow.md) defines the user-approved path from a worktree diff to a PR.
4. [`issue-181-automations.md`](issue-181-automations.md), [`issue-182-session-tree-fork.md`](issue-182-session-tree-fork.md), and [`issue-184-remote-ide-sync.md`](issue-184-remote-ide-sync.md) extend the durable execution model across time, branches, and clients.
5. [`issue-183-provider-auth.md`](issue-183-provider-auth.md), [`issue-187-plugin-ecosystem.md`](issue-187-plugin-ecosystem.md), and [`issue-188-protocol-parity.md`](issue-188-protocol-parity.md) harden extensibility without moving orchestration out of Apexo.
6. [`issue-185-artifact-workspace.md`](issue-185-artifact-workspace.md), [`issue-186-desktop-platform.md`](issue-186-desktop-platform.md), and [`issue-189-observability.md`](issue-189-observability.md) complete the product surfaces and operational feedback loop.
7. [`issue-190-agent-parity-roadmap.md`](issue-190-agent-parity-roadmap.md) is the release sequencing and cross-issue acceptance document.

## Shared engineering rules

Every issue document uses the same implementation boundary:

- `packages/schema` owns domain values, persisted records, event payloads and validation.
- `packages/core` owns native execution, services, permissions, persistence and process-local coordination.
- `packages/protocol` owns public HTTP contracts.
- `packages/server` owns handlers, ownership checks and service composition.
- `packages/client` consumes generated Protocol clients and must never import Core or Server at runtime.
- `packages/sdk-next` composes Client, Core and Server for local use.
- `packages/apexo` owns CLI/TUI compatibility adapters, integration fixtures and provider-facing runtime wiring.
- `packages/app` owns the shared SolidJS UI; `packages/desktop` owns Electron host, preload and packaging.
- `packages/tui` owns terminal presentation and must call authoritative APIs rather than reimplementing domain state.

When a public Protocol or Server `HttpApi` changes, run `bun run generate` from `packages/client`; never edit generated files directly. New asynchronous behavior must define idempotency, cancellation, retries, crash recovery, owner fencing, event ordering and permission scope before UI work starts. Tests must exercise the actual service boundary and must be run from the owning package directory.

## Common definition of done

An issue document is ready to guide implementation only when it identifies:

- the exact existing files and services that own the behavior;
- the new schema, event, API and client-generation surface;
- the durable state machine and recovery behavior;
- permission, credential, redaction and audit semantics;
- CLI, TUI, Desktop and external-client behavior;
- migration and backwards-compatibility behavior;
- normal, failure, cancellation, timeout, restart, concurrency and disconnect tests;
- explicit non-goals, known limitations and dependency gates.

An implementation is complete only after the issue's focused tests and the repository CI gates pass, the relevant CLI/Desktop acceptance path is exercised, and the issue is updated with the PR, commands, results and remaining limitations.

