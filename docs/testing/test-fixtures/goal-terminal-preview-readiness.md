# BUG-20261014-016: Report Preview Readiness Assertion False-Matched Background Session Text

- **Status**: Fixed & Verified; **Verified Occurrences**: 2; **Linked Rule**: None (below threshold).
- **Scope**: Real PTY fixture in `grok-goal-tui.mjs --fullscreen`.
- **Observed**: After pressing Enter to preview a report, the fixture checked for the objective text to determine when the preview was ready. Because that text also appeared in the background session transcript, the fixture sent `Escape` before the preview finished loading, closing the entire report subpanel and timing out on the subsequent save step.
- **Expected**: Wait until the report preview itself has loaded and rendered before exiting preview mode.
- **Reproduction**: Run `bun script/grok-goal-tui.mjs --fullscreen` in `packages/apexo` through the report view/save step.
- **Root Cause**: Terminal screen captures include both the active dialog and background transcript text, so objective body text is not a preview-exclusive readiness signal.
- **Fix**: Render the viewed filename in the preview header (`Preview · objective.txt`) and wait for that header before asserting body text and sending `Escape`.
- **Verification**: Both `bun script/grok-goal-tui.mjs --fullscreen` and `bun script/grok-goal-tui.mjs` passed all 8 scenarios, including file save and confirmed cleanup.

## Independent native-local Plan fixture occurrence

The local mini fixture waited for `LOCAL_PLAN_APPROVAL` before sending Enter. That content was already present in the preceding write-tool transcript; the actual Plan approval dialog had not become ready. The completion assertion timed out with the dialog still pending and exactly three provider turns (`plan_enter`, `write`, `plan_exit`). This is a second independent occurrence of confusing background transcript content with dialog readiness, not a Plan reply or provider defect.

The fixture now waits for the actual approval question, then sends the same Enter action without changing the completion assertion. `bun script/grok-native-local-terminal.mjs --plan` from `packages/apexo` passed five checks / five provider calls, including the explicit approval, ordinary second prompt and durable history. No product source changed for this correction.
