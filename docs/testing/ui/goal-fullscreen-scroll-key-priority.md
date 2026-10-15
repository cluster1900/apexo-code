# BUG-20261014-273: Fullscreen Session navigation closed the Goal status dialog

- **Scope:** Actual fullscreen terminal Goal status keyboard navigation.
- **Status:** Verified fixed in all four real terminal fixture modes.
- **Observed:** Actual mini terminal passed ten checks. Fullscreen displayed the
  completed task labels, then closed the Goal dialog when the fixture sent Home
  and Down to reveal its deviation. The failure reproduced with screen and input
  tracing; the stored Goal progress and independent completion remained correct.
- **Expected:** Home, End, Up, Down, PageUp and PageDown scroll the active Goal
  status panel without executing background Session navigation or closing it.
- **Reproduction:** Run `bun script/grok-goal-tui.mjs --fullscreen` from
  `packages/apexo`. Complete the actual worker progress update, then use Home and
  Down within the Goal dialog at the original 120-by-40 viewport.
- **Root cause:** The shared Goal panel used a normal `useKeyboard` listener for
  scrolling. Fullscreen Session navigation runs earlier in keymap capture dispatch
  and calls `dialog.clear()`. Temporary guarded diagnostic tracing proved that
  the Session route command cleared the dialog before Home reached the Goal
  listener. Raw child input contained complete Home/Down sequences, and replaying
  that input through the installed parser produced the expected keys with no
  Escape. This is distinct from the bare-Escape fixture issue in BUG-20261014-267.
- **Fix:** Register the Goal navigation keys through `useBindings` at priority 1,
  enabled only for an existing Goal outside pending actions, report views and
  confirmation. Check the scroll reference in each command and remove the late
  overlapping listener branch. Preserve the stable dialog root and normal create,
  report and confirmation keyboard handling. All temporary production diagnostic
  edits were restored before applying the fix.
- **Verification:** `bun script/grok-goal-tui.mjs` and its `--fullscreen` run
  each passed ten checks after the fix. `bun script/grok-native-goal-tui.mjs`
  and its `--fullscreen` run each passed nine checks. All runs used actual worker
  updates, real keyboard scrolling and unchanged original viewports, and verified
  preserved report hashes, report navigation and lifecycle behavior. All owned
  processes exited successfully. Input and dispatch traces establish the cause
  independently of the passing reruns. The coordinated TUI `bun typecheck` passed after Client/SDK generation.
