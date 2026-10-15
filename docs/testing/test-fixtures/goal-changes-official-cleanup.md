# BUG-20261014-008: Official Git Evidence Fixture Read Temporary Patch After Goal Completion Cleanup

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: Final assertions in `grok-goal-official.mjs --execute --changes`.
- **Observed**: After the official Goal completed, the test script attempted to read the temporary classifier patch file from disk and failed with `ENOENT`.
- **Expected**: Validate diff contents from the `read_file` tool receipts captured during the verification phase and allow temporary files to be cleaned up when the Goal completes.
- **Reproduction**: In `packages/apexo`, run `bun script/grok-goal-official.mjs --execute --changes`.
- **Root Cause**: Assumed temporary verification patch files remain on disk after Goal completion.
- **Fix**: Assert committed, staged, and working-tree diff contents against the actual `read_file` tool receipts while keeping baseline and file-manifest assertions.
- **Verification**: All 4 official parity checks (25 requests) passed.
