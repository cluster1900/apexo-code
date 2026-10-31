# Browser task main-session routing record

## Bug ID

`BROWSER-COMPUTER-USE-004`

## Affected scope

Free-form `/browser <task>` routing in the CLI, TUI, and Desktop, plus the Browser slash-command acceptance harness.

## Observed behavior

Free-form Browser requests could be routed through a hidden Browser-only child session. The browser action itself could succeed, but the active transcript did not show the model's Browser calls, observations, or final result. The CLI direct route also bypassed the normal prompt queue, so the user's `/browser` request was not written to terminal scrollback before the model responded. The Desktop acceptance harness additionally loaded a stale `packages/app/dist` bundle and treated its Browser child session as the main route. After that routing fix, Desktop could still show only the submission toast: its V2 message request used the global SDK without the session's directory, and the first request could legitimately return an empty projected page while the admitted input was still being promoted.

## Expected behavior

The normal agent should execute a Browser task in the current Session. The user should immediately see the submitted `/browser` request, then the Browser tool call, provider result, screenshot or artifact, permission state, and final response in the same transcript. Structured `/browser open`, `/browser click`, and related commands must keep their existing protocol and event behavior. An empty early projection must not leave the timeline permanently blank or issue a zero-sized page request.

## Reproduction

1. Start the local CLI or Desktop fixture with the Browser provider configuration.
2. Enter `/browser inspect <fixture-url> through CDP <endpoint> and report the page title`.
3. Inspect the session list and message stream while the task runs.
4. Run the structured `/browser open`, `/browser type`, `/browser click`, `/browser screenshot`, and `/browser close` sequence.

## Root cause

The command surfaces had separate routing logic and some paths created a Browser child session. The CLI's V2 runtime also needed to admit the prompt through the native V2 session path; using the legacy prompt helper did not produce a visible V2 turn. The direct CLI route bypassed `runPromptQueue.onSend`, so it also bypassed the local scrollback row. The Desktop acceptance script retained a child-session assertion after the implementation had moved to main-session routing, and its static frontend bundle had not been rebuilt after the source change. The app's shared session cache then used the global SDK for V2 message pages, which omitted `directory` and read the default location. A newly admitted prompt can also be absent from the projected message page until the runner promotes it, so an immediate empty page was cached as complete and a forced refresh later attempted `limit=0`.

## Fix

Added one shared `browserTaskPrompt` helper in the SDK and made CLI, TUI, and Desktop submit that instruction to the current V2 Session. Removed the built-in hidden Browser agent and its prompt. The CLI now records the submitted `/browser` request in scrollback, starts the session event stream before admission, and leaves the existing provider/tool events to render normally. The Desktop and existing-session command paths add the admitted prompt optimistically so the request is visible before projection, while the event reducer replaces it with the durable message. The shared V2 message adapter resolves each session's `location.directory`, caches the directory, and uses the directory-scoped SDK; page loads retain at least the initial page size so an empty early projection cannot produce `limit=0`. Kept the structured Browser parser, service, provider adapters, permissions, events, artifacts, and close behavior unchanged. Updated the acceptance script to configure the local provider explicitly, require a root `build` session, assert the visible CLI request and Desktop transcript, and remove the obsolete existing-session child-task check.

## Verification

- `bun script/browser-slash-ui.mjs cli` passes with `/browser` autocomplete, real CDP attach, type, click, screenshot artifact, visible main-session Browser task, and close.
- `bun run build` passes from `packages/app` before the Desktop harness is started.
- `bun script/browser-slash-ui.mjs desktop` passes with Home autocomplete, a new root `build` session, visible main-session Browser task, structured actions, screenshot artifact, and close.
- `bun script/computer-slash-ui.mjs cli` and `bun script/computer-slash-ui.mjs desktop` pass with autocomplete, automatic/manual Computer routing, mutation, and screenshot artifacts.
- `bun test ./src/utils/server-protocol.test.ts` passes from `packages/app` (4 tests).
- `bun test test/agent/agent.test.ts test/tool/registry.test.ts` passes from `packages/apexo`.
- `bun typecheck` passes from `packages/apexo`, `packages/app`, `packages/tui`, and `packages/sdk/js`.
- `bun run build` passes from `packages/desktop`.

## Test-environment note

The focused `packages/app/src/context/sync.test.ts` test remains blocked by the installed Solid test runtime: both the direct command and the repository's Solid conditions fail before test collection with `Export named 'jsxDEV' not found` from `solid-js/dist/solid.js`. This is a harness/module-resolution failure; the Browser and Computer Playwright/terminal acceptance scenarios and the app typecheck complete successfully.

## Remaining limitations

The test provider deterministically returns a Browser action; it verifies routing and visible provider results but does not measure live-model planning quality for a long multi-step task. The Browser service still owns the existing Stagehand-first and Playwright CDP compatibility paths; this change only changes task admission and transcript visibility.
