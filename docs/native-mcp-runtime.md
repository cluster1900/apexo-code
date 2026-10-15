# Native MCP runtime

Apexo Core owns native MCP connections, tool registration, permissions, and retirement. The generic MCP SDK supplies protocol and transport support; Grok is used only in isolated comparison runs. No native feature invokes Grok.

`GET /api/mcp` reports a Location's current server map. Each server has `status` (`connected`, `disabled`, `failed`, or `needs_auth`), a nonnegative tool count, and an optional sanitized error. It exposes no command, environment, authentication header, or client object. The read starts no provider work. Base configuration connection failures remain visible per server and do not prevent unrelated native Sessions from running.

Supported connections are local stdio processes, remote Streamable HTTP, and legacy HTTP/SSE fallback. Explicit remote headers are supported. An HTTP authentication challenge reports `needs_auth`; interactive OAuth setup and token management are not implemented in this native slice.

Installed trusted bundle MCP servers activate with agents, commands, skills, and hook sources through `POST /api/plugins/reload`. Connections and tool schemas are prepared privately before publication. A failed or interrupted candidate preserves the previously published bundle and tool generation. A failed installed bundle at startup falls back to an empty bundle generation with a visible activation failure while configured base servers initialize independently. LSP bundles still fail explicitly as unsupported.

Reload reconnects cached effective host configuration and freshly staged installed bundle files. It does **not** rediscover changed host configuration files. Catalog enablement and active runtime status remain separate until reload. Active native drains, compaction/control operations, compatibility managed loops, and direct native MCP tool calls hold Location admission. Reload returns busy while those readers are active; other Locations remain independent. Nested child drains do not deadlock the barrier.

Publication and old-generation retirement settle under the Location gate. New registrations carry distinct identities, and previously captured tool handles cannot execute a replacement generation. A transport cleanup failure is surfaced as a defect rather than hidden; if retirement fails after publication, the new generation is already published. This is not a claim that external process effects can be rolled back.

Each native tool uses the canonical ToolRegistry and PermissionV2 boundary with its actual Session, agent, message, and call context. Input JSON Schema is validated before execution; provider-visible schemas retain the server's original schema. Tool results pass through central output bounding. Request cancellation reaches the SDK, startup/request deadlines are bounded, stderr is drained without exposing server secrets, stdio frames are bounded across chunk boundaries, and Location retirement waits for forced direct-child closure. POSIX process-group cleanup is tested with a real descendant. Windows process-tree shutdown is implemented but has not been validated by this macOS acceptance run.

Captured Session hook registries retain their generation across bundle runtime reload. Explicit Session hook reload remains the boundary for adopting newly activated hook sources.

## Runtime controls

`POST /api/mcp/:server/connect`, `/disconnect`, and `/retry` take a Location query and no request body. They return `true` on success. Unknown configured names return 404, active Location work returns 409, and connection failures return sanitized typed errors. Reading status and using these controls start no model work.

Connect can activate a configured-disabled server and is idempotent while it is healthy. Disconnect withdraws only the selected server. Retry prepares a replacement privately, verifies its liveness, publishes its tools, and retires its predecessor under the Location gate. Other servers retain their transports. A failed or cancelled replacement preserves a healthy previous connection and its tools; the action returns the failure. When no healthy connection exists, status reports `failed` or `needs_auth` with zero tools.

These controls change runtime state only. Successful explicit connection/disconnection overrides survive bundle reload while that server remains configured, then reset when its definition disappears or its Location restarts. They do not change host configuration or durable preferences. The isolated Grok comparison confirms a deliberate difference: Grok's toggle writes a personal preference that survives process restart. Apexo labels these operations Connect, Disconnect, and Retry rather than implying persistent enablement.

## Automatic stdio recovery

After a previously connected local stdio child exits unexpectedly, its tools become unavailable immediately. A Location-owned worker waits 1, 4, and 16 seconds between at most three connection attempts. Busy native work postpones an attempt until the Location is idle without consuming an attempt or starting provider work. Each successful attempt privately stages a fresh connection and tool identity before publication. Exhaustion leaves a visible failed status and zero tools; explicit Retry can recover it.

Accepted manual controls cancel the previous automatic worker before staging. A failed manual replacement preserves a healthy predecessor and its future recovery eligibility; a failed manual attempt on an already dead predecessor leaves it parked. Rejected busy controls change neither worker nor runtime state. Explicit disconnect, successful reload, replacement-token checks, and Location shutdown prevent old workers from resurrecting retired connections. Initial startup failures and remote transport failures do not enter this automatic stdio ladder.

Native `mcp.status.changed` events carry only an optional configured server name and explicit Location. Consumers re-read current status instead of applying a status snapshot from the event. State changes and reload publication emit invalidation; worker shutdown is bound to the owning Location.

The isolated installed Grok 1.0.52 run confirmed successful stdio recovery and three failing restart attempts at approximately 1.335, 5.466, and 21.598 seconds after the observed death, followed by exhaustion. The pinned source specifies the 1/4/16-second delays. The same installed run received one coalesced configuration-change push after 100 tool-list notifications but made no additional `tools/list` request, including after a fresh catalog read. Therefore this slice does not add automatic tool-catalog refresh.

## Remaining capabilities

Native OAuth setup, persistent connection preferences, remote automatic reconnect, initial-startup retries, tool-catalog refresh, and MCP prompt/resource browsing remain separate work. App/TUI manager acceptance is tracked separately from the backend checks below. These controls do not close every MCP parity item.

## Verification

Run from `packages/apexo` with the pinned Bun version:

```sh
bun test test/v2/mcp-native.test.ts test/v2/plugin-bundle-runtime.test.ts test/v2/plugin-runtime-guard.test.ts
bun test test/server/httpapi-location-lifetime.test.ts test/effect/app-node-builder-v1.test.ts
bun script/grok-mcp-native.mjs cli
bun script/grok-mcp-native.mjs desktop
bun script/grok-mcp-official.mjs
bun script/grok-mcp-controls-native.mjs cli
bun script/grok-mcp-controls-native.mjs desktop
bun script/grok-mcp-controls-official.mjs
```

The final MCP and Instance shutdown batch passed 10 tests and 48 assertions, including a real compatibility-service replacement that must not affect native MCP. The bundle activation test passed, the guard suite passed 6 tests and 15 assertions, and the shared-map lifetime plus explicit replacement tests passed 2 tests and 3 assertions. Core and Apexo package type checks passed.

Native CLI and the final rebuilt Electron Desktop backend each passed eight checks with seven real provider requests: passive status, activation without provider work, a real MCP call, failed candidate retention, successful replacement, process restart, disable removal from a fresh provider request, and uninstall. Both final runs include the native service-identity repair. This backend acceptance does not claim native MCP management UI coverage.

The isolated installed Grok 1.0.52 comparison passed three checks with four provider requests, including a real stdio call and its result returned to the provider. The reference initializes MCP asynchronously and exposes discovery/execution tools; Apexo directly registers native tools. This comparison does not establish reference mid-session reload parity.

The full authorization gate exposed an interrupted Instance-load settlement bug. Its repair passed all 277 authorization scenarios including process shutdown and 12 lifecycle tests with 26 assertions. The migrated compatibility fixture batch passed 264 tests with two existing skips and 1,053 assertions after separating native and compatibility MCP service identities.

Relevant records: [framing byte limit](testing/runtime/native-mcp-stdio-frame-limit.md), [forced child shutdown](testing/runtime/native-mcp-forced-shutdown.md), [authentication classification](testing/runtime/native-mcp-auth-classification.md), and [shared Location map ownership](testing/runtime/compat-location-map-lifetime.md), and [Instance shutdown settlement](testing/runtime/instance-load-shutdown-settlement.md), and [native service identity](testing/runtime/native-mcp-service-identity.md).

The final shared checkpoint passed all six unit/build tasks (3906 tests passed, 19 skipped, one todo, zero failures), all 21 serialized typecheck tasks, and all 277 HTTP scenarios in each of coverage, authorization and Effect-handler modes. These gates include the Instance settlement and MCP identity repairs.

The runtime-controls batch passed 13 native MCP/shutdown tests with 72 assertions and eight bundle/guard/shared-map tests with 38 assertions. New real stdio tests cover target-only replacement, exact stale-tool identity, failed and cancelled retries, late predecessor closure, and an independently executing second Location while the first stages a suspended retry. Native CLI acceptance passed nine checks with nine provider requests, including active-drain and idle-compaction rejection, successful and failed target replacement, sibling isolation, unchanged host config, and restart reset. The rebuilt Electron Desktop backend passed the same nine checks with nine provider requests. Core and shared Apexo type checks passed after the concurrent Goal service-capture and integration repairs.

The installed Grok controls comparison passed five checks with four provider requests. It verified persisted disable and enable preferences across separate processes and actual tool execution after re-enable. Its initial response-envelope fixture mistake is recorded in [BUG-20261014-216](testing/test-fixtures/mcp-controls-reference-envelope.md). This comparison establishes the persistence difference; it does not claim Grok shares Apexo's busy barrier or replacement transaction semantics.

The subsequent controls/role/localization integration checkpoint passed 3920 unit
tests (19 skips, one todo, zero failures), all six Turbo tasks, all 21 serialized
typecheck tasks and all 280 HTTP scenarios in each of the three gate modes, with
successful process shutdown. Native manager App/browser/window and terminal
acceptance is recorded in [MCP management acceptance](mcp-management-acceptance.md).

The reconnect-focused native suite passed 12 tests and 97 assertions. It exercises real stdio death, a held Location admission boundary, concurrent work in a second Location, status-event/current-read recovery, stale handles, reload/disconnect/shutdown fences, three-attempt exhaustion, and failed manual supersession. The installed-reference reconnect script passed six checks with four provider requests. Run `bun script/grok-mcp-reconnect-official.mjs` from `packages/apexo` to repeat the isolated comparison. The fixture binding repair is recorded in [BUG-20261014-134](testing/test-fixtures/native-delete-services.md). Native CLI reconnect acceptance passed nine checks with nine provider requests, including live HTTP event invalidation and recovery reads, active-drain and idle-compaction deferral, exhaustion, and explicit restart. The guard/shutdown suite passed nine tests and 22 assertions, and both Core and shared Apexo package type checks passed. Run `bun script/grok-mcp-reconnect-native.mjs cli` to repeat native acceptance; The coordinated rebuilt Electron Desktop backend passed the same nine checks with nine provider requests, including the live HTTP status-event recovery path. Run `bun script/grok-mcp-reconnect-native.mjs desktop` against the coordinated artifact to repeat it.

After the subsequent LSP transport and native project-bootstrap fixes, the final coordinated Desktop artifact passed the reconnect suite again: nine checks and nine provider requests, including current status reads after SSE invalidation, admission deferral, exhaustion and shutdown fences. The acceptance process completed and was reaped.
