# BUG-20261014-015: Fullscreen Report Toggle Remounts Goal Dialog

- **Status**: Fixed & Verified; **Verified Occurrences**: 4; **Linked Rule**: [RULE-20261014-001](../../rules/tui-dialog-stable-root.md).
- **Scope**: `/goal resume` dialog and report subpanel in the fullscreen terminal (`packages/tui/src/component/session-goal.tsx`).
- **Observed**: After a Goal completed, pressing `f` failed to open the report subpanel and instead re-sent the initial `resume` operation, displaying "Could not update the goal".
- **Expected**: Pressing `f` switches to the local report view without remounting the parent component or re-running the initial dialog entry operation.
- **Reproduction**: In `packages/apexo`, run `bun script/grok-goal-tui.mjs --fullscreen`, create, pause, and resume a Goal until verification completes, then press `f`.
- **Root Cause**: `SessionGoal` returned a reactive `<Show>` as its top-level root node. Fullscreen dialog function-child resolution remounted the parent component when the top-level root swapped, re-triggering the entry `resume` intent against an already completed Goal.
- **Fix**: Wrap `SessionGoal` in a stable outer `<box>` root and keep the Goal-ID-keyed conditional report subpanel inside it.
- **Verification**: Both `bun script/grok-goal-tui.mjs` and `bun script/grok-goal-tui.mjs --fullscreen` passed all 8 scenarios (including report viewing, saving to disk, returning, and cleanup), and `packages/tui` typecheck exited 0.
