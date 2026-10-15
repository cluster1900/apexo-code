# BUG-20261015-237: Private handoff helper treated multiple merge conflicts as a tool failure

- Status: Helper assumption corrected; the actual source conflicts still require review and resolution.
- Scope: The parent's off-tree, hash-checked composition of the Scheduler and headless handoffs.
- Occurrences: One tooling episode; no shared source or product runtime was affected.
- Observed: The preparation helper accepted only git merge-file exit codes zero and one. The real runner merge returned three and emitted three ordinary conflict regions, so preparation stopped before finishing its manifest.
- Expected: Distinguish a merge containing conflicts from an invocation failure, retain the conflict output and require explicit resolution. Never apply unresolved candidates to the shared tree.
- Reproduction: Compose the two verified runner revisions with `git merge-file -p --diff3 current base next`; inspect the returned conflict regions and exit code.
- Root cause: The helper assumed a boolean conflict status instead of allowing the command's conflict count.
- Fix: Preserve nonzero output containing explicit conflict markers as an unresolved candidate; reject nonzero output without that evidence. Hash the complete prepared manifest and keep every candidate off-tree until review.
- Verification: Preparation completed all 33 candidate files. It identified four shared-file compositions: runner interface with one conflict, runner implementation with three conflicts, and two clean Task merges. Shared source remained unchanged. This verifies preparation only, not successful integration or compilation.
