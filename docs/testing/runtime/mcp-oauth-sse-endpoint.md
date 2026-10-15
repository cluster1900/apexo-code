# BUG-20261015-050: OAuth Fetch Rejected Same-Origin SSE Endpoints

- Status: integrated and verified. Live transport regression passed in the 29-test gate.
- Occurrences: one authoring episode.
- Scope: native Core MCP remote transport integration.

## Observed and expected behavior

A real unauthenticated SSE connection failed after the server announced a different same-origin message endpoint. Existing ordinary transport behavior must remain available after additive OAuth support.

## Root cause and fix

The OAuth transport adapter required every request URL to equal the configured stream URL, although SSE uses an announced message endpoint. Allow same-origin endpoint delegation; reject cross-origin endpoints before sending a request and do not follow redirects on credential-bearing requests.

## Verification

Run `bun test test/v2/mcp-oauth-transports.test.ts` from the isolated Apexo package. Both real transport tests failed before correction and both passed after correction (7 assertions). HTTP used the host's actual private interface; an initial attempt to bind an unconfigured secondary loopback address was rejected by macOS and was not counted as product evidence. No external service or user credentials were used.

Final private source verification passed 29 tests and 142 assertions across all four OAuth implementation test files. The real private CLI additionally passed eleven checks with three provider calls; packaged Desktop/live integration remains pending.

Integrated verification on 2026-10-15: Live transport regression passed in the 29-test gate. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
