# BUG-20261018-405 — PromptInputV2 Mod+A select-all in headless Chrome, `/context` / `/context-window` metrics parity, and `grok-slash-ui.mjs` `bunx` latency

- **Bug ID**: `BUG-20261018-405`
- **Category**: UI (`ui`)
- **Affected Scope**:
  - `packages/session-ui/src/v2/components/prompt-input/index.tsx`
  - `packages/app/src/components/prompt-input-v2.tsx`
  - `packages/app/src/components/grok-commands.tsx`
  - `packages/app/src/components/session/session-context-metrics.ts`
  - `packages/tui/src/component/grok-commands.tsx`
  - `packages/tui/src/feature-plugins/sidebar/context.tsx`
  - `packages/apexo/script/grok-slash-ui.mjs`
- **Occurrences**: 1 independent episode.

## Observed Behavior

1. Running `bun script/grok-slash-ui.mjs --edit-prompt` in `packages/apexo` failed at `slash-opens-editor-and-mod-enter-saves`: pressing `Meta+a` followed by `Backspace` on the `contenteditable="true"` prompt input in headless Chrome on macOS only deleted the last character (`"EDITED_ONE lin"`), so typing `/edit-prompt` resulted in `"EDITED_ONE lin/edit-prompt"` and did not open the `/edit-prompt` dialog.
2. Running `bun script/grok-slash-ui.mjs --dashboard` failed at `ctrl-x-twice-deletes-settled-row` (`Timed out waiting for delete settled row`): under Bun 1.4.2, each `bunx agent-browser` CLI call spent ~2.9s querying npm for `agent-browser@latest`, causing two consecutive `Control+x` presses to exceed the 2000ms `deleteConfirmMs` window (`packages/core/src/agent-dashboard.ts`) and 5000ms `ToastV2` duration.
3. `/context` and `/context-window` model resolution differed between TUI (`last` assistant message only) and Desktop (`local.model.current()` only), and Desktop's `getSessionContextMetrics` (`session-context-metrics.ts`) plus TUI's sidebar context widget (`sidebar/context.tsx`) used `model?.limit.context` without applying the session's `/context-window` choice (`effectiveContextWindow(contextWindowChoice(sessionID), model?.limit.context_options)`). Additionally, `[data-slot="prompt-action-bar"]` in `packages/app/src/components/prompt-input-v2.tsx` only matched `[data-component=button]` and missed `[data-component=button-v2]`.

## Expected Behavior

1. `Mod+A` (`Meta+a` / `Ctrl+a`) on `[data-component="prompt-input"]` selects the entire editor contents so `Backspace` clears the draft in both interactive and headless browser environments.
2. `grok-slash-ui.mjs` invokes the cached `agent-browser` binary directly when present (~39ms per call) instead of re-querying npm via `bunx` (~2.9s per call), keeping time-bounded UI confirmations within their 2000ms/5000ms windows.
3. Both TUI and Desktop resolve the active model for `/context` and `/context-window` consistently (`local.model.current()` with fallback to the last assistant message's model) and apply `effectiveContextWindow(contextWindowChoice(sessionID), model?.limit.context_options)` in session context metrics and sidebar widgets.

## Reproduction Steps

Run in `packages/apexo`:

```sh
bun script/grok-slash-ui.mjs --edit-prompt
bun script/grok-slash-ui.mjs --dashboard
bun script/grok-slash-ui.mjs --context-window
```

## Root Cause

1. In headless Chromium on macOS, synthetic `Meta+a` key events dispatched via CDP do not invoke the native Cocoa menu bar's `Select All` responder on `contenteditable` elements.
2. `bunx agent-browser` resolves `agent-browser@latest` against the npm registry on every subprocess invocation (~2.9s per call on Bun 1.4.2), exceeding the 2000ms `deleteConfirmMs` confirmation timeout between the two `Control+x` presses.
3. `session-context-metrics.ts` and `sidebar/context.tsx` read `model?.limit.context` directly instead of consulting `effectiveContextWindow(contextWindowChoice(sessionID), model?.limit.context_options)`, and `grok-commands.tsx` in TUI and App resolved the active model differently.

## Fix

1. Handle `(event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a"` in `PromptInputV2` `onKeyDown` by selecting all contents of `editorRef` via the Selection API, and update `[data-slot="prompt-action-bar"]` in `packages/app/src/components/prompt-input-v2.tsx` to match `[data-component=button-v2]`.
2. Resolve the cached `agent-browser` executable in `packages/apexo/script/grok-slash-ui.mjs` when present (`bunx-<uid>-agent-browser@latest/node_modules/.bin/agent-browser`) before falling back to `bunx`.
3. Align `/context` and `/context-window` model resolution and `effectiveContextWindow` usage across `packages/app/src/components/grok-commands.tsx`, `packages/tui/src/component/grok-commands.tsx`, `packages/app/src/components/session/session-context-metrics.ts`, and `packages/tui/src/feature-plugins/sidebar/context.tsx`.

## Verification

- `bun script/grok-slash-ui.mjs --edit-prompt` in `packages/apexo`: 4/4 checks pass.
- `bun script/grok-slash-ui.mjs --dashboard` in `packages/apexo`: 12/12 checks pass.
- `bun script/grok-slash-ui.mjs --context-window` in `packages/apexo`: 4/4 checks pass.
- `bun script/grok-slash-ui.mjs --mode-cycle` in `packages/apexo`: 5/5 checks pass.
- `bun script/grok-slash-ui.mjs` in `packages/apexo`: 9/9 checks pass.
- `bun test src/components/session/session-context-metrics.test.ts` in `packages/app`: 1/1 pass.
