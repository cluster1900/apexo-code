# RULE-20261014-001: Keep a Stable Root Node in Terminal Action Dialogs

- **Status**: Active
- **Scope**: Shared action dialogs across `packages/tui` and the mini terminal, especially components mounted via `dialog.replace(() => ...)` that toggle local subpanels or run an initial command intent on mount.
- **Source**: [BUG-20261014-015](../testing/ui/goal-terminal-report-root.md) (4 verified independent failures on 2026-10-14).
- **MUST**: Always return a stable renderable root container (such as `<box>`) and place conditional views, lists, and keyed subcomponents inside it. Toggling a local subpanel must **NEVER** remount the parent component that holds initial `create` / `resume` / `clear` mount intents.
- **MUST**: Still cancel in-flight requests and reset subpanel state when the target identity (e.g., Goal ID) changes; a stable outer root does not replace keying inner subpanels by target ID.
- **Verification**: Execute shared interactions in both mini and fullscreen modes using a real PTY. Verify that opening and closing subpanels does not re-trigger initial operations, show spurious error messages, or issue extra model requests. Do not verify only one terminal mode.
- **Regression Commands**: From `packages/apexo`, run `bun script/grok-goal-tui.mjs` and `bun script/grok-goal-tui.mjs --fullscreen` (covering report viewing, saving to disk, exiting preview, and confirmed cleanup).

This constraint applies to the current OpenTUI dialog mounting behavior; if the rendering boundary changes in the future, prove with the same PTY checks that parent component lifecycle is preserved before revising this rule.
