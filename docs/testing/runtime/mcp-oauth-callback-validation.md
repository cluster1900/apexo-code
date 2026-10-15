# BUG-20261015-041: MCP OAuth Callback State and URL Validation

- Status: integrated and verified. Live 29-test implementation gate and CLI/Desktop acceptance passed.
- Scope: native MCP OAuth callback and explicit authorization lifecycle.
- Occurrences: one draft authoring episode. No shipped regression is claimed.

## Observed and expected behavior

A real callback with 64 non-ASCII state characters threw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH; a raw absolute-form HTTP request with an invalid authority threw ERR_INVALID_URL. Both escaped the isolated HTTP handler. Expected: reject invalid input safely, leave no unowned listener or pending operation, and permit a later valid explicit start.

## Reproduction and cause

The callback trusted JavaScript character length before comparing encoded byte buffers and constructed a URL from an unvalidated request target. The regression exercises the actual OAuth flow and a real local HTTP callback, not a duplicated validation helper.

## Correction

Validate request-target parsing before URL construction and compare encoded byte lengths before timingSafeEqual. Invalid requests receive HTTP400 without exchanging a code.

## Verification

From the isolated Apexo package, run `bun test test/v2/mcp-oauth-flow.test.ts`. Before correction, the non-ASCII and invalid-redirect targeted run had zero passes and two failures; the malformed absolute-form callback separately failed with ERR_INVALID_URL. Corrected focused store/flow coverage passed 18 tests. Final package integration and full acceptance remain pending.

Final private source verification passed 29 tests and 142 assertions across all four OAuth implementation test files. The real private CLI additionally passed eleven checks with three provider calls; packaged Desktop/live integration remains pending.

Integrated verification on 2026-10-15: Live 29-test implementation gate and CLI/Desktop acceptance passed. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
