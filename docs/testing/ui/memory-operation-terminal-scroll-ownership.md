# BUG-20261015-320: Fullscreen PageDown dismissed Memory operations

- Scope: Native Memory operations terminal detail scrolling.
- Observed: At 80×24, the discard reason was below the detail viewport. PageDown dismissed the Memory dialog and scrolled the Session transcript instead.
- Expected: PageUp and PageDown scroll the active Memory detail region while preserving its review and confirmation state.
- Root cause: Memory listened through `useKeyboard`, but the Session keymap handled PageDown earlier and explicitly cleared dialogs. Preventing the event in the later handler could not establish ownership.
- Fix: Register both scrolling keys in Memory's existing high-priority `useBindings` alongside Escape. Remove their duplicate lower-level keyboard handling. Session-wide bindings remain unchanged.
- Reproduction: Open operations in fullscreen 80×24, preview discard and press PageDown to read the below-fold unavailable reason.
- Verification: `bun script/grok-native-memory-operations-tui.mjs` with each combination of `--fullscreen` and `--narrow` passed nine checks and three provider calls. Real mini/fullscreen at 120×40 and 80×24 retained the dialog while scrolling unavailable reasons, clear confirmation and committed results. `bun typecheck` from `packages/tui` passed. An explicit confirmation header also exposes the active review state before scrolling.
