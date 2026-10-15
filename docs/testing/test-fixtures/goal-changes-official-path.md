# BUG-20261014-007: Official Git Evidence Fixture Matched Prompt Description Instead of Patch Path

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: `grok-goal-official.mjs --execute --changes`.
- **Observed**: An unconstrained regex matched `CHANGES_FILE: a unified-diff...` in the prompt description rather than the actual path, causing the mock model to request a non-existent file and enter `back_off_paused`.
- **Expected**: Extract and read the absolute patch file path provided in the verification evidence.
- **Reproduction**: In `packages/apexo`, run `bun script/grok-goal-official.mjs --execute --changes`.
- **Root Cause**: The `CHANGES_FILE:` label appeared both in the prompt instructions and in the evidence block, and the fixture regex did not require an absolute path starting with `/`.
- **Fix**: Match only absolute paths starting with `/` while handling both literal and escaped newlines.
- **Verification**: Path extraction succeeded and all 4 official parity checks (25 requests) passed.
