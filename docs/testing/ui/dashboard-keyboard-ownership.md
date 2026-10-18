# BUG-20261018-401: Agent Dashboard Keyboard Ownership

- **Scope:** The new `/dashboard` dialogs: Desktop `packages/app/src/components/agent-dashboard.tsx` with the shared `packages/ui/src/context/dialog.tsx`, and TUI `packages/tui/src/component/dialog-dashboard.tsx`.
- **Occurrences:** Three distinct mechanisms in one feature episode. They are not counted as a recurring constraint.
- **Status:** Fixed. The CLI and Desktop dashboard flows each pass 12/12.

## Observed and expected behavior

1. **TUI crash.** Opening `/dashboard` crashed the TUI with `PromptQueue context must be used within a context provider`. Dialogs mount under `DialogProvider`, which sits above `PromptQueueProvider`.
2. **Desktop focus.** After opening the dashboard from `/dashboard`, ↓ did nothing. The slash path refocused the prompt editor after the dialog mounted, and Dialog's autofocus fallback would otherwise focus its close button. Neither element is inside the dashboard's key handler.
3. **Desktop Escape.** The first Esc after a peek reply closed the whole dialog. Expected (Grok Build): Esc steps back through cancel search → clear reply → deselect → clear filter → unfocus input → exit. The dialog stack's window capture listener closed on any Escape before the dashboard saw it.

## Reproduction

From `packages/apexo`, run `bun script/grok-slash-tui.mjs --dashboard` for case 1. For cases 2 and 3, rebuild `packages/app` and run `CHROMIUM_PATH=/usr/bin/google-chrome bun script/grok-slash-ui.mjs --dashboard`.

## Fixes

1. The TUI app gets the queue with `usePromptQueue()` inside the provider and passes it to `DialogDashboard` as a prop.
2. Desktop: the dashboard root, or its input, carries `autofocus` according to the initial focus. After the first animation frame, focus is reclaimed if it is not inside the dashboard.
3. `DialogProvider` now ignores Escape when the event target is inside `[data-escape-local]`. The dashboard root sets that attribute and closes itself when its Escape chain runs out. Other dialogs are unchanged.

## Verification

- `packages/app` and `packages/ui`: `bun run typecheck` passes. `packages/app`: `bun run test:unit` gives 73 pass.
- CLI and Desktop `--dashboard` flows: 11/12 checks each, with identical check names.
- The default CLI and Desktop slash flows still pass (Desktop 9/9).
