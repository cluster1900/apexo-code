# BUG-20261014-011: Non-Git Permission Pattern Did Not Match Worktree-Relative Path

- **Status**: Fixed & Verified; **Verified Occurrences**: 2; **Linked Rule**: None (below threshold).
- **Scope**: Non-Git `read: deny` scenario in `grok-goal-fallback.mjs`.
- **Observed**: A bare filename pattern (`secret.txt`) did not match the file in non-Git workspaces, allowing mtime fallback evidence to include `secret.txt`.
- **Expected**: The configured `deny` pattern matches the path format passed to the permission evaluator in non-Git projects so restricted files are omitted.
- **Reproduction**: In `packages/apexo`, run `bun script/grok-goal-fallback.mjs cli|desktop`.
- **Root Cause**: Non-Git global projects have `/` as their worktree root (`packages/apexo/src/project/project.ts` and `tool/read.ts`), so read permissions evaluate against paths relative to `/` rather than a bare filename.
- **Fix**: Include `**/secret.txt` alongside the bare filename rule in the fixture to cover non-Git worktree-relative paths while preserving content-isolation assertions.
- **Verification**: Both `grok-goal-fallback.mjs cli` and `desktop` passed all 5 scenarios (100 model HTTP requests each), confirming `omitted=1` and no restricted content in manifests, patches, or verifier receipts.

## Independent native Workflow resume fixture occurrence

The new source-local permission boundary fixture configured an absolute path for a file inside the native Location. It observed the read result instead of the expected denial. Resolving the temporary path spelling did not change that result. Inspection of `LocationMutation.resolve` established the actual native contract: internal permission resources are Location-relative; only external resources use canonical absolute paths. The fixture now denies `secret.txt`, preserving the absolute path passed to the read tool. No production permission behavior changed.

Pinned Bun 1.3.14, `bun test test/workflow/resume-admission.test.ts --timeout 30000` in `packages/apexo`: two tests, 14 assertions, zero failures. The real Created listener tightens source-local rules in one case and relaxes an already captured denial in the other; both resumed reads are denied and source history remains unchanged. The initial and canonical-path retry failures are one authoring episode, not two. This shares the mistaken permission-resource spelling assumption with the earlier fixture while documenting the different native Location contract explicitly.
