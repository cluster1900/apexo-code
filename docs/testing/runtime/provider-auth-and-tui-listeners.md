# Provider Auth Reuse, Antigravity User-Agent Model Gating, and TUI RootRenderable Listener Limit

## BUG-20261019-001 — Fullscreen TUI emits `MaxListenersExceededWarning` for `RootRenderable` `destroyed` listeners onto `stderr`

- **Affected scope**: `packages/tui/src/app.tsx`, `packages/apexo/src/cli/tui/worker.ts`
- **Observed behavior**: When opening dialogs or views in the fullscreen TUI (such as `/model` or navigating into a session) that push the total active `@opentui/keymap` layers above 10, Node/Bun writes `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 destroyed listeners added to [RootRenderable]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit` directly to `process.stderr`, corrupting the alternate-screen terminal buffer.
- **Expected behavior**: Mounting multiple keymap layers on `renderer.root` (`RootRenderable`) must not trigger `MaxListenersExceededWarning` or write warnings onto the terminal screen.
- **Reproduction steps**:
  1. Start `bun run src/index.ts` in `packages/apexo`.
  2. Open `/model` or navigate between views so more than 10 keymap layers register `target.once("destroyed", ...)` on `renderer.root`.
- **Root cause**: Each `@opentui/keymap` keymap scope registers a one-time `destroyed` listener on `renderer.root` (`RootRenderable`), which inherits `EventEmitter`'s default limit of 10 listeners per event.
- **Fix**: Increased `EventEmitter.defaultMaxListeners` to at least 100 in `packages/tui/src/app.tsx` and `packages/apexo/src/cli/tui/worker.ts`, and called `renderer.setMaxListeners(0)` and `renderer.root.setMaxListeners(0)` upon creating the CLI renderer.
- **Verification**:
  - `cd packages/apexo && bun -e '... PTY fullscreen TUI /model check ...'` -> `VERIFIED_TUI_MODELS_AND_NO_WARNING` (0 occurrences of `MaxListenersExceededWarning` or `destroyed listeners added` in raw PTY output).

## BUG-20261019-002 — Grok Build CLI OAuth session (`~/.grok/auth.json`) and Grok 4.5–4.7 models are not adopted by `xai` provider

- **Affected scope**: `packages/apexo/src/plugin/xai.ts`, `packages/apexo/src/plugin/index.ts`, `packages/core/src/plugin/provider/xai.ts`, `packages/apexo/test/plugin/xai.test.ts`
- **Observed behavior**: Users already authenticated in Grok Build CLI (`~/.grok/auth.json`) could not select Grok models in Apexo without re-authenticating, and Grok Build models (`grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`) were missing from the `xai` provider catalog.
- **Expected behavior**: Apexo should automatically adopt valid Grok CLI OAuth credentials from `~/.grok/auth.json` (respecting `GROK_HOME` and `Global.Path.home`), keep refreshed tokens synchronized, and expose Grok Build models (`grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`, plus `~/.grok/models_cache.json`) under the `xai` provider.
- **Reproduction steps**:
  1. Authenticate with Grok CLI so `~/.grok/auth.json` contains `oauth_token` and `refresh_token`, with no `xai` entry in `~/.local/share/apexo/auth.json`.
  2. Run `bun run src/index.ts models xai` in `packages/apexo` or open `/model` in the TUI.
- **Root cause**: `XaiAuthPlugin` only read Apexo's internal `auth.json` store and did not register a `provider.models` hook for the Grok Build model catalog (`grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`).
- **Fix**:
  - Added `readGrokCliAuth`, `writeGrokCliOAuth`, `readGrokCliModels`, and `syncGrokCliAuth` in `packages/apexo/src/plugin/xai.ts`.
  - Synced `~/.grok/auth.json` into Apexo's `Auth` service during `Plugin.init` (`packages/apexo/src/plugin/index.ts`) and synchronized refreshed OAuth tokens back to both stores.
  - Registered `provider.models` in `XaiAuthPlugin` and `ctx.catalog.transform` in `packages/core/src/plugin/provider/xai.ts` to populate `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`, and cached Grok CLI models.
- **Verification**:
  - `cd packages/apexo && bun test test/plugin/xai.test.ts` -> 15 pass, 0 fail.
  - `cd packages/apexo && bun run src/index.ts models xai` -> lists `xai/grok-4.5`, `xai/grok-4.6`, `xai/grok-4.7`, `xai/grok-4.7-build-fast`.
  - `cd packages/apexo && bun run src/index.ts run -m xai/grok-4.7-build-fast "Reply with the single word GROK_OK"` -> `GROK_OK`.

## BUG-20261019-003 — Antigravity provider omits latest models (`gemini-4-argon`, `gemini-3.8-flash`) due to legacy `User-Agent` header

- **Affected scope**: `packages/core/src/antigravity.ts`, `packages/apexo/src/plugin/antigravity.ts`, `packages/llm/src/protocols/antigravity.ts`, `packages/apexo/test/provider/antigravity.test.ts`
- **Observed behavior**: Even when reusing a valid Antigravity (`agy`) login session, `apexo models antigravity` and `/model` only listed older models and omitted `gemini-4-argon` (`Gemini 4 Argon`) and `gemini-3.8-flash` (`Gemini 3.8 Flash`).
- **Expected behavior**: Antigravity model discovery and inference should expose and execute the full set of models available to the Antigravity CLI, including `gemini-4-argon` and `gemini-3.8-flash`.
- **Reproduction steps**:
  1. Log in with `agy` so Antigravity state exists in its SQLite state database.
  2. Run `bun run src/index.ts models antigravity` in `packages/apexo`.
- **Root cause**: `packages/core/src/antigravity.ts`, `packages/apexo/src/plugin/antigravity.ts`, and `packages/llm/src/protocols/antigravity.ts` sent `"user-agent": "apexo-antigravity"`. The Cloud Code endpoint (`v1internal:fetchAvailableModels` and `v1internal:streamGenerateContent`) gates `gemini-4-argon-*` and `gemini-3.8-flash-*` on the `antigravity/cli/<version>` User-Agent string.
- **Fix**: Exported `Antigravity.userAgent = "antigravity/cli/1.4.2"` in `packages/core/src/antigravity.ts` and used it consistently in `packages/core/src/antigravity.ts`, `packages/apexo/src/plugin/antigravity.ts`, and `packages/llm/src/protocols/antigravity.ts`.
- **Verification**:
  - `cd packages/apexo && bun test test/provider/antigravity.test.ts` -> 24 pass, 0 fail.
  - `cd packages/apexo && bun run src/index.ts models antigravity` -> lists `antigravity/gemini-3.8-flash` and `antigravity/gemini-4-argon`.
  - `cd packages/apexo && bun run src/index.ts run -m antigravity/gemini-4-argon "Reply with the single word AGY_OK"` -> `AGY_OK`.

## BUG-20261019-004 — Desktop Electron sidecar fails `InstanceBootstrap` with `ReferenceError: Bun is not defined` in `xai.ts`

- **Affected scope**: `packages/apexo/src/plugin/xai.ts`, `packages/desktop`
- **Observed behavior**: In Desktop (`electron-vite dev`), the composer showed `选择模型` with no models selectable, displayed the `连接 75 个以上的提供商` tip, and popped up `请选择智能体和模型` (`prompt.toast.modelAgentRequired`) and `Unexpected server error. Check server logs for details.` on startup.
- **Expected behavior**: The Desktop sidecar (which runs `packages/apexo/dist/node/node.js` inside Electron's Node.js `utilityProcess`) must complete `Plugin.init` and `InstanceBootstrap` without calling Bun-only globals, exposing connected `xai` and `antigravity` models and default agents to Desktop.
- **Reproduction steps**:
  1. Build `packages/apexo/dist/node/node.js` (`bun script/build-node.ts`) when `readGrokCliAuth` in `packages/apexo/src/plugin/xai.ts` calls `Bun.file(...)`.
  2. Start Desktop (`electron-vite dev` in `packages/desktop`), which forks `sidecar.js` in Electron's Node `utilityProcess`.
- **Root cause**:
  1. `readGrokCliAuth`, `writeGrokCliOAuth`, and `readGrokCliModels` in `packages/apexo/src/plugin/xai.ts` used `Bun.file` and `Bun.write`. While the CLI runs under Bun, the Desktop sidecar runs under Electron's Node.js runtime where `Bun` is undefined, causing `Plugin.init` (`syncGrokCliAuth`) to throw `ReferenceError: Bun is not defined` on every directory-scoped server request (`/provider`, `/agent`, `/session`, `/pty/shells`).
  2. In `packages/app/src/context/models.tsx`, default model visibility groups models by `family` and selects only the single latest `release_date` per family when `release_date` is a valid ISO date. Sharing `family: "grok"` with `grok-imagine-video-1.5-lite` (`2026-10-01`) caused `Grok 4.7`, `Grok 4.6`, and `Grok 4.5` to be hidden by default in Desktop's model selector popover.
- **Fix**:
  1. Replaced `Bun.file` and `Bun.write` in `packages/apexo/src/plugin/xai.ts` with `Filesystem.readJson` and `Filesystem.write` (`packages/apexo/src/util/filesystem.ts`, backed by `node:fs/promises`), and rebuilt `packages/apexo/dist/node` and `packages/desktop/out/main`.
  2. Ordered the Grok Build models first in `XaiAuthPlugin`'s `provider.models` hook with `family: item.id` and `release_date: ""` so `Grok 4.7` is the default `xai` model and all of `Grok 4.7`, `Grok 4.7 Fast`, `Grok 4.6`, and `Grok 4.5` are visible by default in Desktop's model selector popover.
- **Verification**:
  - Pure Node.js sidecar check (`cd packages/desktop && node -e '... Server.listen ...'`) -> `/global/health`, `/provider`, `/agent`, `/config`, `/session`, `/pty/shells` all return HTTP 200; `connected: ['xai', 'antigravity']` with `grok-4.7`, `grok-4.7-build-fast`, `gemini-4-argon`, `gemini-3.8-flash` present.
  - Headless Chrome + Node.js sidecar check -> `[data-action="prompt-model"]` renders `data-control-type="popover"` with a default model selected and lists `Grok 4.7`, `Grok 4.7 Fast`, `Grok 4.6`, `Grok 4.5`, `Gemini 4 Argon`, and `Gemini 3.8 Flash` with zero server error toasts.

## BUG-20261019-005 — Desktop turns into a blank white screen after the first assistant reply due to Vite late optimization of `markdown.worker.ts` dependencies

- **Affected scope**: `packages/app/vite.js`, `packages/session-ui/src/components/markdown-worker.ts`, `packages/session-ui/src/components/markdown.worker.ts`
- **Observed behavior**: In Desktop (`electron-vite dev`) or `packages/app` dev mode with a cold Vite cache, sending the first question in a session caused the entire Electron window to turn into a solid `#f8f7f7` blank white screen for 4–5 seconds immediately when the assistant reply arrived.
- **Expected behavior**: Rendering the first assistant `<Markdown>` response must not trigger a Vite dependency re-optimization or full-page reload.
- **Reproduction steps**:
  1. Start Desktop (`electron-vite dev`) or `vite --force` with a cold `.vite` cache.
  2. Send `"hello"` in a new session and wait for the assistant reply to render `<Markdown>`.
- **Root cause**: `packages/session-ui/src/components/markdown-worker.ts` imports `./markdown.worker.ts?worker&url` and spawns `new Worker(MarkdownWorkerUrl, { type: "module" })` only when the first `<Markdown>` component mounts. Because Vite's initial esbuild dependency scanner does not traverse `?worker&url` imports across workspace packages, Vite discovered `@shikijs/stream`, `remend`, `katex`, `marked`, and `marked-shiki` for the first time when the worker started, triggered `✨ new dependencies optimized ... reloading`, and blocked `/src/index.tsx` for ~4.3s while re-bundling 250+ Shiki chunks (leaving `<div id="root"></div>` empty on a `#f8f7f7` background).
- **Fix**: Added `optimizeDeps.include` in `packages/app/vite.js` using Vite's nested dependency syntax (`"@apexo/ui > @shikijs/stream"`, `"@apexo/ui > @shikijs/transformers"`, `"@apexo/ui > dompurify"`, `"@apexo/ui > katex"`, `"@apexo/ui > marked"`, `"@apexo/ui > marked-shiki"`, `"@apexo/ui > morphdom"`, `"@apexo/ui > remend"`, `"@apexo/ui > shiki"`) so both `packages/app` and `packages/desktop` pre-bundle all markdown worker dependencies at startup.
- **Verification**:
  - Cold-cache `vite --force` + headless Chrome check (`cd packages/apexo && bun -e '... vite --force ...'`) -> `reloadCount: 1`, `viteForcedReload: false`, `markdownText: "GOAL_UI_WORK_COMPLETED"`, `rootChildren: 2` (zero mid-session reloads or `new dependencies optimized` messages).

## BUG-20261019-006 — `SessionGoalDialog` renders a redundant full-width bottom Close button and `status-popover.tsx` duplicates `session.info` command registration

- **Affected scope**: `packages/app/src/components/session-goal.tsx`, `packages/app/src/components/memory-review.tsx`, `packages/app/src/components/status-popover.tsx`, `packages/app/src/components/grok-commands.tsx`
- **Observed behavior**:
  1. In `SessionGoalDialog` (`/goal`), a redundant `<Button variant="ghost" onClick={() => dialog.close()}>{language.t("common.close")}</Button>` at the bottom of `div[data-component="session-goal"]` (`flex-col`) stretched across 100% of the dialog width as a floating centered `"关闭"` / `"Close"` button even though `<Dialog title=...>` already renders a header `×` close button (`[data-slot="dialog-close-button"]`). Similarly, `[data-action="goal-create"]` and `[data-action="goal-reports-open"]` stretched across the full 800px dialog width.
  2. Mounting a session view logged `[warn] [command] duplicate command id "session.info" registered; keeping first entry` because both `status-popover.tsx` and `grok-commands.tsx` registered `session.info`.
- **Expected behavior**:
  1. `SessionGoalDialog` should rely on the standard `<Dialog>` header close button, right-align `[data-action="goal-create"]` (`variant="primary"`), and left-align `[data-action="goal-reports-open"]` (`self-start`).
  2. `session.info` should be registered once in `grok-commands.tsx` and fall back to `command.trigger("status.open")` when no session is open, while `status-popover.tsx` registers only `status.open`.
- **Reproduction steps**:
  1. Open a session in Desktop and click the `Goal` button (`[data-action="session-goal"]`) or run `/goal`.
  2. Inspect the bottom of the dialog and the renderer console log.
- **Root cause**: Unaligned `<Button>` children inside `flex-col` containers in `session-goal.tsx` (and `memory-review.tsx`), plus overlapping `session.info` command registrations in `status-popover.tsx` and `grok-commands.tsx`.
- **Fix**:
  1. Removed the redundant bottom Close button from `SessionGoalDialog`, wrapped `[data-action="goal-create"]` in `<div class="flex justify-end">` with `variant="primary"`, added `self-start` to `[data-action="goal-reports-open"]`, and added `self-end` to the Close button in `MemoryReviewDialog`.
  2. Kept only `status.open` in `status-popover.tsx` and updated `sessionInfo` in `grok-commands.tsx` to trigger `status.open` when `!sessionID()`.
- **Verification**:
  - `cd packages/app && bun typecheck && bun run test:unit` -> 88 pass, 0 fail.
  - `cd packages/apexo && bun run script/grok-goal-ui.mjs` -> all 12/12 Goal UI browser checks pass.
  - Cold-cache Chrome inspection -> `duplicateSessionInfoWarn: false`, `headerClose: true`, and `goal-create` button width is `144px` inside the `800px` dialog with no redundant bottom Close button.

