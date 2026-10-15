# Native MCP Resources

Status: accepted through focused live-source tests and real native Session
execution on the CLI and packaged Desktop backend. App picker integration and
new visual attachment-rendering acceptance are outside this slice.

## Gap and reference evidence

Before this slice, native MCP owns connection lifecycle and dynamic tools, and
already renders embedded resource blocks returned by tool calls. It has no
standalone resource catalog, template catalog, or read capability. The native
App resource query intentionally returns an empty result. Compatibility
Sessions already register `list_mcp_resources`,
`list_mcp_resource_templates`, and `read_mcp_resource` with read permissions.

The pinned reference source's
`crates/codegen/xai-grok-shell/src/extensions/mcp.rs` provides the resource-read
extension and a paginated resource-provider bridge. Its extension preserves all
text/blob blocks and metadata, while the provider bridge selects one supported
block. These are distinct behaviors.

An isolated installed 1.0.52 probe passed six checks with three provider calls:
setup without provider work, captured tool advertisement/search, preservation
of three text/blob blocks, metadata preservation, empty-result error, and
unknown-server error. The observed resource search returned no matching tools.
The probe therefore verifies extension reads, not advertisement or execution
of the canonical resource tools. Apexo does not invoke the reference runtime.

## Native implementation

Core MCP exposes passive resource-server discovery, guarded catalog/template
requests, and guarded reads. The canonical tools use Apexo Session and Agent
identity and existing `read` permission checks before any resource request.
Permission resource names retain the `mcp:<server>:<uri>` vocabulary. Percent,
colon, wildcard characters, and backslash in the server namespace are escaped
so saved whole-server permissions remain literal. URI text stays opaque and
is never dereferenced as a host filesystem path.

Catalog requests preserve metadata and server identity, follow even an empty
cursor, detect cursor cycles, and bound requests to 1,000 pages, 1,000 entries,
and 1 MiB of catalog JSON. The combined catalog has the same entry/byte limits.
An all-server catalog reports explicit per-server failures alongside successful
entries; a selected-server failure fails the operation. Disconnected or
resource-incapable servers are not connected implicitly.

Reads preserve every returned block and metadata in the structured output.
Model output retains block order: text, supported PDF/image attachments, and an
explicit omission notice for unsupported binary attachment types. Accepted
content is limited to 128 blocks, 10 MiB aggregate decoded/text content, and
16 MiB serialized response. SDK protocol validation can reject malformed
responses before native content validation. These are accepted-response limits,
not a claim that remote transports stream-validate every byte before parsing.

Requests use the configured timeout, interruption, and Location runtime guard.
Connection identity and health are checked again before publishing results,
including earlier servers while a later catalog request is pending.
A crashed in-flight read cannot become successful output after reconnection;
a new invocation uses the current connection. Passive status reads do not
request resources or reconnect a disconnected server.

No raw resource-read HTTP API or App resource picker is added. Template values
are expanded by the caller into a concrete URI before invoking the read tool;
this slice does not add a general URI-template expansion engine. Subscription
notifications and automatic resource-content replay are outside this slice.

## Verification

The isolated Core overlay passed `bun typecheck`, including the focused test
source. Live `packages/core` and `packages/apexo` typechecks also passed after
integration. After application, `bun test test/v2/mcp-resources-native.test.ts` from
`packages/apexo` passed **8 tests and 59 assertions** against the live Core
implementation and real stdio SDK servers. It verifies
catalog/template pagination, URI expansion by the caller, text/blob order and
metadata, denied reads with zero resource RPCs, literal namespace permissions,
page/item/byte/cycle limits, combined catalog limits, partial errors, malformed
and oversized content, guard exclusion, cancellation, timeout, crash/recovery,
and cleanup of every traced child, with zero provider calls.

`bun script/grok-mcp-resources-native.mjs cli` and
`bun script/grok-mcp-resources-native.mjs desktop`, both from `packages/apexo`,
each passed **11 scenarios with 20 provider calls**. The shared isolated shell
fixture exercised native Session admission, provider tool advertisement, actual
canonical tool execution, and provider continuation. It verified both catalog
pages and template pages; four ordered persisted text/blob blocks and metadata;
text, image bytes, and unsupported-binary omission text in the model follow-up;
three permission-denied tools with zero resource RPCs; a crashed pending read;
failed automatic and explicit reconnect attempts; successful explicit recovery;
disabled/disconnected servers remaining disconnected; and process cleanup.

The Desktop result uses the coordinated compiled Electron backend, not an App
window or an alternate source server. Every owned child process and fixture
backend was reaped. No App rendering or picker code changed. Current whole-suite
gates are tracked separately and must not be inferred from these scoped results.

Fixture corrections are tracked separately in
[BUG-20261015-010](testing/test-fixtures/mcp-resource-capability-registration.md)
and
[BUG-20261015-011](testing/test-fixtures/mcp-resource-validation-layer.md).
The repeated native message-order fixture error is recorded in
[BUG-20261014-143](testing/test-fixtures/native-feedback-message-order.md).
