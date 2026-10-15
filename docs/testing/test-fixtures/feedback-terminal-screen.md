# Feedback Terminal Screen Assertions

## BUG-20261014-045 — ANSI redraw stream was treated as a contiguous screen sentence

- **Status:** Fixed and verified.
- **Verified recurrence count:** 2.
- **Affected scope:** `grok-feedback-tui.mjs` real PTY acceptance.
- **Observed behavior:** The mini terminal successfully loaded the saved draft, but the fixture timed out looking for the exact spaced details sentence in the raw terminal stream.
- **Expected behavior:** The fixture recognizes the rendered draft and verifies persisted state through the actual API.
- **Reproduction:** Seed a multiword details sentence, load it after an existing panel render, and search stripped ANSI output for the original sentence verbatim.
- **Root cause:** Incremental cursor-addressed redraw writes only changed cells. Removing escape sequences does not reconstruct a terminal screen: the accumulated stream contained `Precise reproductionsteps` even though the saved value was unchanged. This was a screen assertion defect, not a failed draft load.
- **Fix:** Feed the real PTY stream into the already available `@xterm/headless` terminal emulator and assert the composed viewport, following the existing Goal acceptance harness. Also validate title/revision/content through the real backend API. A marker-only correction was insufficient: a second independent run reached review successfully but split its hint sentence across incremental writes.
- **Verification:** Initial mini PTY run showed both the loaded title and details in the emitted screen stream. After two observed fixture failures, the composed-screen rerun is pending; no complete pass claimed yet.

Final verification: `bun script/grok-feedback-tui.mjs` and `bun script/grok-feedback-tui.mjs --fullscreen` from `packages/apexo`, Bun 1.3.14, both passed 10 checks. These runs exercised real PTYs, exact-revision save/review, Markdown export, conflict recovery, and confirmed deletion with zero model turns or external submissions.
