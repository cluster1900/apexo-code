# BUG-20261014-013: Interrupted Legacy Flat Report Cleanup Could Not Recover

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: Cleanup compatibility for legacy `goal-reviews/review-*` report directories.
- **Observed**: If cleanup was interrupted after renaming a legacy directory into the quarantine area, subsequent cleanup runs only scanned the original path and new per-Goal directories, missing root-level quarantined entries. Clearing the Goal also lost ownership metadata for legacy flat paths.
- **Expected**: Cleanup must be retryable across processes and delete only legacy directories confirmed to belong to that session and Goal.
- **Reproduction**: In `packages/apexo`, run `GITHUB_ACTIONS=false bun test test/session/goal-reports.test.ts --test-name-pattern 'legacy flat'`.
- **Root Cause**: Legacy directories were quarantined in their parent folder while recovery only scanned new per-Goal directories, and legacy directory ownership was not persisted before clearing the database state.
- **Fix**: Write an atomic cleanup journal in the per-Goal directory before clearing Goal state, place new quarantine entries inside the per-Goal directory, and recover both legacy paths and quarantined entries from the journal until all deletions succeed.
- **Verification**: Unit regression suite (332 passed, 1 skipped, 0 failed) and CLI/Electron report suites (8/8 each) passed, including crash-recovery and idempotent cleanup scenarios.
