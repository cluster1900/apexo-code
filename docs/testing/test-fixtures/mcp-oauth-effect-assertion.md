# BUG-20261015-048: Promise Effect Wrapped a Non-Promise Assertion

- Status: integrated and verified. Live 29-test implementation gate passed.
- Scope: native MCP OAuth management cancellation test.
- Occurrences: one authoring episode.

## Observation and cause

The cancellation test reached a closed callback listener, but its `Effect.promise` callback directly returned Bun's `expect(...).rejects.toThrow()` result. That assertion returned `undefined`, so Effect attempted to call `.then` on it. The run reported 21 passes and one failure; this did not establish a product cancellation failure.

## Fix and verification

Use an explicit async callback and await the assertion so the Effect boundary receives a real Promise. Run `bun test test/v2/mcp-oauth-native.test.ts test/v2/mcp-oauth-flow.test.ts test/v2/mcp-oauth-store.test.ts` from the isolated Apexo package. The corrected focused run passed 22 tests with 112 assertions. This is not a recurring constraint or shipped product defect.

Integrated verification on 2026-10-15: Live 29-test implementation gate passed. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
