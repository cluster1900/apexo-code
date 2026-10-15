# BUG-20261015-066: MCP Status Refetch Discarded Authorization Controls

- Status: integrated and verified. Live browser and actual native window each passed nine checks.
- Occurrences: one product authoring episode.
- Scope: native MCP manager rows while an explicit authentication flow waits.

The actual browser Authenticate action opened the bound local authorization page. Returning to the manager showed Waiting and Cancel, but the Open/Copy controls and readonly authorization link had disappeared. The native start returned successfully and the flow remained waiting; the fixture timed out on the missing readonly input.

The list used newly allocated `Object.entries` tuples as Solid `For` identities. Status refetches rebuilt those tuples and remounted the authentication component, discarding its transient authorization URL. The manager now keys rows by stable server name and reads current status through row props. The authentication component still clears the transient URL when its flow ID changes or becomes inactive. Stable server names do not authorize retaining a URL across a different flow/configuration identity.

Verification uses the real private production browser with a native-only server and held local issuer. It asserts Open/Copy/input survive a status refresh, then exact cancellation removes the old input. A separately started replacement flow also clears the stale link while preserving the new flow's Cancel action, without opening another browser page. App typecheck passed after the correction. Final browser and native-window results are recorded separately in the feature notes. This is distinct from the stable top-level terminal-root rule; no recurrence count is inferred.

Integrated verification on 2026-10-15: Live browser and actual native window each passed nine checks. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
