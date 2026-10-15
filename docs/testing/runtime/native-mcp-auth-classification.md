# BUG-20261014-212: Native MCP HTTP 401 appeared as a generic connection failure

- **Scope:** Native remote MCP status on a server requiring authentication.
- **Observed:** The local HTTP/SSE integration test connected both supported transports, but an HTTP 401 server appeared as `failed` instead of `needs_auth`.
- **Expected:** An authentication challenge is explicit in the per-server status. Native OAuth setup remains unavailable; it must not be presented as a generic network failure or a connected server.
- **Reproduction:** From `packages/apexo`, run `GITHUB_ACTIONS=false bun test test/v2/mcp-native.test.ts`. The remote fixture exposes an HTTP 401 endpoint without configuring an SDK auth provider.
- **Root cause:** The adapter recognized only SDK UnauthorizedError. Without an auth provider, the SDK can report a transport error carrying numeric code 401 instead.
- **Fix:** Recognize SDK authorization failures and numeric transport code 401. Stop transport fallback for this classified authentication failure and publish `needs_auth` without exposing endpoint headers or secrets.
- **Verification:** Before the fix, the combined runtime/MCP run passed six tests and failed the authentication status assertion. The corrected focused MCP suite passed 6 tests and 36 assertions, including actual HTTP, SSE, authentication, cancellation, and candidate retention. One observed occurrence.
