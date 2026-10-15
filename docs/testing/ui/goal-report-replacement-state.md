# BUG-20261014-014: Report Panel State Not Isolated When Goal ID Is Replaced

- **Status**: Defensive Fix & Verified; **Verified Occurrences**: 0 (caught via static review); **Linked Rule**: None.
- **Scope**: Goal report subpanels in both Desktop/App (`packages/app/src/components/session-goal.tsx`) and TUI (`packages/tui/src/component/session-goal.tsx`).
- **Observed**: The report subpanel only loaded its list in `onMount`. If a poll replaced an old Goal with a new Goal in a single step while the panel stayed open, a boolean `<Show>` did not remount the child component, leaving stale list state while read/cleanup actions targeted the new Goal ID.
- **Expected**: When the Goal ID changes, cancel in-flight report requests, discard stale preview/confirmation state, and reload reports for the new Goal.
- **Root Cause**: Component lifetime was bound to whether the panel was open rather than the active Goal ID.
- **Fix**: Use `<Show when={...} keyed>` keyed by the Goal ID in both App and TUI while keeping normal status polls on the same Goal ID from remounting the panel.
- **Verification**: `grok-goal-ui.mjs cli|desktop` verified replacing and completing a Goal while the report panel remained open (12/12 passed on both targets); mini and fullscreen TUI suites passed 8/8 each.
