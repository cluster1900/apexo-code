# BUG-20261015-065: OAuth Browser Fixture Queried the Consent Tab

- Status: integrated and verified. Live browser and actual native window each passed nine checks.
- Occurrences: one fixture authoring episode.
- Scope: browser automation after an explicit native MCP Authenticate action.

The actual App opened its local authorization page in a new tab. The fixture then waited for the manager's Cancel button in the active consent tab and timed out. Its captured image showed only the local consent form; native request evidence showed a successful start and status reads. This did not establish a product failure.

The fixture records the known manager tab identity before starting authorization and returns to that identity before querying manager controls or capturing localized screens. It does not infer tab identity from new-tab order. Authorization URLs are not written into command history or retained screenshots. Owned browser context and fixture services are closed on success and failure.

Reproduce and verify from `packages/apexo` with `bun script/grok-native-mcp-oauth-ui.mjs browser --locales`. Final scoped results are recorded in the OAuth feature acceptance notes. No recurring constraint is proposed.

Integrated verification on 2026-10-15: Live browser and actual native window each passed nine checks. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
