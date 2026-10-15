# BUG-20261015-338: MCP client test teardown timed out during concurrent builds

- Scope: first focused MCP client adapter test run with Apexo's package preload.
- Observed: both test bodies passed (14 assertions), followed by an unnamed afterAll timeout at approximately 35 seconds. App, Desktop and Rust builds were concurrently consuming memory.
- Expected: test bodies and owned teardown complete within the package test timeout.
- Reproduction: the original command was `bun test test/v2/mcp-attachment-client.test.ts --timeout 30000` from `packages/apexo` during concurrent build validation.
- Root cause: unresolved. Host memory pressure was observed, but no causal teardown stack was captured; this record does not attribute the timeout to a product bug or a specific resource leak.
- Action: stopped and joined only the owned competing builds, then reran the focused tests. The rerun completed with two tests and 14 assertions in about 1.5 seconds. A later three-case run includes cancellation-retry coverage.
- Status: symptom retained as unresolved; a passing rerun alone does not prove a fix. No recurring rule added.
