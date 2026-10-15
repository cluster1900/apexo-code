# BUG-20261014-012: Report Download Trusted Mutable On-Disk Catalog Hashes Over Persisted Goal State

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: Goal report download and catalog verification endpoints.
- **Observed**: When both a report file and its `.report.json` size/SHA-256 metadata on disk were modified, downloading the report succeeded even though the persisted Goal state held the original hash.
- **Expected**: Active plans, latest verifications, and retained previous verifications must validate against the authoritative report references persisted in the database rather than trusting mutable on-disk catalog metadata.
- **Reproduction**: In `packages/apexo`, run `GITHUB_ACTIONS=false bun test test/session/goal-reports.test.ts --test-name-pattern 'anchor hashes'`.
- **Root Cause**: The new catalog implementation only checked persisted Goal references for legacy flat paths and always trusted on-disk catalog hashes for per-Goal directories.
- **Fix**: Prefer persisted Goal report references whenever the session, Goal, and report ID match, using the on-disk catalog only for discovering historical entries.
- **Verification**: Unit regression suite (332 passed, 1 skipped, 0 failed) and CLI/Electron report suites (8/8 each) passed, including tamper-rejection assertions.
