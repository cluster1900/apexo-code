# BUG-20261015-064: OAuth Completion Detail Fell Below the Terminal Viewport

- Status: integrated and verified. Both live native PTY sizes passed five checks; captures inspected.
- Occurrences: one draft product defect.
- Scope: shared MCP action panel with many server rows in a narrow terminal.

A real 80-column, 24-row PTY contained seventeen configured servers. The title and action rows remained intact, and waiting feedback was visible. After successful consent saved credentials, the extra saved-credentials sentence pushed `Authentication: credentials_ready` below the scroll viewport. The backend had completed; the screen had not made the completion state visible. The acceptance timed out on that visible state. This differs from Workflow BUG-20261015-046: fixed rows did not shrink or overlap here.

The list row budget now reserves space for selected authentication details. PageUp/PageDown and Home/End also allow inspection of overflow without changing the selected server. The stable outer container and nonshrinking action rows remain intact. No provider work is added.

Reproduce with `bun script/grok-native-mcp-oauth-tui.mjs` from `packages/apexo`, using the real native-only server and local OAuth fixture. The `--fullscreen` variant uses the expanded panel. Retained terminal screens and header/control geometry assertions establish visibility; source text presence alone is not sufficient. Final scoped results are recorded in the OAuth feature acceptance notes. No recurrence or new constraint is claimed.

Integrated verification on 2026-10-15: Both live native PTY sizes passed five checks; captures inspected. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
