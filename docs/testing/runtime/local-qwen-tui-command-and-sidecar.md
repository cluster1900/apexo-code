# BUG-20261104-001: Local Qwen TUI & Desktop Slash Command, Download Progress, and Node Sidecar Compatibility

## Affected Scope
- `packages/core/src/local-qwen.ts`
- `packages/apexo/src/plugin/local-qwen.ts`
- `packages/apexo/src/server/routes/instance/httpapi/server.ts`
- `packages/tui/src/component/grok-commands.tsx`
- `packages/tui/src/component/prompt/autocomplete.tsx`
- `packages/app/src/components/grok-commands.tsx`
- `packages/apexo/src/cli/cmd/local-qwen.ts`

## Observed Behavior
1. Running `/local-qwen install` or `/local-qwen status` in TUI failed with a toast: `Failed to send prompt: Unexpected server error. Check server logs for details.`
2. In Desktop (`packages/app` / `packages/desktop`), `/local-qwen` did not appear in the `/` slash command picker, and typing `/local-qwen remove` or `/local-qwen install` submitted the text as a normal user prompt to the LLM instead of executing the Local Qwen command.
3. Pasting a multi-token slash command such as `/local-qwen remove` in TUI cleared the input buffer when autocomplete hid, and synchronous `dialog.replace` calls inside `grok.submit` were immediately wiped by `prompt.submit`'s `dialog.clear()`.
4. During `/local-qwen install`, no live download progress bar was displayed in TUI or Desktop dialogs, and `remove` followed by `install` required re-downloading ~610 MB from scratch.
5. Spawning the local `llama-server` sidecar immediately checked `/health` once without polling for model initialization, resulting in premature connection refusal, unrecorded sidecar PIDs/endpoints, and default Qwen3 thinking tokens exhausting small `maxOutputTokens` budgets.

## Expected Behavior
1. `/local-qwen` (and `/qwen`) in both **TUI** and **Desktop** should appear in the `/` slash command picker and execute as a built-in management command (`status`, `install`, `remove`, `enable`, `disable`, `endpoint <url>`), opening an interactive selector when invoked without arguments or displaying live progress and status reports in modal dialogs.
2. `packages/core/src/local-qwen.ts` and `packages/apexo/src/plugin/local-qwen.ts` must avoid `Bun.*`-only globals (`Bun.file`, `Bun.write`, `Bun.CryptoHasher`, `Bun.sleep`) so the bundled Desktop Node sidecar (`packages/apexo/dist/node/node.js`) runs cleanly under Electron's Node `utilityProcess`, and state persistence must use `Global.Path.cache` (`XDG_CACHE_HOME`) so CLI, TUI, and Desktop share the same Local Qwen state.
3. `removeLocalQwen` should stop the sidecar, disable takeover, and stash cached weights (`>= 1 MB`) so a subsequent `installLocalQwen` (without `--force`) restores and boots in ~1s instead of re-downloading 610 MB (`remove --purge` deletes both active and stashed weights).
4. `ensureLocalQwenEndpoint` should coordinate sidecar startup with a file lock (`Flock`), poll `/health` until `llama-server` finishes loading weights, pass `--reasoning off --reasoning-budget 0` (plus `chat_template_kwargs: { enable_thinking: false }`), and terminate stale or failed sidecar processes cleanly.

## Reproduction Steps
1. Open TUI or Desktop and execute `/local-qwen install`, `/local-qwen status`, or `/local-qwen remove`.
2. In TUI, inspect `~/.local/share/opencode/log/apexo.log` and observe `Error: Expected a string starting with "prt", got "part_local_qwen_..."` at `SessionPrompt.createUserMessage`.
3. In Desktop (`新建会话`), type `/` and observe `/local-qwen` is missing from the slash picker; type `/local-qwen remove` and press Enter to see it sent as a user chat message.

## Root Cause
1. `LocalQwenPlugin` constructed synthetic message parts with custom `part_local_qwen_...` IDs instead of `PartID.ascending()`, and `/local-qwen` was missing from `packages/app/src/components/grok-commands.tsx` (Desktop) as well as initially missing from `packages/tui/src/component/grok-commands.tsx`.
2. `packages/core/src/local-qwen.ts` used `Bun.file`/`Bun.write` and stored state only in `Global.Path.state` (`XDG_STATE_HOME`), which Desktop overrides to Electron `userDataPath` while running the sidecar under Node (`packages/apexo/dist/node/node.js`).
3. `packages/tui/src/component/prompt/autocomplete.tsx` `hide()` cleared any input starting with `/` when `!text.endsWith(" ")`, which wiped pasted multi-word slash commands like `"/local-qwen remove"`, and `packages/tui/src/component/prompt/index.tsx` called `dialog.clear()` right after `grok.submit` returned.
4. `ensureLocalQwenEndpoint` performed a single immediate `fetch` after spawning `llama-server` and did not disable default Qwen3 thinking mode on `llama-server`.

## Fix
1. Replaced all `Bun.*` runtime APIs in `packages/core/src/local-qwen.ts` and `packages/apexo/src/plugin/local-qwen.ts` with Node-compatible `node:fs/promises`, `node:fs`, `node:crypto`, and `setTimeout`, and unified state storage in `Global.Path.cache` (`~/.cache/opencode/local-qwen.json`) with test-environment isolation.
2. Added `GET /local-qwen` and `POST /local-qwen` HTTP routes in `packages/apexo/src/server/routes/instance/httpapi/server.ts` and registered `grok.local-qwen` (`/local-qwen`, `/qwen`) in `packages/app/src/components/grok-commands.tsx` for Desktop and `packages/tui/src/component/grok-commands.tsx` for TUI, with reactive modal progress bars (`formatProgressBar`).
3. Implemented fast weight stashing on `removeLocalQwen` and instant restore on `installLocalQwen` (with `--purge` to delete stashed weights and `--force` to re-download).
4. Fixed `hide()` in `packages/tui/src/component/prompt/autocomplete.tsx` (`!/\s/.test(text)`) so multi-token slash commands are preserved, and deferred dialog opening by one tick in TUI `localQwen` so `prompt.submit`'s `dialog.clear()` does not close the command dialog.
5. Added `Flock`-guarded sidecar startup with readiness polling (150ms interval up to 10s), `--reasoning off --reasoning-budget 0`, `chat_template_kwargs: { enable_thinking: false }`, and rebuilt `packages/apexo/dist/node/node.js`.
6. Protected string-typed tool arguments (`content`, `oldString`, `newString`, `command`, `patchText`, etc.) and string-only tools (`write`, `apply_patch`, `bash`, etc.) in `tool.execute.before` so writing JSON files never converts `content` from `string` to `object`.
7. Added `createDynamicLocalQwenFetch` on `config.provider[LOCAL_QWEN_PROVIDER_ID].options.fetch` so cached `LanguageModelV3` instances (`small_model` / `title` agent) dynamically rewrite stale port URLs to the current live `llama-server` endpoint after `disable` -> `enable`.

## Verification
- `cd packages/apexo && bun test test/plugin/local-qwen.test.ts` — Passed (2 tests, 45 assertions).
- `cd packages/apexo && bun script/build-node.ts` — Rebuilt `packages/apexo/dist/node/node.js` for Desktop Electron sidecar.
- `cd packages/core && bun typecheck`, `cd packages/tui && bun typecheck`, `cd packages/app && bun typecheck`, `cd packages/apexo && bun typecheck` — Passed with 0 errors.
