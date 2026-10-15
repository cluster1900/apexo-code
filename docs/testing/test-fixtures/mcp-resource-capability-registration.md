# MCP Resource Fixture Capability Registration

- **Bug ID:** BUG-20261015-010
- **Scope:** The isolated draft native MCP resource stdio fixture; not a shipped product defect.
- **Status:** Corrected and verified in isolated and live-source tests.
- **Independent occurrences:** 1.

## Observed and expected behavior

The unsupported-resource assertion expected `unsupported` but received `load`.
A connected server advertising only tools should remain connected and explicitly
reject resource access as unsupported.

## Reproduction

Run the native MCP resource fixture with the `tools-only` mode while registering
resource request handlers unconditionally. Run the focused catalog test and
request resources from that server.

## Root cause and correction

The MCP SDK rejects resource handler registration when the server does not
advertise the resource capability. The test process therefore exited before
initialization. This tested a failed connection rather than an unsupported
capability. The fixture now registers resource handlers only when it advertises
resources. Production behavior was unchanged for this correction.

## Verification

The isolated implementation test now verifies a connected tools-only server
returns `unsupported`; unknown servers return `not_found`. The same suite
verifies pagination, read permissions, content bounds, cancellation, recovery,
and child-process cleanup. The final isolated command and counts are recorded in
the native MCP resources feature note. The final isolated `bun test ./resources.test.ts` run passed 8 tests and
59 assertions. The live `bun test test/v2/mcp-resources-native.test.ts` run from
`packages/apexo` also passed 8 tests and 59 assertions.
