# Settings controls for MCP and permission approval

## BUG-20261119-001 — MCP settings actions did not reach the compatibility backend

- Scope covers the MCP tab in Settings when the client detects the V1 compatibility protocol, including the default Desktop backend.
- Open Settings from a session with a connected local stdio MCP server. Click Disconnect and read the server status. The button completed without a request and the server stayed connected. Connect and Retry used the same return path.
- The settings panel uses the shared MCP manager, which returned early for V1. The status popover uses a separate toggle operation. The compatibility backend's unresolved plugin data directory was a separate [startup failure](../runtime/computer-use-host-integration.md#bug-20261118-003--the-compatibility-backend-leaves-plugin-data-unresolved).
- The manager now uses V1 connect and disconnect for that protocol, maps Retry to Connect, and refreshes status and resources. V2 keeps its native lifecycle and persisted preferences.
- Reproduce with `bun script/grok-slash-ui.mjs cli --mcp` from `packages/apexo`. With the old settings handler, the new assertion timed out waiting for the real stdio server to become disabled.
- The rebuilt Web Client passed all seven checks in that script. A rebuilt macOS Electron window using its default Node sidecar also installed the published Computer Use 0.1.1 bundle and disconnected and reconnected it through Settings and the status popover. Both environments checked the actual backend status after the UI action.

## BUG-20261119-002 — Auto-accept was disabled when Settings opened without a session ID

- Scope covers Auto-accept permissions in the new Settings layout on Web and Desktop.
- Open a project draft before sending its first prompt and open General settings. The switch was disabled even though the draft already had a project directory. The same failure could occur from entry points that opened the dialog without passing a session ID.
- The controller required a session ID from the dialog caller and an already-loaded session lineage. It did not use the draft or selected project's directory.
- The switch now resolves the current route on its own. It uses the current session's directory and server for a session override, or the active draft's or selected project's directory and server for a project preference. Home without a selected project still requires one before changing approval behavior.
- Reproduce with `bun script/grok-slash-ui.mjs cli --permission-settings` from `packages/apexo`. On the previous build, the existing-session check passed and the draft assertion found a disabled switch.
- The rebuilt Web Client passed the session, draft, and unscoped Home checks. The rebuilt Electron window toggled an existing session and a draft. The existing session's effective stored Bash rule changed to allow and then returned to ask.
