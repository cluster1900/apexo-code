# Native installed plugin activation

Apexo's native runtime activates trusted installed bundle agents, commands, embedded skills, hook sources, and MCP tools from the shared global plugin store. Catalog installation and enablement describe stored configuration; `GET /api/plugins/runtime` reports what the selected Location has actually activated.

The runtime response includes `generation`, `active` plugin IDs, and an optional failure. The status read is passive. `POST /api/plugins/reload` returns `true` on successful activation without starting provider work. Active work in the same Location produces a typed busy response. Other Locations remain independent.

Bundle files and schema validation are staged first. Agent, command, and skill state transforms prepare private drafts before publication. The runtime holds their writer permits and the Location admission gate until it synchronously publishes the prepared state and bundle generation. A validation, load, or unsupported-component failure keeps the previous effective generation and persists a failure for subsequent status reads. A busy attempt does not overwrite that failure. Interrupted preparation releases the gate and writer permits.

The Location guard covers native Session drains, native idle control operations including compaction, and compatibility managed loops. Nested child drains share read admission without blocking each other. Workflow source/agent resolution and side-question snapshot assembly are also guarded; side-question sampling then uses the captured immutable inputs.

Captured Session hook registries remain immutable across plugin runtime reload. New Sessions and explicit Session hook reloads see the current activated sources. Native hook consumers retain both installed and host sources. Compatibility's existing ordinary plugin loader remains authoritative for installed hooks, so its HostHookSnapshot adapter consumes only host sources to avoid duplicate dispatch. Compatibility installed-plugin lifecycle has not been changed to native per-Session reload semantics.

MCP bundle components now activate through the [native MCP runtime](native-mcp-runtime.md), including staged tool registrations and transport retirement. LSP bundle components still produce an explicit unsupported failure before runtime publication. An incompatible installed bundle cannot prevent native Location startup: startup reports an empty bundle generation with the failure. Native LSP remains a separate feature deliverable.

## Verification

Run from `packages/apexo` using the pinned Bun version:

```sh
GITHUB_ACTIONS=false bun test test/plugin/host-hook-snapshot.test.ts test/v2/plugin-runtime-guard.test.ts test/v2/plugin-bundle-runtime.test.ts
```

The frozen-source run passed 10 tests and 47 assertions. It verifies cancellation after reader registration, interrupted reload release, unrelated Location independence, private prepared state, preservation on preparation failure, actual installed agent/command/skill content, real hook command execution across explicit Session reload, nonfatal unsupported startup, and compatibility duplicate-dispatch prevention. Core and Apexo package `bun typecheck` both exited successfully.

`bun script/grok-plugins-native.mjs cli` and `bun script/grok-plugins-native.mjs desktop` each passed 13 scenarios with three provider calls, including a real native skill tool call. The Desktop run used the newly rebuilt Electron backend. Both covered trust, explicit activation, busy/invalid/unsupported reload preservation, disable/enable, update, process restart and uninstall. The installed Grok 1.0.52 lifecycle comparison passed ten checks; it does not establish native component execution or installed-reference mid-session reload.

The native-only production browser and actual macOS Desktop window each passed eight checks, including simplified and traditional Chinese, enabled-versus-active status, unsupported reload preservation and failure-to-success recovery. The shared native terminal panel passed six checks in both compact and expanded PTYs. These narrow terminal harnesses do not prove complete native-only terminal startup. Existing compatibility mini/fullscreen app flows each passed eight checks. No provider work was triggered by these management interactions.

Relevant records: [optional skill description](testing/runtime/plugin-embedded-skill-optional-description.md), [compatibility duplicate hook dispatch](testing/runtime/compat-installed-hook-double-dispatch.md), and [scoped temporary fixture dependencies](rules/scoped-temp-fixture-spawner.md).
