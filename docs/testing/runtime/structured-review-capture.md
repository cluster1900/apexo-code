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

# BUG-20261112-017: Re-staging tracked ignored paths rejected otherwise valid repositories

- Scope: uncommitted review capture, including the Apexo checkout.
- Observed: the external review and a real Git reproduction show `git add` failing on explicitly named tracked files under an ignored directory. Forced additions are affected as well.
- Expected: tracked ignored files and forced staged additions remain part of the frozen target without changing the real index.
- Reproduction: track a file under `ignored/` with `git add -f`, ignore its directory, modify that file and force-stage another file there, then capture uncommitted changes.
- Root cause: the first implementation re-added every tracked path to a fresh HEAD index; explicitly naming ignored paths can make Git reject the entire operation. Merely copying the source index does not suppress Git's ignored-directory pathspec error.
- Fix: reuse the Git service's refresh logic through `Git.index.capture`, seed a private index from the real index and stage only changed tracked paths and eligible untracked paths. In this private capture, force applies only to the already enumerated, literal candidate paths; ignored untracked paths cannot widen the candidate set. Keep configured clean/process filters inert on every private-index command.
- Verification: the focused native regression passes with tracked ignored files, forced staged additions and a byte-for-byte unchanged original split index. The existing real filter-execution regression also passes. Whole-checkout and final gate results are recorded separately in the implementation checkpoint.

# BUG-20261112-018: Capturing from HEAD omitted staged removals and rename sources

- Scope: uncommitted review targets and their initial stale status.
- Observed: a staged deletion disappeared from the manifest; a staged rename became an addition with its source retained. This also caused a just-created report to differ from its workspace.
- Expected: capture the complete combined HEAD-to-working-tree change, including staged removals and renames.
- Reproduction: commit files, run `git rm` and `git mv`, then capture without any additional working-tree changes.
- Root cause: the private index started from HEAD, while the enumerated paths came from the real index after deletion. The deleted source was therefore never removed from the private index.
- Fix: seed the private index from the real index before refreshing working changes. Expand split indexes against the source repository's shared-index directory, and retain explicit conflict exclusions.
- Verification: the new real Git regression asserts a deletion, a detected rename with its old path, initial `current` workspace status and unchanged real index bytes.

# BUG-20261112-022: One invalid model path discarded an otherwise usable report

- Scope: host finding validation.
- Observed: a model citation such as `./src/x.ts`, an absolute in-repository path or an outside-repository path caused the entire report to fail.
- Expected: canonicalize safe in-repository citations and isolate invalid findings while preserving valid findings and honest coverage.
- Reproduction: return a mixture of relative, absolute in-repository and outside-repository citations in one otherwise valid structured result.
- Root cause: path validation raised a domain failure inside the finding traversal instead of treating each citation as independent evidence.
- Fix: normalize paths against the captured repository, retain safe relative paths, skip unsafe findings and record `invalid_finding_path` plus an invalid-location count. Captured reads still reject traversal and never fall back to live files.
- Verification: the new native test preserves the two valid findings, normalizes both paths and records the rejected citation without failing the report.

## Follow-up to BUG-20261112-002: Expected empty sides are not missing coverage

Reading the old side of an added file or the new side of a deleted file now returns the expected empty content. Only genuinely unavailable evidence records missing coverage. The native regression checks the empty old side of an added file; existing unavailable-path tests still require `inconclusive`.

## BUG-20261112-027: Missing ref diagnostics lost the requested target

- Scope: base/commit ref resolution.
- Observed: a nonexistent ref produced only `Review Git target is unavailable`.
- Expected: identify that the supplied ref is missing or is not a commit.
- Reproduction: request a base target with a nonexistent local ref.
- Root cause: the shared Git failure conversion erased the context of `rev-parse --verify`.
- Fix: convert failure at the ref-resolution boundary, including the requested ref in a bounded durable review error.
- Verification: a direct final Core capture-service probe against the Apexo checkout rejects `f01-final-nonexistent-ref` with `Review ref does not exist or is not a commit: f01-final-nonexistent-ref`.
