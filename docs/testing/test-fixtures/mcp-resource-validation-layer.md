# MCP Resource Fixture Validation-Layer Expectation

- **Bug ID:** BUG-20261015-011
- **Scope:** The isolated draft malformed-base64 resource assertion; not a shipped product defect.
- **Status:** Corrected and verified in isolated and live-source tests.
- **Independent occurrences:** 1.

## Observed and expected behavior

A deliberately malformed base64 response failed with `load`, while the test
expected the native content validator's `invalid` code. Both paths must reject
the malformed response without exposing content to the model.

## Reproduction

Return `blob: "invalid!"` from the real stdio fixture and call native
`readResource`. Expecting every malformed response to reach the native
post-response validator reproduces the assertion failure.

## Root cause and correction

The MCP SDK validates the protocol response before returning it. Its base64
validation rejects this payload first, so the native boundary reports a
sanitized request failure. The assertion now expects `load` for this SDK
validation case. Separate real responses still exercise native `invalid`
errors for empty content, excessive block count, and excessive content bytes.
No production validation was relaxed.

## Verification

The corrected malformed-base64 assertion and the native content-limit cases
pass in the isolated implementation suite. The final isolated command and
counts are recorded in the native MCP resources feature note. The final isolated `bun test ./resources.test.ts` run passed 8 tests and
59 assertions. The live `bun test test/v2/mcp-resources-native.test.ts` run from
`packages/apexo` also passed 8 tests and 59 assertions.
