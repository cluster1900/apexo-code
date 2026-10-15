# BUG-20261015-051: OAuth Eligibility Rejected Ordinary HTTP MCP

- Status: integrated and verified. Live transport regression passed in the 29-test gate.
- Occurrences: one authoring episode.
- Scope: native Core MCP remote transport integration.

## Observed and expected behavior

A real unauthenticated HTTP MCP server bound to a private interface became failed before transport initialization. Existing ordinary transport behavior must remain available after additive OAuth support.

## Root cause and fix

OAuth credential observation applied the new HTTPS-or-loopback policy to every remote server, accidentally restricting ordinary existing HTTP transport support. Separate OAuth eligibility from ordinary MCP transport support. Unsupported OAuth produces a per-server capability status; unauthenticated HTTP continues using its existing transport.

## Verification

Run `bun test test/v2/mcp-oauth-transports.test.ts` from the isolated Apexo package. Both real transport tests failed before correction and both passed after correction (7 assertions). HTTP used the host's actual private interface; an initial attempt to bind an unconfigured secondary loopback address was rejected by macOS and was not counted as product evidence. No external service or user credentials were used.

Final private source verification passed 29 tests and 142 assertions across all four OAuth implementation test files. The real private CLI additionally passed eleven checks with three provider calls; packaged Desktop/live integration remains pending.

Integrated verification on 2026-10-15: Live transport regression passed in the 29-test gate. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
