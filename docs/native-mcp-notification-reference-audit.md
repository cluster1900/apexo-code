# MCP catalog notification reference boundary

Status: audited on 2026-10-15; automatic catalog relisting is not a migration
requirement established by this evidence. No relisting implementation was added.

The pinned Grok source emits tool/resource list-change events and coalesces them
into status notifications. Its MCP dispatcher uses a 50 ms window keyed by server
and event kind. Tool and resource changes map to ready/config-changed status;
the dispatcher does not fetch replacement catalogs.

An isolated installed 1.0.52 run on 2026-10-14 sent a burst of 100 tool-list-change
notifications after adding a tool on the test server. It observed one status push.
The server's `tools/list` request count remained one before notification, after
notification, after an ordinary catalog read, and after an explicit fresh read.
The returned catalog still contained only the original tool. A historical test
label containing “relist observed” was ambiguous; the recorded numeric evidence
shows **no relist**. Resource/template notification behavior was not independently
measured in that installed run.

Relevant pinned source locations are
`crates/codegen/xai-grok-mcp/src/servers.rs` (list-change callbacks) and
`crates/codegen/xai-grok-shell/src/session/mcp_dispatcher.rs` (coalescing and
status mapping). This is behavioral reference evidence, not verification of
Apexo or a dependency on the foreign runtime.

Apexo's native tool catalog currently changes on connection preparation, retry
and reload. Forwarding/coalescing advertised list-change status notifications
is the demonstrated reference capability to consider separately. Automatically
fetching and replacing tool catalogs would be an additional capability, not a
missing feature proven by this comparison, and is excluded from the migration
scope here.

Native resource and template tools already fetch a fresh catalog on each explicit
authorized call. Their Session read permission check precedes the first resource
RPC. Unsolicited background relisting would bypass that boundary; this audit does
not authorize it or introduce a cache, raw resource API, implicit connection,
provider turn or content subscription.

See [native MCP runtime](native-mcp-runtime.md) for the surrounding accepted
runtime scope. The observation applies to installed 1.0.52 and the pinned source;
it does not establish behavior in later releases.
