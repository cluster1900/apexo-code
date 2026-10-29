# Computer Use Acceptance Record

## Bug ID

`COMPUTER-USE-001`

## Affected scope

Computer Use in the V2 HTTP service, CLI `/computer` commands, Desktop `/computer` commands, and the legacy Desktop model tool loop.

## Observed behavior

The first Desktop automatic-tool fixture returned an `invalid` tool error even though the model requested `computer`. The Desktop compatibility registry did not expose the new Computer Use tool. A second fixture failure came from using V2 `permissions` in a V1 Desktop configuration file; the V1 loader rejected the file before the session could start.

## Expected behavior

The model must be able to invoke `computer.open` automatically in both CLI and Desktop model loops. Desktop compatibility fixtures must use the V1 `permission`/`provider` configuration dialect, while V2 CLI fixtures use `permissions`/`providers`.

## Reproduction

1. Build Desktop with `bun run build` in `packages/desktop`.
2. Run `bun run script/computer-desktop-v1-auto.mjs` from `packages/apexo` with a model fixture that emits a `computer` tool call.
3. Before the fix, the transcript records `Model tried to call unavailable tool 'invalid'`.

## Root cause

Computer Use was initially registered only in the V2 built-in tool graph. The legacy `packages/apexo/src/tool/registry.ts` used by Desktop compatibility sessions did not include the tool or its location-scoped Computer service.

## Fix

The V1 registry now exposes an Apexo-owned Computer adapter and resolves the Core Computer service through the location service map. The adapter applies the existing permission callback to destructive actions and returns screenshot attachments. The acceptance fixtures keep V1 and V2 provider/permission configuration shapes separate.
The native capture path creates the per-session artifact directory before invoking `screencapture`; read-only open/observe/screenshot operations do not request destructive approval, while input actions do.

## Verification

- `bun run script/computer-slash-ui.mjs cli` passes with CLI autocomplete, manual open/screenshot/close, and an automatic model-triggered open.
- `bun run script/computer-slash-ui.mjs desktop` passes with Desktop Playwright autocomplete and manual open/screenshot/close, including four durable events.
- `bun run script/computer-desktop-v1-auto.mjs` passes with a Desktop model-triggered `computer.open` and a completed tool result whose status is `ready`.
- `bun run script/computer-native-probe.mjs` passes through authenticated CLI API access and reports the native `macos-accessibility` backend.
- `bun test test/computer-command.test.ts test/browser-command.test.ts` passes in `packages/sdk/js`.
- `bun run test:httpapi` passes coverage, auth, and effect modes with 357 scenarios, 0 failures, and 0 missing routes.
- `bun turbo typecheck --concurrency=2` and both generated-source checks pass. The exact `GITHUB_ACTIONS=false bun turbo test --concurrency=2` gate was run after the change; the Computer Use related tests and the corrected PTY regression passed, while one unrelated parallel batch later failed with the existing native `PluginBundleRuntime.Failure` fixture-load race. Its ACP/MCP tests pass in isolation (54/54).

## Remaining limitations

The native backend currently targets macOS Accessibility APIs and `cliclick` for input. Other platforms return a typed unavailable status; native permission prompts must be granted by the user before input actions can succeed.
