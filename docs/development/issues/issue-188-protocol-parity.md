# Issue #188 — LSP, MCP, ACP and Skills Protocol Parity

**Status:** development design and implementation audit
**Priority:** P1
**Scope:** lifecycle contracts, discovery, diagnostics, reconnect, compatibility matrix and conformance tests

## 1. Problem

Apexo already has native LSP, MCP, ACP and multi-source skills implementations. The gap is operational parity: each integration has different status/error/retry vocabulary, and clients cannot reliably determine whether a server is connecting, authenticated, degraded, stale, restarting or unavailable. This issue hardens the existing implementations; it does not import another runtime or rebuild LSP/MCP/ACP.

## 2. Current implementation

### Done

- LSP schemas, status and supported operations are defined in [`packages/schema/src/lsp.ts`](../../../packages/schema/src/lsp.ts), with client lifecycle and diagnostics in [`packages/core/src/lsp.ts`](../../../packages/core/src/lsp.ts), [`packages/core/src/lsp-client.ts`](../../../packages/core/src/lsp-client.ts) and [`packages/core/src/lsp-diagnostics.ts`](../../../packages/core/src/lsp-diagnostics.ts).
- MCP schemas, authentication state and errors are defined in [`packages/schema/src/mcp.ts`](../../../packages/schema/src/mcp.ts); transports and OAuth live in [`packages/core/src/mcp.ts`](../../../packages/core/src/mcp.ts), [`packages/core/src/mcp-stdio.ts`](../../../packages/core/src/mcp-stdio.ts) and [`packages/core/src/mcp-oauth.ts`](../../../packages/core/src/mcp-oauth.ts).
- ACP has explicit service, session, tool, permission, usage and event modules under [`packages/apexo/src/acp`](../../../packages/apexo/src/acp).
- Skills are discovered and normalized by [`packages/core/src/skill/discovery.ts`](../../../packages/core/src/skill/discovery.ts), [`packages/core/src/skill.ts`](../../../packages/core/src/skill.ts) and plugin bundle runtime.
- Protocol groups and server handlers exist for LSP, MCP, skills and plugins under [`packages/protocol/src/groups`](../../../packages/protocol/src/groups) and [`packages/server/src/handlers`](../../../packages/server/src/handlers).
- Comprehensive focused tests exist in [`packages/apexo/test/lsp`](../../../packages/apexo/test/lsp), [`packages/apexo/test/mcp`](../../../packages/apexo/test/mcp), [`packages/apexo/test/acp`](../../../packages/apexo/test/acp) and V2 integration suites.

### Partial or missing

- Lifecycle statuses are not normalized across LSP/MCP/ACP/skills and do not consistently include generation, health, retry-after or last successful operation.
- LSP diagnostics are revision-aware in the client but are not uniformly projected into Session/run correlation and Desktop review state.
- MCP OAuth and transport recovery are mature locally, but remote connection capability changes and catalog snapshots are not a single durable contract.
- ACP cancellation/progress/approval exists but reconnect and event cursor semantics are not identical to V2 Session events.
- Skills precedence and invalid-source diagnostics exist in code paths but need a public manifest/capability response and cross-client conformance tests.

## 3. Shared capability contract

Define a `CapabilityServiceStatus` record used by all four families:

```text
id, kind: lsp | mcp | acp | skill
name, version, protocolVersion, generation
status: discovering | connecting | authenticating | ready | degraded |
        restarting | stopped | failed | disabled
capabilities[], lastHealthyAt, retryAt?, error?
source, ownerScope, updatedAt
```

Every status mutation publishes a typed event with operation ID and generation. A client must never render `ready` from a stale cache after a generation change. Catalog/tool/skill schema changes are versioned and become effective at the next Session turn, not halfway through an in-flight provider request.

## 4. LSP hardening

- Detect language/root and resolve server from project config, plugin bundle or explicit user setting.
- Persist server generation, executable identity/version, workspace root and capabilities.
- Correlate `publishDiagnostics` with file revision, Session/run and source server generation.
- Use bounded restart backoff; expose manual restart and a clear failed reason.
- Gate install/download through Location/network policy.
- Add health and latency to the common status API; do not treat an empty diagnostic set as proof of healthy initialization.

## 5. MCP hardening

- Normalize local stdio, HTTP/streaming and remote OAuth into one connection status/capability snapshot.
- Keep OAuth credentials as references; reuse [`Mcp.Authentication`](../../../packages/schema/src/mcp.ts) for waiting/authenticated/expired states.
- Add connect/test/disconnect/reconnect operations with cancellation and retry-after.
- Version tool/resource/prompt catalogs. A catalog refresh creates a new generation and records a diff.
- Apply Session permission and artifact/log redaction to every MCP result.
- Preserve the existing bounded redirect, callback state and locked credential-store safeguards.

## 6. ACP hardening

ACP adapters must map stdio framing, request/response IDs, progress, cancellation, approval and event replay to the V2 operation/event contract. A reconnecting client first queries operation status, then resumes event subscription from its last acknowledged cursor. It must not resend a request whose outcome is unknown. Version mismatch returns protocol and capability details rather than a generic parse error.

## 7. Skills discovery

Expose source, precedence, version, allowed tools and validation diagnostics in a public catalog. Discovery order should be deterministic across project, user and global scopes. Invalid `SKILL.md` files produce a warning/error item but do not prevent unrelated skills from loading. Session events record the skill ID, source and revision used for a turn so a later replay can explain the behavior.

## 8. Protocol and compatibility matrix

Add conformance fixtures for:

- Apexo Server/Client SDK versions and generated schemas.
- TUI, Web/Desktop and ACP clients.
- MCP local stdio, remote HTTP and OAuth flows.
- LSP initialization, diagnostics, restart and workspace roots.
- Skills source precedence and invalid metadata.

Every public Protocol/Server `HttpApi` change requires `bun run generate` from `packages/client`; generated files are never hand-edited. The matrix records supported versions, capability flags, deprecations and migration gates.

## 9. Implementation phases

1. Define shared status/error/capability schemas and event types.
2. Add status projection and health/retry fields to LSP/MCP/ACP/skill handlers.
3. Align operation IDs, cancellation and event cursors with V2 Session.
4. Add catalog generations and skill source diagnostics.
5. Publish compatibility matrix and conformance CLI/CI job.
6. Update Desktop/CLI status panels and ACP client adapters.

## 10. Test matrix and acceptance criteria

- LSP language detection, root selection, initialize timeout, crash/restart, diagnostics revision mismatch and manual restart.
- MCP OAuth missing/expired/revoked, remote disconnect, catalog change, tool timeout, secret redaction and reconnect.
- ACP malformed frame, duplicate request ID, cancellation, approval, progress, disconnect/reconnect and version mismatch.
- Skills source conflict, precedence, invalid manifest, duplicate name and revision replay.
- Client generation/checks, API compatibility and old-client capability negotiation.

Definition of done: every integration exposes a consistent, diagnosable lifecycle; clients can reconnect and resume without duplicate execution; a CI conformance matrix prevents incompatible public protocol changes.

## 11. Dependencies and risks

- Depends on #177 for cursors, operation recovery and owner fencing.
- Supports #183 provider/auth and #184 remote/IDE sync; capability negotiation must use the same credential and connection scope.
- Third-party servers may not support graceful cancellation or version reporting; mark those capabilities explicitly instead of assuming support.
