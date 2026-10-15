# BUG-20261015-045: Workflow terminal evidence was captured after shutdown

- **Status:** Fixed and verified. One fixture-authoring episode; no recurring rule.
- **Scope:** Actual mini/fullscreen Workflow terminal fixture screen capture.
- **Observed:** Both terminal modes passed 13 runtime/UI checks, but the existing final text artifact was saved after killing the terminal process. The mini artifact contained only the returned shell/header rather than the asserted Workflow recovery panel.
- **Expected:** Preserve the terminal screen while the tested panel is still active, before teardown changes the display.
- **Reproduction:** In `packages/apexo`, run `bun script/grok-workflow-tui.mjs` and inspect the original final text artifact saved in `finally` after the child exits.
- **Root cause:** Evidence capture followed terminal shutdown. This is a capture lifetime error, separate from the browser's nested-scroll framing error.
- **Fix:** Save a dedicated `workflow-schema-tui.txt` before teardown, while the real recovery panel remains open. Keep existing cleanup and diagnostic artifacts intact.
- **Verification:** Corrected mini and `--fullscreen` runs each passed 13 checks, exited successfully, and retained the 120-token total, lower-bound hint, complete new-run instruction, and footer without Resume. Pressing `u` opens no resume editor and provider calls stay at two.
- **Separate product defect:** The Source-line remnant was subsequently reproduced in the real component renderer and traced to shrinking fixed rows, independently of capture reconstruction. Its correction and acceptance are tracked in [BUG-20261015-046](../ui/workflow-terminal-fixed-rows.md); do not count it as a second capture-lifetime occurrence.
