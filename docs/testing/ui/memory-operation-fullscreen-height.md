# BUG-20261015-380: Fullscreen Memory operation footer fell below the terminal

- **Scope:** Fullscreen shared MemoryOperations view; mini uses an explicit height.
- **Status:** Fixed and verified in actual 80×24 and 100×40 fullscreen PTYs, with mini regression coverage.
- **Occurrences:** One demonstrated layout defect.
- **Observed:** The fullscreen batch acceptance timed out waiting for the enabled Dream command. The retained 40-row terminal screen showed the Ready dialog and empty receipt area, but no action footer. No Dream operation had started. Mini acceptance completed its three independent Dream attempts and exact retry.
- **Expected:** Keep the fixed footer and enabled actions visible inside the terminal at both tested sizes.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-native-memory-batch-dream-tui.mjs --fullscreen`. Before the fix, the default panel height was 32 rows at a terminal height of 40, while Dialog placed its content after a ten-row top inset and one-row inner padding. The footer extended beyond the viewport.
- **Root cause:** MemoryOperations computed its default height from the full terminal without subtracting the shared Dialog inset. This is distinct from list flex-basis collapse or keyboard ownership failures.
- **Fix:** Bound the default panel height by the actual quarter-screen Dialog inset, inner padding, and a bottom row. Preserve explicit mini height and the stable outer box. No global Dialog change.
- **Verification:** Shared App/TUI package types and App/Desktop builds passed. From `packages/apexo`, `bun script/grok-native-memory-batch-dream-tui.mjs --fullscreen` (100×40) and the same with `--narrow` (80×24) each passed four checks / three Dream calls. Both retained screens were inspected and show the enabled three-line action footer inside the terminal after results. The mini command without flags also passed four checks / three calls at 100×40. These probes perform real operations and exact retry, rather than merely finding labels. All owned processes exited and were reaped. The original failed fullscreen screen remains before evidence; the fixed source and final runtime result establish the repair.
- **Constraint:** No recurrence promotion; one episode.
