# GitHub Issues #16–#36: CLI Headless Signals, Stdin, Loopback Host Header, Inline `<think>` Blocks, and Desktop UI Fixes

- **ID**: `BUG-20261019-501` through `BUG-20261019-521`
- **Status**: Fixed
- **Verified Occurrences**: 21 reported GitHub issues (`#16`–`#36`)

## Summary of Issues and Root Causes

1. **`BUG-20261019-501` (`#16`: `apexo run` hangs indefinitely when stdin is a non-TTY open pipe even with a positional message)**
   - **Scope**: `packages/apexo/src/cli/cmd/run/runtime.stdin.ts`, `packages/apexo/src/cli/cmd/run.ts`, `packages/apexo/src/cli/native-local.ts`
   - **Observed**: Spawning `apexo run "hello"` with a default pipe stdin (`stdio: ["pipe", "pipe", "pipe"]`) that the parent never closes hung forever in `Bun.stdin.text()`.
   - **Expected**: When a positional message or `--command` is already supplied, an idle open pipe with no immediate data returns `""` within 50ms and pauses/unrefs `process.stdin`.
   - **Root Cause**: `readPipedStdin()` unconditionally awaited `Bun.stdin.text()` whenever `!process.stdin.isTTY`.
   - **Fix**: Added `readPipedStdin(hasPositionalInput = false)` using a 50ms first-chunk timer when positional input is already present, calling `process.stdin.pause()` and `process.stdin.unref?.()` on timeout.

2. **`BUG-20261019-502` (`#17` & `#23`: `SIGINT` / `Ctrl+C` in `apexo run` leaks background child process group, leaves tool call in `running` state, and times out under Bun 1.4.2)**
   - **Scope**: `packages/apexo/src/cli/cmd/run.ts`, `packages/apexo/src/session/processor.ts`, `packages/apexo/test/lib/cli-process.ts`
   - **Observed**: Sending `SIGINT` to `apexo run` during a `bash` tool call left the spawned child process group running and exited before `ShellTool`'s interruption handler finished updating the tool state. Additionally, `cli-process.ts` spawned `"bun"` from `PATH` instead of `process.execPath`.
   - **Expected**: `SIGINT`/`SIGTERM` aborts the active session, awaits `ShellTool` process-group termination (`-pid`) and tool part state settlement, and exits with code 130 (`SIGINT`) or 143 (`SIGTERM`).
   - **Root Cause**: `run.ts` had no `SIGINT`/`SIGTERM` handler for the non-interactive SDK client loop, and `processor.ts` `cleanup` did not await `Deferred.await(call.done)` when interrupted.
   - **Fix**: Added `SIGINT`/`SIGTERM` handlers in `run.ts` that call `sdk.session.abort`, wait up to 3.5s for loop completion, and exit 130/143; updated `processor.ts` `cleanup` to await `call.done` up to 3.5s; updated `cli-process.ts` to spawn `process.execPath`.

3. **`BUG-20261019-503` (`#18`: `apexo serve` lacks Host header validation against DNS rebinding on loopback)**
   - **Scope**: `packages/apexo/src/server/routes/instance/httpapi/server.ts`
   - **Observed**: Requests to a loopback-bound `apexo serve` (`127.0.0.1` / `localhost` / `::1`) with `Host: evil.example.com` returned `200 OK`.
   - **Expected**: Reject requests with non-loopback, non-whitelisted `Host` headers with `403 Forbidden: Invalid Host header`.
   - **Root Cause**: Only CORS `Origin` headers were checked; simple GET/POST requests without CORS preflight bypassed origin checks under DNS rebinding.
   - **Fix**: Added `hostHeaderProtection(corsOptions)` middleware in `server.ts` that validates the `Host` header hostname against loopback addresses and configured CORS origins.

4. **`BUG-20261019-504` (`#19`: Unknown model returns generic 500 `Unexpected server error` instead of actionable error and `apexo models` hint)**
   - **Scope**: `packages/apexo/src/server/routes/instance/httpapi/middleware/error.ts`, `packages/apexo/src/session/prompt.ts`
   - **Observed**: Requesting an unknown model ID returned HTTP 500 `Unexpected server error. Check server logs for details.` on HTTP routes and lacked a hint to run `apexo models`.
   - **Expected**: Return HTTP 400 with `ProviderModelNotFoundError` details and include `Run \`apexo models\` to list available models.`.
   - **Root Cause**: `Provider.ModelNotFoundError` was not matched in `middleware/error.ts` before falling through to the generic 500 defect handler.
   - **Fix**: Handled `Provider.ModelNotFoundError` and `Provider.InitError` as HTTP 400 in `middleware/error.ts` and appended `Run \`apexo models\` to list available models.` in `session/prompt.ts`.

5. **`BUG-20261019-505` (`#20`, `#24`, `#28`: OpenAI-compatible models emitting `<think>...</think>` inside `text-delta` leak raw tags into `apexo run` stdout, `--format json`, and Desktop chat)**
   - **Scope**: `packages/apexo/src/session/processor.ts`, `packages/session-ui/src/components/message-part-text.ts`
   - **Observed**: Models like `MiniMax-M2.7` that emit `<think>...</think>` inside standard `text-delta` chunks instead of `reasoning-delta` leaked raw `<think>` tags into `text` parts and `apexo run` stdout.
   - **Expected**: Leading `<think>...</think>` blocks in `text-delta` are parsed into a `reasoning` part (`__inline_think__`) and stripped from visible `text` parts.
   - **Root Cause**: `processor.ts` treated all `text-delta` chunks as plain text without inspecting leading `<think>...</think>` blocks.
   - **Fix**: Added stateful leading `<think>...</think>` extraction in `processor.ts` (`text-start`/`text-delta`/`text-end`/`cleanup`) that creates/updates an inline `reasoning` part and emits only post-`</think>` content to `ctx.currentText`, plus `stripInlineThink` in `message-part-text.ts` for any historical stored messages.

6. **`BUG-20261019-506` (`#21`: `apexo run` exits `0` when a tool call is auto-rejected due to permission request)**
   - **Scope**: `packages/apexo/src/cli/cmd/run.ts`, `packages/apexo/test/cli/run/run-process.test.ts`
   - **Observed**: When `permission.asked` was auto-rejected in non-interactive `apexo run`, stderr printed `permission requested: ...; auto-rejecting` but the process exited with code `0`.
   - **Expected**: Exit with non-zero code (`1`) when a permission request is auto-rejected in headless mode.
   - **Root Cause**: `permission.asked` handler in `run.ts` logged a warning and rejected the permission without setting `error`.
   - **Fix**: Set `error = \`permission requested: \${permission.permission} (\${patterns}); auto-rejected\`` in `run.ts` so `process.exitCode = 1`.

7. **`BUG-20261019-507` (`#22`: `README.md` missing Custom OpenAI-Compatible Provider configuration example)**
   - **Scope**: `README.md`
   - **Fix**: Added a `Custom OpenAI-Compatible Providers` section with a complete `~/.config/apexo/apexo.jsonc` example (`@ai-sdk/openai-compatible`, `baseURL`, `env`, `models`) and `apexo models` verification command.

8. **`BUG-20261019-508` (`#25`: Desktop turning OFF "Auto-accept permissions" still auto-edits files without prompting)**
   - **Scope**: `packages/app/src/context/permission.tsx`, `packages/app/src/components/prompt-input/submit.ts`
   - **Observed**: Toggling off the shield icon ("Auto-accept permissions") in Desktop only changed client-side auto-response state; the backend session kept default `"allow"` rules and never emitted `permission.asked`.
   - **Expected**: Sync session permission rules (`edit` and `bash` `"ask"` when off, `"allow"` when on) with the server session on toggle and on session creation.
   - **Fix**: Updated `permission.tsx` (`syncSessionPermissionRules`) and `submit.ts` to push `permission` rules via `sdk.client.session.update`.

9. **`BUG-20261019-509` (`#26`: Desktop prompt input drops characters after clearing and first `Ctrl+A` on multiline fails to select all)**
   - **Scope**: `packages/app/src/components/prompt-input.tsx`, `packages/app/src/context/prompt.tsx`
   - **Fix**: Made `withSuspense` in `prompt.tsx` synchronous when `session().ready()` is already true, avoided unnecessary DOM resets on simple single-text-node input in `prompt-input.tsx`, and handled `Ctrl/Cmd+A` explicitly via `document.createRange()` + `selectNodeContents(editorRef)`.

10. **`BUG-20261019-510` (`#27` & `#28`: Desktop streaming text overlap, missing spaces around inline code, duplicate `Thinking` header, and `aria-hidden` focus warning)**
    - **Scope**: `packages/app/src/pages/session/timeline/message-timeline.tsx`, `packages/app/src/pages/session/timeline/rows.ts`, `packages/session-ui/src/components/markdown.tsx`, `packages/session-ui/src/components/message-part.tsx`, `packages/session-ui/src/components/markdown.css`
    - **Fix**: Added `blur()` before hiding inactive keep-alive pages in `message-timeline.tsx`, preserved whitespace text nodes in `markdown.tsx` morphdom hook, collapsed `reasoning` rows once assistant text or tool parts appear unless expanded (`rows.ts`), and rendered a clean `Thinking` collapsible header in `message-part.tsx`.

11. **`BUG-20261019-511` (`#29`: Desktop Hooks panel shows "has not been captured yet" unless `runtimeProfile === "grok-build"`)**
    - **Scope**: `packages/apexo/src/session/prompt.ts`, `packages/apexo/src/server/routes/instance/httpapi/handlers/hooks.ts`
    - **Fix**: Captured hook snapshots for all sessions in `prompt.ts` and lazily captured on `GET /session/:sessionID/hooks` when `!current.captured`.

12. **`BUG-20261019-512` (`#30`: Desktop Command Sandbox dialog copy on Linux + first click swallowed after closing dialog)**
    - **Scope**: `packages/ui/src/context/dialog.tsx`, `packages/app/src/components/command-sandbox-dialog.tsx`, `packages/app/src/i18n/en.ts`
    - **Fix**: Removed the 100ms lingering overlay and `startTransition` delay on dialog close/open in `dialog.tsx`, updated `commandSandbox.scope` to describe both macOS `seatbelt` and Linux `bubblewrap`, and hid the redundant "No sandboxed command has run..." empty state when `profile === "off"`.

13. **`BUG-20261019-513` (`#31`: Desktop Side Question, Workflows, and Goal dialogs have unstyled controls and raw `[object Object]` token usage)**
    - **Scope**: `packages/app/src/components/side-question-dialog.tsx`, `packages/app/src/components/workflow-dialog.tsx`, `packages/app/src/components/session-goal.tsx`
    - **Fix**: Styled inputs, selects, textareas, and file upload buttons across all three dialogs, used `fit` dialog sizing, and formatted `entry.tokens` as a clean numeric sum in `session-goal.tsx`.

14. **`BUG-20261019-514` (`#32`: Desktop Settings > General hides Appearance below the fold, lacks scrollbar, and sticky "General" header overlaps scrolled content)**
    - **Scope**: `packages/app/src/components/settings-general.tsx`, `packages/app/src/components/settings-v2/general.tsx`, `packages/app/src/components/settings-v2/settings-v2.css`, `packages/app/src/components/dialog-settings.tsx`, `packages/app/src/i18n/en.ts`
    - **Fix**: Moved `<AppearanceSection />` to the top of `Settings > General`, added a distinct `Preferences` heading to `GeneralSection`, removed sticky positioning on the `General` tab header so it scrolls cleanly, and enabled visible scrollbars.

15. **`BUG-20261019-515` (`#33`: Desktop `≡` menu has non-clickable "Apexo" heading and session list is hard to discover from session view)**
    - **Scope**: `packages/app/src/components/windows-app-menu.tsx`, `packages/app/src/components/titlebar.tsx`
    - **Fix**: Replaced the static `Apexo` group label in `WindowsAppMenu` with top-level clickable `Projects and sessions` and `New Session` items, and updated the `grid-plus` titlebar button tooltip to `Projects and sessions`.

16. **`BUG-20261019-516` (`#34`: Desktop slash menu missing descriptions for `/tasks`, `/goal`, `/hooks`, `/sandbox`, `/feedback`, `/workflow`)**
    - **Scope**: `packages/app/src/components/background-tasks.tsx`, `session-goal.tsx`, `session-hooks.tsx`, `session-command-sandbox.tsx`, `session-feedback.tsx`, `session-workflow.tsx`
    - **Fix**: Added localized `description` fields to all six command registrations.

17. **`BUG-20261019-517` (`#35` & `#36`: Desktop diff header shows leading slash `/hello.py` for project-root files and overlaps sticky `Edit` header on narrow viewports)**
    - **Scope**: `packages/session-ui/src/components/message-part.tsx`, `packages/session-ui/src/components/message-part.css`
    - **Fix**: Added `relativizeProjectPath` in `message-part.tsx` to strip project root and leading slashes, hid the directory span when empty, and removed nested sticky positioning on `[data-component="tool-Part-wrapper"] [data-slot="Sticky-accordion-header"]`.

## Verification

- `bun turbo typecheck --concurrency=2`: `21 successful, 21 total`
- `packages/app`: `bun run test:unit` -> `88 pass, 0 fail`
- `packages/client`: `bun run check:generated` -> exit `0`
- `packages/sdk/js`: `bun run check:generated` -> exit `0`
- `packages/apexo`: `bun test test/cli/run/run-process.test.ts` -> all pass
