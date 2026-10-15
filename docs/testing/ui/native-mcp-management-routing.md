# BUG-20261014-243: Native MCP management used archived compatibility routes

- **Scope:** App MCP loading, status popover, MCP selection dialog, and terminal management.
- **Status:** Package types and complete scoped interaction acceptance verified; repository gates tracked separately.
- **Observed:** Source inspection found that native App connections used an archived MCP list/control API, while resource loading queried an unsupported native catalog. The popover advertised authentication through compatibility endpoints for native authentication-required connections. Failed loads could appear as an empty server list. The mini terminal lacked the MCP manager entry point.
- **Expected:** Native connections use Apexo's native status and explicit runtime control routes. Unsupported authentication setup and resources are represented honestly. Loading errors remain visible and retryable.
- **Reproduction:** Open MCP management against a native-only server with a configured stdio server; inspect request routes and failed-load rendering. Inspect an authentication-required server without native OAuth support. The discovery above is a source audit, not a claimed historical native-window reproduction.
- **Root cause:** The existing presentation and synchronization adapters assumed archived compatibility management contracts; native tool execution had been added separately.
- **Fix:** Route native status and connect/disconnect/retry through the generated native SDK. Keep runtime changes explicit and temporary. Share a native App manager between the dialog and status popover, expose refresh/loading/error states, suppress unsupported resource requests, and provide a shared mini/fullscreen terminal manager. Compatibility management remains routed to its own API.
- **Verification:** Client and legacy SDK regeneration, Server typecheck and corrected TUI typecheck passed. CLI and rebuilt Desktop controls passed nine checks each, and the installed comparison passed five. Browser/native-window and both terminal modes passed the interaction checks below. No equivalence to durable preferences or native OAuth is claimed.
- **Independent occurrences:** Zero historical runtime incidents; one source-audit finding during this implementation.

## Completed interaction acceptance

TUI typechecking passed. Both native shared terminal panel sizes passed seven
checks; actual compatibility mini/fullscreen entries passed four each. Production
browser and actual native window each passed ten checks across en/zh/zht, including
real controls, failed replacement retaining a healthy transport, recovery clearing
diagnostics, passive refresh, explicit outage handling and the authentication
boundary. See [MCP management acceptance](../../mcp-management-acceptance.md).
This originated in source inspection, not a historical failed production run.
