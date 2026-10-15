# Background Task fullscreen fixture wrapped back to the old selection

- **Bug ID:** BUG-20261015-111
- **Scope:** Actual native Task fullscreen PTY acceptance.
- **Status:** Fixture corrected and verified.
- **Independent occurrences:** 1.

After adding a new background Task, the fixture sent one Up key for every listed row. The mini menu clamps at the first row, but fullscreen DialogSelect wraps. Four Up keys across four rows returned to the previously selected completed Task. The screen retained that Task's output and the HTTP trace kept reading its detail, so the fixture timed out waiting for the new child's passive detail read. The background row and marker were already rendered correctly.

The fixture now calculates the exact distance from its previously verified selected Task to the new first row. It sends that many keys, then waits for a real detail request and the expected output. No product navigation or selection behavior is changed. Narrow and normal-width verification results are recorded with the background Task UI acceptance.

Verification: from `packages/apexo`, `bun script/grok-native-task-tui.mjs --background --fullscreen --narrow` and the same command without `--narrow` each passed seven checks / 22 provider calls. Mini equivalents also passed seven / 22 at each size. The final current-buffer text and renderer bounds were inspected. All processes exited and were reaped. See [background UI acceptance](../../native-task-background-ui.md).
