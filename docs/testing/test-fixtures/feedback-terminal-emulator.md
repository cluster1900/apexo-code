# Feedback Terminal Emulator Wiring

## BUG-20261014-046 — PTY callback parameter shadowed the emulator instance

- **Status:** Fixed and verified.
- **Verified recurrence count:** 1 implementation defect, observed in a simultaneous mini/fullscreen run.
- **Affected scope:** New feedback PTY acceptance script only.
- **Observed behavior:** After adopting a composed-screen assertion, both modes timed out at terminal readiness and the emulator viewport remained empty.
- **Expected behavior:** PTY output is fed into the headless emulator, while terminal query replies are written back to the PTY.
- **Reproduction:** Name both the headless emulator and the PTY callback parameter `terminal`, then invoke `terminal.write(text)` within that callback.
- **Root cause:** The callback parameter shadowed the outer emulator. Output was mistakenly echoed to the child instead of rendered into the assertion viewport.
- **Fix:** Name the callback handle `pty`, send query responses to `pty.write`, and send emitted output only to the outer emulator's `write` method.
- **Verification:** Both failed runs cleaned up their fixture children. Rerun pending after the explicit handle separation. No production code changed.

Final verification: `bun script/grok-feedback-tui.mjs` and `bun script/grok-feedback-tui.mjs --fullscreen` from `packages/apexo`, Bun 1.3.14, both passed 10 checks. These runs exercised real PTYs, exact-revision save/review, Markdown export, conflict recovery, and confirmed deletion with zero model turns or external submissions.
