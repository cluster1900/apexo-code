# BUG-20261015-295: UI fixture requested legacy relocation on a V2-pinned Session

- Scope: Native Memory operation browser and terminal acceptance construction.
- Observed: The browser waited for a relocation preview, but the real GET returned 403 and the UI displayed the failure.
- Expected: Legacy relocation requires a legacy-pinned Session and workspace scope. V2 carryover is a separate explicit action; no operation changes the pinned backend implicitly.
- Cause: The fixture assumed every migration choice was supported by its V2 Session. It ignored the documented backend and scope preconditions.
- Correction: Verify the unsupported relocation is visible and makes no fallback mutation. Seed a real fixed global legacy source and use V2 carryover to verify a supported preview and explicit commit with zero provider work.
- Verification: The corrected browser run observed the expected 403, then committed the global carryover without an additional provider request. Its subsequent clear-test failure is independently recorded as BUG-20261015-296. Full terminal acceptance remains pending.

Final native-window and browser acceptance passed the unavailable relocation and reviewed global carryover with no added provider call. All four terminal mode/size combinations passed the same actual backend boundary.
