# BUG-20261112-001: Review capture omitted dangling symlinks

- Scope: initial F01 frozen Git capture implementation.
- Observed: an eligible untracked dangling symlink was classified as oversized; reading its captured tree entry failed.
- Expected: capture the link entry and its target text without following it outside the repository.
- Reproduction: create a committed file, staged and unstaged changes, an untracked file and a dangling symlink; invoke native uncommitted capture and read the link from the resulting tree.
- Root cause: the untracked size check followed the symlink with `stat`; its error fallback treated the link as an oversized file.
- Fix: inspect the link with `readLink` before regular-file size checks. Git captures the link itself through the private index.
- Verification: `bun test test/v2/code-review.test.ts test/v2/headless-runner.test.ts` from `packages/apexo` passed 15 tests and 133 assertions. The capture regression checks link contents, frozen untracked contents, real-index preservation and traversal rejection. No recurring occurrence count is claimed.

# BUG-20261112-002: Unavailable review reads could leave clean coverage

- Scope: initial F01 review role and report validation.
- Observed during implementation review: a failed `review_read` returned a tool error, but the report builder had no record of that failure; a subsequent empty model result could be labeled `no_findings`.
- Expected: unavailable captured evidence must make an empty report inconclusive.
- Reproduction: have the native provider request `review_read` for an unavailable captured path, then return an otherwise valid empty report.
- Root cause: tool execution and final report construction did not share coverage diagnostics.
- Fix: retain unavailable paths on the private live review role and merge them into host-owned coverage before validating the report.
- Verification: the same 15-test command passed. The explicit missing-content test asserts `inconclusive` and `captured_content_unavailable`; it also verifies missing usage and turn exhaustion cannot create a clean report.

# BUG-20261112-007: Private-index capture executed external Git filters

- Scope: F01 uncommitted target capture.
- Observed: a real repository's clean filter created a marker in the working tree during capture, despite use of a private index. A partial fix limited to `add` did not prevent filter execution during a later index operation.
- Expected: target capture must not execute repository-defined clean/process filters or mutate working-tree files.
- Reproduction: commit a text file, configure a clean filter that writes a marker and forwards stdin, assign it through `.gitattributes`, modify the file, then invoke the real capture service.
- Root cause: `GIT_INDEX_FILE` isolates index storage but not Git filter configuration. The Git trace also showed filter execution associated with `write-tree` index processing.
- Fix: enumerate configured filter drivers and override clean/process commands and their required flags for every Git operation in that capture, including index refresh/write and diffs. Permanent repository configuration is not changed.
- Verification: the pre-fix service probe returned `cleanFilterExecuted: true`. `bun test test/v2/code-review.test.ts --test-name-pattern 'clean filters'` from `packages/apexo` now passes one test / two assertions, checking both the absent marker and the exact captured file bytes. The replacement full gate subsequently passed all 18 Apexo batches.
