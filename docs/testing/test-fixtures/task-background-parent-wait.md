# Background Task setup confused parent idleness with child settlement

- **Bug ID:** BUG-20261015-113
- **Scope:** Background mode of the real native Task UI fixture.
- **Status:** Fixture corrected and verified.
- **Independent occurrences:** 1 authoring episode.

The fixture inherited a foreground setup assertion: after waiting for the parent Session to become idle, it immediately expected the child Task to be completed. A corrected fullscreen run instead observed the background child still running and failed before opening the UI. Returning an idle parent while its background child continues is intended product behavior.

Background setup now explicitly waits for that child's completion notice and checks its terminal receipt before continuing. Foreground setup keeps its original joined-parent behavior. No extra production join, arbitrary sleep, retry or model work is introduced. This is distinct from the fullscreen selection-wrap fixture error; the interrupted attempt did not verify that navigation correction.

Verification uses the real native Task fixture and PTY commands documented in the background UI acceptance record; the corrected narrow and normal-width results are recorded below.

Verification: from `packages/apexo`, `bun script/grok-native-task-tui.mjs --background --fullscreen --narrow` and the same command without `--narrow` each passed seven checks / 22 provider calls. Mini equivalents also passed seven / 22 at each size. The final current-buffer text and renderer bounds were inspected. All processes exited and were reaped. See [background UI acceptance](../../native-task-background-ui.md).
