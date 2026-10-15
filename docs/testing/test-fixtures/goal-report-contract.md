# BUG-20261014-002: Legacy Goal Fixtures Returned Terminal JSON After Report File Protocol Change

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: Goal HTTP model fixtures, CLI/Electron verification scripts, and token usage/request count assertions.
- **Observed**: After planning and verification switched to requiring on-disk report files, legacy fixtures still returned inline JSON text only, and hardcoded request counts and message indices no longer matched the tool-call flow.
- **Expected**: Mock models write the requested report files via real tool calls before finishing, recording usage per request while preserving budget, permission, and verification assertions.
- **Reproduction**: In `packages/apexo`, run `bun test test/session/prompt.test.ts --test-name-pattern '(goal|Goal)'`.
- **Root Cause**: Test fixtures and assertions were coupled to the old single-turn text response rather than the multi-turn file-writing workflow.
- **Fix**: Added dynamic model response fixtures matched by unique per-role report paths so parallel verifiers do not consume each other's responses, and updated request counts, message indices, and cancellation sync points.
- **Verification**: 15 Goal model integration tests passed, CLI and production Electron file suites passed (11/11 scenarios, 92 model requests each), and the 314-test full diagnostic suite passed (0 failed).
