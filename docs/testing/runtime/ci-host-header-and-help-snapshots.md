# BUG-20261020-001 — Loopback Host header check rejected wildcard local bind addresses (`0.0.0.0`, `::`, `[::]`) and CLI help snapshots missed new `run`/`export` flags

- **Bug ID**: `BUG-20261020-001`
- **Category**: Runtime & Test Snapshots (`runtime`)
- **Affected Scope**:
  - `packages/apexo/src/server/routes/instance/httpapi/server.ts`
  - `packages/apexo/test/cli/help/__snapshots__/help-snapshots.test.ts.snap`
- **Occurrences**: 1 independent CI episode (GitHub Actions run `39358208731` on PR `#41`).

## Observed Behavior

1. In GitHub Actions workflow `test` (`apexo tests (4/6)`, `(5/6)`, `(6/6)`), tests that connect via `HttpServer.formatAddress(server.address)` or `HttpServer.addressFormattedWith` under `NodeHttpServer.layerTest` (`test/server/httpapi-sdk.test.ts`, `test/server/httpapi-pty.test.ts`, `test/server/httpapi-v2-pty.test.ts`, `test/e2e/v2-mcp-attachment.e2e.test.ts`) received `403 Forbidden: Invalid Host header` or timed out waiting on WebSocket/HTTP connections.
2. `test/cli/help/help-snapshots.test.ts` failed on `apexo run --help` and `apexo export --help` snapshot comparisons after adding Grok Build CLI parity flags (`--wait-for-background`, `--background-wait-timeout`, `apexo export [sessionID] [output] --format --clipboard`).

## Expected Behavior

1. `isAllowedLoopbackHostHeader` in `packages/apexo/src/server/routes/instance/httpapi/server.ts` permits wildcard local bind literals (`0.0.0.0`, `::`, `[::]`) formatted by `NodeHttpServer.layerTest` while still rejecting external DNS hostnames (such as `evil.attacker.com:4096`) to prevent DNS rebinding.
2. `test/cli/help/__snapshots__/help-snapshots.test.ts.snap` matches the current `apexo run --help` and `apexo export --help` output.

## Reproduction Steps

Run in `packages/apexo`:

```sh
bun test test/cli/help/help-snapshots.test.ts test/server/httpapi-pty.test.ts test/server/httpapi-v2-pty.test.ts test/e2e/v2-mcp-attachment.e2e.test.ts test/server/httpapi-sdk.test.ts
```

## Root Cause

1. `NodeHttpServer.layerTest` binds without an explicit hostname, so `server.address` resolves to `{ hostname: "0.0.0.0", port }` and `HttpServer.formatAddress(server.address)` returns `http://0.0.0.0:<port>`. Requests sent to that URL carry `Host: 0.0.0.0:<port>`, which `isAllowedLoopbackHostHeader` did not include in its allowlist.
2. `packages/apexo/test/cli/help/__snapshots__/help-snapshots.test.ts.snap` was not regenerated after adding the Grok Build CLI parity options to `apexo run` and `apexo export`.

## Fix

1. Add `0.0.0.0`, `::`, and `[::]` to `isAllowedLoopbackHostHeader` in `packages/apexo/src/server/routes/instance/httpapi/server.ts`.
2. Regenerate `packages/apexo/test/cli/help/__snapshots__/help-snapshots.test.ts.snap` for `apexo run --help` and `apexo export --help`.

## Verification

- `bun test test/cli/help/help-snapshots.test.ts` in `packages/apexo`: 1/1 pass (44 assertions).
- `bun test test/server/httpapi-pty.test.ts test/server/httpapi-v2-pty.test.ts test/e2e/v2-mcp-attachment.e2e.test.ts test/server/httpapi-sdk.test.ts` in `packages/apexo`: 34/34 pass (142 assertions).
- `bun test test/server/native-cors.test.ts` in `packages/apexo`: DNS rebinding `Host: evil.attacker.com:4096` rejection continues to pass.
