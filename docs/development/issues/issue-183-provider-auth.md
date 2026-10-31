# Issue #183 — Provider and Authentication Parity

**Status:** development design and implementation audit
**Scope:** provider capability discovery, subscription/OAuth login, credential lifecycle, and the optional OpenCode Go connector
**Priority:** P1
**Repository boundary:** Apexo owns the provider contract, credentials, permissions, Session execution, and audit trail. A hosted provider or OpenCode Go process may be an adapter only.

## 1. Problem and intended outcome

Apexo can already resolve many native LLM providers and stores credentials through the V2 credential service. It also has provider auth hooks and a separate MCP OAuth implementation. The missing piece is a single user-facing contract: the product must tell the user which provider/model capabilities are available, how a credential was obtained, which scopes it has, when it expires, and what will happen when the provider is unavailable. Provider login must work consistently in TUI, Desktop, CLI, HTTP and ACP without copying secrets into Session history.

The optional OpenCode Go connector must remain a transport/provider adapter. It must not become a second Session runner, permission system, credential store, or orchestration engine.

## 2. Current implementation audit

### Already implemented

- Provider identity and API variants are defined in [`packages/schema/src/provider.ts`](../../../packages/schema/src/provider.ts).
- V2 credential values support API keys, OAuth access/refresh pairs and external references in [`packages/schema/src/credential.ts`](../../../packages/schema/src/credential.ts).
- The credential service persists records and has legacy `auth.json`/Grok migration logic in [`packages/core/src/credential.ts`](../../../packages/core/src/credential.ts) and [`packages/core/src/credential/sql.ts`](../../../packages/core/src/credential/sql.ts).
- LLM authentication is composed as typed `Auth`/`Credential` values in [`packages/llm/src/route/auth.ts`](../../../packages/llm/src/route/auth.ts); secrets are redacted before request construction.
- Provider catalog and provider HTTP routes exist in [`packages/core/src/catalog.ts`](../../../packages/core/src/catalog.ts), [`packages/protocol/src/groups/provider.ts`](../../../packages/protocol/src/groups/provider.ts) and [`packages/server/src/handlers/provider.ts`](../../../packages/server/src/handlers/provider.ts).
- Plugin provider hooks and UI login flows exist in [`packages/apexo/src/provider/auth.ts`](../../../packages/apexo/src/provider/auth.ts), [`packages/plugin/src/index.ts`](../../../packages/plugin/src/index.ts) and [`packages/app/src/components/dialog-connect-provider.tsx`](../../../packages/app/src/components/dialog-connect-provider.tsx).
- MCP OAuth has bounded redirects, loopback callback validation, state checking and a private locked credential store in [`packages/core/src/mcp-oauth.ts`](../../../packages/core/src/mcp-oauth.ts) and [`packages/core/src/mcp-oauth-store.ts`](../../../packages/core/src/mcp-oauth-store.ts).
- Provider and OAuth coverage is present under [`packages/apexo/test/provider`](../../../packages/apexo/test/provider), [`packages/apexo/test/auth`](../../../packages/apexo/test/auth) and [`packages/apexo/test/mcp`](../../../packages/apexo/test/mcp).

### Partial

- Provider `Info` exposes request headers/body but not a normalized capability set, credential status, account identity, quota, region, subscription plan, or model refresh timestamp.
- Provider auth hooks have `auto` and `code` flows, but pending authorization is held in process-local state and has no durable operation/cursor.
- The V2 credential API updates labels/removes records but does not expose a complete start/authorize/callback/refresh lifecycle to every client.
- Legacy provider configuration, V2 credentials, plugin auth and MCP OAuth use different identity and error vocabularies.
- The app can select a provider, but capability changes do not invalidate an already running Session model selection.

### Missing

- A versioned capability discovery contract shared by provider catalog, model resolution, auth UI, Session admission and ACP.
- Durable auth attempts with cancellation, expiry, retry and callback replay protection.
- A single refresh/revocation policy and a secure credential reference passed to providers.
- An opt-in OpenCode Go connector contract with health, capability and failure isolation.
- Tests for expired subscriptions, revoked credentials, provider model removal, OAuth callback replay and connector restart.

## 3. Domain model and state machines

Introduce these Schema records under `packages/schema/src/provider.ts` or a new `provider-capability.ts` module:

```text
ProviderCapability
  providerID, capabilityVersion
  models[{modelID, modalities, context, tools, reasoning, maxOutputTokens}]
  authMethods[{methodID, kind, scopes, interactive}]
  limits{requestsPerMinute, tokensPerMinute, concurrency}?
  regions, features, fetchedAt, expiresAt

CredentialRef
  credentialID, providerID, methodID, accountLabel?
  status: available | expiring | expired | revoked | external | invalid
  scopes, expiresAt, lastValidatedAt
  secretLocation: local_keychain | private_file | external

AuthAttempt
  id, providerID, methodID, sessionID?
  status: created | waiting_user | callback_received | exchanging |
          validated | failed | cancelled | expired
  stateHash, expiresAt, operationID, eventCursor

Connector
  id, kind: native | opencode_go | plugin
  status: unavailable | connecting | ready | degraded | stopped
  protocolVersion, capabilities, endpoint, lastHealthAt
```

The auth attempt state transition must be monotonic. A callback is accepted only when the attempt is current, unexpired, has the expected state hash and has not already committed a credential. Replaying a callback returns the existing result or a typed `already_completed` error; it must never create a second credential.

Provider capability refresh is separate from credential refresh. A transient capability failure preserves the last known snapshot with `stale=true`; it must not silently delete the model catalog.

## 4. API and package boundaries

### Schema and Protocol

Add `provider.capabilities`, `provider.auth.methods`, `provider.auth.start`, `provider.auth.callback`, `provider.auth.cancel`, `provider.credentials`, `provider.connector.status` and `provider.capabilities.refresh` endpoints under [`packages/protocol/src/groups/provider.ts`](../../../packages/protocol/src/groups/provider.ts). Use branded IDs and explicit error unions for missing credential, invalid state, expired attempt, unsupported method, rate limit and connector unavailable.

Do not edit generated client files. After changing Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`, then `bun run check:generated` in both client and SDK packages.

### Core and Server

- Keep secret material in `Credential.Service`; provider capability services receive a `Credential.ID` or a scoped resolver, never raw credential JSON in events.
- Add a `ProviderCapability.Service` with cache, stale-while-revalidate and per-provider refresh fencing.
- Add an `AuthAttempt.Service` with persistent rows and an owner/operation fence.
- Make Server handlers perform authorization and Session/Location ownership checks before starting an auth mutation.
- Keep OpenCode Go behind `ProviderConnector` and map its errors into Apexo provider errors.

### Client, CLI and Desktop

- The generated Client exposes the same auth attempt IDs and event cursors.
- Desktop settings show provider capability, account, scopes and expiry; the login dialog consumes the public API rather than plugin internals.
- CLI supports `provider list`, `provider status`, `provider login`, `provider logout`, `provider refresh` and `provider health`; no command prints secret values.
- ACP reports `waiting_approval`, `waiting_auth`, `ready`, `expired` and `failed` with operation IDs.

## 5. Security and permission requirements

1. Connecting a new provider, granting an OAuth scope, importing an external credential or enabling OpenCode Go requires explicit user approval.
2. Redirects are restricted to HTTPS providers or loopback callbacks. Never follow a credential-bearing redirect automatically.
3. Store refresh tokens and API keys in the existing private credential store or OS keychain adapter; event payloads contain only credential ID, provider ID and redacted metadata.
4. OAuth state, PKCE verifier and callback nonce are one-time values. Bind them to user, project/location and auth attempt.
5. Provider capability data is untrusted input. Limit response size, validate models and never execute provider-supplied URLs or commands.
6. A provider connector cannot bypass Session permissions, tool approval, Location restrictions or audit events.
7. Revocation and logout must invalidate local refresh state and make future model admission fail with a recoverable credential status.

## 6. Implementation phases

### Phase 0 — Contract and migration

1. Inventory all provider IDs, legacy config keys, plugin auth methods and credential rows.
2. Define capability, credential reference and auth attempt schemas.
3. Add read-only projection endpoints and compatibility decoding for existing credentials.
4. Add conformance fixtures for API key, OAuth, external and missing credential cases.

### Phase 1 — Durable provider authentication

1. Persist auth attempts with unique state hash and expiry index.
2. Move callback handling behind the Server/Core service boundary.
3. Add cancellation, timeout, retry and idempotent completion.
4. Emit `auth.started`, `auth.waiting_user`, `auth.completed`, `auth.failed`, `auth.cancelled` and `auth.expired` events.
5. Make Desktop and CLI render the same attempt state and resume after restart.

### Phase 2 — Capability discovery and model selection

1. Add provider capability adapters for native providers.
2. Cache snapshots by provider/version and use stale-while-revalidate.
3. Make Session admission validate selected model against the latest permitted capability snapshot.
4. Return a clear `model_unavailable` result when a provider removes a model mid-session.

### Phase 3 — OpenCode Go connector

1. Define a narrow HTTP/stdio connector protocol with health, capabilities, request ID, cancellation and one result per request.
2. Run the connector in a supervised child process or explicitly configured remote endpoint.
3. Enforce environment, network and credential scope through Apexo's Location/Permission services.
4. Add crash/restart backoff and connector generation fencing.
5. Keep the integration opt-in and expose a disabled/unavailable state when the binary is missing.

## 7. Test matrix and acceptance criteria

- Schema/API: every status transition, malformed callback, expired attempt, duplicate callback and unknown provider.
- Security: state/PKCE replay, redirect rejection, secret redaction, revoked credential, unauthorized Location and connector scope escape.
- Persistence: restart during browser callback, token exchange and capability refresh; exactly one credential commit.
- Provider: model catalog refresh, stale snapshot, rate limit, timeout, invalid response and provider removal.
- CLI/Desktop: login from settings and command line, approval denial, callback completion, logout, restart and readable recovery action.
- OpenCode Go: unavailable binary, handshake mismatch, process crash, cancellation, timeout, duplicate request ID and graceful shutdown.

Definition of done: an auth attempt survives process restart, can be cancelled, never leaks a secret, and produces the same final credential/capability state in CLI, Desktop, HTTP and ACP. A provider connector can be disabled without affecting native providers or the Session execution core.

## 8. Risks and dependencies

- Depends on #177 for durable operation IDs, event cursors, restart recovery and owner fencing.
- Depends on #188 for ACP/MCP compatibility rules and on #187 for plugin capability manifests.
- OS keychain integration may require platform-specific adapters and migration from existing private files.
- Provider APIs may not expose stable subscription or quota information; capabilities must distinguish authoritative fields from advisory metadata.
