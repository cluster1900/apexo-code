# Computer Use host integration regressions

## BUG-20261116-006: xAI rejects a tool choice without tool definitions

- Scope: the OpenAI Responses lowering path used by native xAI requests, including final provider turns after an agent reaches its tool allowance.
- Observed: a live `xai/grok-4.7` TextEdit run reached the configured provider-turn allowance and failed with HTTP 400: `A tool_choice was set on the request but no tools were specified`.
- Expected: the final text-only provider turn can summarize the outcome without another tool call.
- Reproduction: prepare/send an xAI Responses request with no tool definitions and `toolChoice: "none"`; native Session final-turn lowering produces this combination.
- Root cause: the Responses protocol omitted an empty `tools` list but still emitted `tool_choice: "none"`.
- Fix: omit that no-op choice when definitions are absent. Preserve explicit choices when tool definitions are present and preserve other choice modes.
- Verification: `bun test test/session/llm-responses-tool-choice.test.ts` from `packages/apexo` passed two request-compilation regression tests with four assertions. The live `bun script/computer-use-live.mjs cli smoke` then used a one-step agent with no permitted tools and successfully received `TOOLLESS_XAI_DONE` from xAI. Live TextEdit, Calculator, long-document scrolling, and vision scenarios passed separately; the request regression alone does not certify them.

## BUG-20261116-007: Desktop V2 startup used an obsolete CLI command

- Scope: Desktop's existing V2 background-CLI adapter.
- Observed: a newly packaged macOS app with `APEXO_SIDECAR_V2=1` could start the daemon, but `awaitInitialization()` failed because `apexo-cli service get password` returned `Unknown subcommand "get"`.
- Expected: retrieve the daemon's configured password and connect the packaged client to its native backend.
- Reproduction: build/stage the current CLI with `APEXO_SIDECAR_V2=1`, package the app, and launch that variant with isolated test state.
- Root cause: the Desktop adapter retained an older command shape; the CLI declares `service password`.
- Fix: invoke `service password`. Password output remains redacted by the existing adapter logger.
- Verification: after rebuilding and repackaging, `bun script/computer-use-ui.mjs desktop` from `packages/apexo` passed five checks: owned native backend startup, real Session UI, UI installation/activation of the downloaded plugin, real tool/task result display, and Stop settlement. The test used the packaged `.app` and its staged compiled V2 CLI, not a source-only window.

## BUG-20261118-003 — The compatibility backend leaves plugin data unresolved

- Scope is default Desktop, the legacy Session API in the mixed server, and enabled plugin bundles that use a host-owned data directory.
- The affected Desktop Session explicitly requested Computer Use and recorded no desktop tool calls. `computer-use:desktop` failed its stdio handshake with `MCP error -32000: Connection closed`. The launcher wrote `AGENT_DESKTOP_HOME must be absolute` to stderr. The adjacent `vercel:vercel` server independently reported `needs_auth`.
- Install the pinned `computer-use` 0.1.0 catalog bundle in a default Desktop project, apply it and inspect the MCP status. An existing idle Session should be able to discover and call the local tools on its next turn. OAuth state on other servers should remain independent.
- Compatibility configuration read enabled bundle paths without holding a plugin data lease or passing the resolved data path to the bundle loader. The launcher received the literal data token in its environment. Without a connected MCP process, the tools were absent from the Session.
- Compatibility configuration now captures the installed snapshots and substitutes the owned data paths. Instance teardown finishes consumer finalizers before releasing the data lease. Overlapping disposal callers join the same teardown. The V1 status panel displays the local connection error on its own row and shows the OAuth prompt on the remote server's row.
- An isolated mixed CLI used the already-published dual-architecture bundle pinned at `0a59c784a1663f6d10029f62a347348325dbe2f5`. The test created a V1 Session and sent an initial turn, then installed and applied the bundle through `/plugins/manage` and `/plugins/reload`. The local server reported `connected` and passed disconnect/reconnect. The same Session used `search_tool` and `use_tool`, with the durable tool result containing upstream version `1.3.1`. A loopback remote MCP remained in `needs_auth` with zero authorization requests and grants. The provider was a local fixture, and the original Session was inspected read-only.
- Run `COMPUTER_USE_BUNDLE=<extracted-catalog-bundle> bun script/computer-use-compat.mjs` from `packages/apexo` to repeat the mixed CLI test. The targeted Bun run of `test/mcp/lifecycle.test.ts`, `test/v2/plugin-data-native.test.ts`, and `test/v2/computer-use-profile.test.ts` passed 32 tests. The legacy stdio test records the data file's presence at disconnect while two disposal callers overlap, then confirms the retired epoch is removed.
- Packaged macOS arm64 Desktop with its default Node sidecar and the built Web Client against the mixed CLI each passed five UI checks. Both installed and applied the pinned bundle through Plugins, displayed a separate local failure and a remote OAuth prompt on their respective rows, disconnected and reconnected the Computer Use MCP through its row, and ran `desktop_version` in the same pre-install Session. Mini and fullscreen TUI also completed the real version call and recorded the result in native history.
- The November 19 follow-up reproduced the old launch error directly from the installed 0.1.0 launcher by providing the literal `${CLAUDE_PLUGIN_DATA}/agent-desktop` value. The fixed branch passed the compatibility test with a copy of that installation and with the downloaded 0.1.1 pin. The first 0.1.1 compatibility run timed out at the five-second handshake limit. The direct stdio handshake and a fresh isolated compatibility run passed afterward. The cause of the isolated timeout remains undetermined.
- `sh plugins/computer-use/script/verify-catalog.sh` verified all 17 published files, including both architecture bundles. Mini and fullscreen passed `bun script/computer-use-tui.mjs` and `bun script/computer-use-tui.mjs --fullscreen` with the downloaded 0.1.1 bundle. The real `desktop_version` result was recorded in native history in both layouts.

## BUG-20261118-004 — The V1 permission profile omitted compatibility tool names

- The generated `permissions-v1.json` used V1 config keys with the hashed tool names of the native V2 runtime. Loading it in a V1 Session left compatibility tool names governed by other agent rules.
- To reproduce, evaluate the distributed profile against `McpCatalog.toolName("computer-use:desktop", "desktop_version")` using the V1 evaluator. The V1 build agent should ask for the selected tools and deny unlisted desktop tools.
- The profile builder now includes both tool name forms. The native runtime keeps the same behavior when it migrates the V1 config. `bun test test/v2/computer-use-profile.test.ts` from `packages/apexo` verifies both evaluators, including the denial of unlisted desktop tools.
- Offline assembly from the pinned arm64 archive produced the updated profile. For a previously installed immutable bundle, the compatibility host fix works with its existing launcher. The updated permission file is produced by the branch's assembler.
- Catalog release 0.1.1 pins the rebuilt dual-architecture bundle at `b9fdaf2b415b0a09221ff1af7e5203d233a44c67`. Both upstream archive attestations and all 17 assembled checksums passed. Apexo fetched 0.1.0 and 0.1.1 from their respective Git pins during an install and update test with a synthetic legacy OpenCode data root. The plugin ID, data epoch, and data file were preserved by the update.
- After Apexo Skills PR #3 merged, a fresh isolated Apexo registry discovered the built-in source, refreshed its public catalog, and installed the exact 0.1.1 pin. Direct stdio launches returned upstream version 1.3.1 on arm64 and on x86_64 under Rosetta.
