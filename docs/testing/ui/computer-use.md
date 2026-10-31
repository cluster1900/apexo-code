# Computer Use Acceptance Record

> Historical record: the implementation described below predates the third-party provider migration. The active service uses Cua Driver for host input and Cua/Lume for isolated execution; retain these steps only as evidence for the original regression.

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
The former native capture path created the per-session artifact directory before invoking `screencapture`; read-only open/observe/screenshot operations did not request destructive approval, while input actions did. The current provider path delegates capture and input to Cua Driver or Lume and keeps the same session-level permission boundary.

## Verification

- `bun run script/computer-slash-ui.mjs cli` passes with CLI autocomplete, manual open/screenshot/close, and an automatic model-triggered open.
- `bun run script/computer-slash-ui.mjs desktop` passes with Desktop Playwright autocomplete and manual open/screenshot/close, including four durable events.
- `bun run script/computer-desktop-v1-auto.mjs` passes with a Desktop model-triggered `computer.open` and a completed tool result whose status is `ready`.
- `bun run script/computer-native-probe.mjs` passes through authenticated CLI API access and reports the native `macos-accessibility` backend.
- `bun test test/computer-command.test.ts test/browser-command.test.ts` passes in `packages/sdk/js`.
- `bun run test:httpapi` passes coverage, auth, and effect modes with 357 scenarios, 0 failures, and 0 missing routes.
- `bun turbo typecheck --concurrency=2` and both generated-source checks pass. The exact `GITHUB_ACTIONS=false bun turbo test --concurrency=2` gate was run after the change; the Computer Use related tests and the corrected PTY regression passed, while one unrelated parallel batch later failed with the existing native `PluginBundleRuntime.Failure` fixture-load race. Its ACP/MCP tests pass in isolation (54/54).

## Remaining limitations

The former backend targeted macOS Accessibility APIs and `cliclick` for input. The current backend targets Cua Driver on the host and Lume through the Cua SDK for isolated macOS execution. Other platforms return a typed unavailable status; provider availability and native permission prompts must be satisfied before input actions can succeed.

## Bug ID

`COMPUTER-USE-002`

## Affected scope

Bare `/computer` dispatch from the Desktop prompt and the CLI footer, including command catalogs that contain a colliding server command name.

## Observed behavior

Typing `/computer` in Desktop could be routed through the generic server-command path or treated as a command with an empty argument. The local handler was therefore skipped, even though `/computer open` worked. The CLI parser also treated the bare command as help instead of entering Computer Use.

## Expected behavior

`/computer` is the explicit manual trigger and must open the guarded Computer Use session on both surfaces. A server command with the same name must not shadow the local Desktop control.

## Root cause

Desktop's registered-slash filter gave every name present in the server command catalog precedence. The shared Computer parser also required an explicit `open` action.

## Fix

The local slash filter reserves `browser` and `computer` for the Desktop controls, and the Computer parser maps an omitted action to `open`. The acceptance fixture now exercises the bare command in both CLI and Desktop Playwright paths and keeps a separate Desktop V1 automatic tool-loop check.

## Verification

- `APEXO_COMPUTER_BACKEND=fixture bun run script/computer-slash-ui.mjs cli` passes with bare `/computer`, autocomplete, screenshot, close, and automatic tool invocation.
- `APEXO_COMPUTER_BACKEND=fixture bun run script/computer-slash-ui.mjs desktop` passes with bare `/computer`, Playwright autocomplete, screenshot, close, and automatic tool invocation.
- `bun run script/computer-desktop-v1-auto.mjs` passes with a Desktop V1 model-triggered `computer.open`.
- `bun test test/computer-command.test.ts test/browser-command.test.ts` passes in `packages/sdk/js`.
- `bun typecheck` passes in `packages/app`, `packages/core`, and `packages/apexo`; the focused App slash-route test was attempted with both `--conditions=browser` and `--conditions=solid` but is blocked before collection by the repository's existing `solid-js` `jsxDEV` export mismatch under Bun 1.4.4.
