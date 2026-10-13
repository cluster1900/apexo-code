---
name: apexo-httpapi-contract
description: Use when changing a public Protocol or Server HttpApi, endpoint schema, handler, middleware contract, or generated client surface.
---

# Protocol and Server HttpApi

Read `packages/apexo/src/server/routes/instance/httpapi/AGENTS.md` and the nearest package instructions before editing.

## Workflow

1. Locate the source Protocol/Server `HttpApi` definition and its endpoint group. Keep domain and storage services free of HttpApi types.
2. Use `HttpApiBuilder.group(...)` for declared endpoints, including SSE. Use `handleRaw(...)` only when the declared endpoint needs the raw request/response, such as WebSocket upgrades.
3. Declare explicit SDK-visible error schemas and translate domain errors at the handler boundary.
4. Provide stable services at the layer boundary; do not rebuild layers inside handlers or use request context to smuggle stable services.
5. Update source definitions, then run `bun run generate` from `packages/client`.
6. Never edit `packages/client/src/generated` or `src/generated-effect` directly.

## Checks

Run `bun run check:generated` in `packages/client`, package-local typecheck/tests, and `bun run test:httpapi` in `packages/apexo`. Keep runtime dependencies directed Schema → Core/Protocol → Server; Client may depend on Schema/Protocol but never Core/Server.
