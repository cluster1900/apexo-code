# BUG-20261015-042: Rejected OAuth Start Retained Waiting Ownership

- Status: integrated and verified. Live 29-test implementation gate and CLI/Desktop acceptance passed.
- Scope: native MCP OAuth callback and explicit authorization lifecycle.
- Occurrences: one draft authoring episode. No shipped regression is claimed.

## Observed and expected behavior

A malformed configured redirect rejected Start but left a waiting flow installed, preventing a subsequent valid start. Expected: reject invalid input safely, leave no unowned listener or pending operation, and permit a later valid explicit start.

## Reproduction and cause

Redirect parsing happened after publishing the pending flow and outside its scoped cleanup chain. The regression exercises the actual OAuth flow and a real local HTTP callback, not a duplicated validation helper.

## Correction

Validate remote and redirect configuration before creating or publishing the flow or callback listener.

## Verification

From the isolated Apexo package, run `bun test test/v2/mcp-oauth-flow.test.ts`. Before correction, the non-ASCII and invalid-redirect targeted run had zero passes and two failures; the malformed absolute-form callback separately failed with ERR_INVALID_URL. Corrected focused store/flow coverage passed 18 tests. Final package integration and full acceptance remain pending.

Final private source verification passed 29 tests and 142 assertions across all four OAuth implementation test files. The real private CLI additionally passed eleven checks with three provider calls; packaged Desktop/live integration remains pending.

Integrated verification on 2026-10-15: Live 29-test implementation gate and CLI/Desktop acceptance passed. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
