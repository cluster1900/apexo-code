# Native MCP management acceptance

## Scope

The App MCP dialog and opt-in Status popover expose native project connection
status, tool counts, Connect, Disconnect, Retry and manual refresh. They explain
that changes are not saved and that native authentication setup is unavailable.
Backend error details remain server data. The terminal uses the same protocol
selection for its shared management panel: legacy health wins on mixed servers;
only a missing legacy API selects the native protocol.

These checks do not claim native OAuth setup, resource management or complete
native-only terminal bootstrap. The narrow/expanded native terminal harness
renders the production shared component against a real native-only server.
Separate mini/fullscreen tests launch the actual compatibility terminal and
invoke `/mcps`. Packaged backend contract checks are owned by the separate MCP
controls fixture; App acceptance uses the production renderer with an isolated
source-native server so native routing is unambiguous.

## Fixtures and observed results

Commands run from `packages/apexo` with pinned Bun 1.3.14:

| Command | Result |
| --- | --- |
| `bun script/grok-native-mcp-tui.mjs` | 7 checks passed, 80-column native panel |
| `bun script/grok-native-mcp-tui.mjs --fullscreen` | 7 checks passed, expanded native panel |
| `bun script/grok-mcp-tui.mjs` | 4 checks passed, actual mini compatibility entry |
| `bun script/grok-mcp-tui.mjs --fullscreen` | 4 checks passed, actual fullscreen compatibility entry |
| `bun script/grok-native-mcp-ui.mjs desktop --locales` | 10 checks passed, production browser, en/zh/zht |
| `bun script/grok-native-mcp-ui.mjs native --locales` | 10 checks passed, actual native window, en/zh/zht |

The helper runs the real native HttpApi, real stdio MCP children and a local HTTP
server returning 401. Opening either entry point performs passive reads without
starting new transport children or provider work. Controls have no request body.
A failed retry preserves a healthy existing connection and its tools; failed
connection without a healthy predecessor publishes failure, and a later retry
clears the displayed diagnostic. Runtime controls leave configuration bytes
unchanged. All completed runs reported zero provider calls and reaped owned
processes.

Manual refresh failure is tested with an explicitly injected HTTP 503 for the
status GET only. It is a transport-outage fixture, not fabricated MCP status.
The UI shows a request error rather than an empty inventory and recovers after
the outage ends. Native authentication has explanatory text and no OAuth action.
The browser also refreshes after an external real control and checks both
entry points in all three locales.

Browser screenshots were reviewed for English dialog, Simplified Chinese
popover and Traditional Chinese dialog. Native screenshots were also inspected for the English dialog and both Chinese
popovers, including the full authentication explanation and Retry control. The
manager can scroll to the last server in a short viewport; the native fixture
additionally captures that row.
The earlier native-only screenshots exposed an unrelated workspace reload error.
Native project list/current routes now correct that bootstrap defect; see
[BUG-20261014-274](testing/ui/native-project-bootstrap-api.md). Final production
browser and actual native-window reruns each passed 12 checks, including project
GET success and absence of the reload error. Final native screenshots were
visually inspected.

The same final runs cover canonical native status events and automatic stdio
reconnection: killing a real connected child makes its tools unavailable, then
updates the open panel on recovery without a management POST or manual refresh.
Both entry points and en/zh/zht remain covered, with unchanged configuration and
zero provider calls. Separate CLI and final rebuilt Desktop reconnect fixtures
each passed nine checks/nine provider requests; installed Grok passed six
comparisons/four requests. Catalog-notification relisting, OAuth, persistent
preferences and resources remain outside this accepted reconnect slice.

## Fixture corrections

- [BUG-20261014-252](testing/test-fixtures/goal-role-config-dialect.md): use one configuration dialect consistently.
- [BUG-20261014-233](testing/test-fixtures/mcp-status-visibility.md): enable the opt-in Status trigger through real settings before testing it.

The suspected nested-store recovery problem was not reproduced: both native
PTY sizes and the production browser explicitly checked that the previous
failure diagnostic disappeared after successful connection. No production
change was made on that suspicion. These scenarios do not claim coverage of
server removal, which is outside the connection-control operations.
