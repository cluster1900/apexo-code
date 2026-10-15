# BUG-20261014-262: Goal detail overflow lacked keyboard navigation

- **Scope:** Shared terminal Goal panel used by native action panels and the
  compatibility mini/fullscreen entrypoints.
- **Observed:** Source inspection found a fixed nine-line detail viewport without
  a focused scroll target or keyboard scrolling handler. Longer completion
  summaries, progress notes and verifier results could extend below that viewport.
  This is a static finding; no historical failure count is inferred.
- **Expected:** Users can reveal the entire Goal detail with arrow and page keys,
  return to the top, and continue using pause/resume/report/clear actions.
- **Reproduction:** Run a Goal with a completion summary, two completed checklist
  tasks, a deviation and verifier results. Open the Goal panel in a narrow terminal
  and use Up/Down, PageUp/PageDown, Home and End to inspect the content.
- **Root cause:** The component supplied a bounded `scrollbox` but did not keep its
  renderable reference or dispatch navigation keys to it.
- **Fix:** Retain the scrollbox reference and handle the six navigation keys only
  while viewing an existing Goal. Creation, pending actions, report subpanels and
  clear confirmation retain their own keyboard behavior. The stable outer `box`
  remains in place as required by [RULE-20261014-001](../../rules/tui-dialog-stable-root.md).
- **Verification:** TUI `bun typecheck` passed. From `packages/apexo`,
  `bun script/grok-native-goal-tui.mjs` and the same command with `--fullscreen`
  each passed nine real PTY checks. Arrow/Home navigation revealed both completed
  tasks, the advisory verification hint and deviation without enlarging the
  fixture viewport. Original report hashes stayed unchanged. Actual compatibility
  mini/fullscreen each passed ten checks after the distinct fullscreen capture
  priority defect was fixed in [BUG-20261014-273](goal-fullscreen-scroll-key-priority.md).
- **Occurrences:** Zero executed failures recorded before the change; static finding.
