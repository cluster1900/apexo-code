# BUG-20261015-369: Native Task and Workflow child placement

## Scope and observed behavior

Task `cwd` and `isolation: "worktree"`, and Workflow `isolation_worktree`, were not implemented by the native child admission path. An initial real HTTP negative control had 0 passing tests, 2 failures and 14 assertions: child Sessions retained the parent directory. Installed Grok Build execution demonstrated both effective Task placement modes and Workflow worktree execution, including dirty tracked files, untracked files, isolated writes and retained placement during resume.

This was a missing capability, not a regression of ordinary Task execution. Apexo must own placement, permission admission, Session persistence and execution.

## Implementation

A shared Session child-placement domain uses canonical ProjectCopy/Git facilities. A private immutable placement record binds canonical directory, inode/device, project and repository. The native global execution owner provides guarded cross-Location inspection without changing SessionExecution's ID-based public interface. Child execution continues through the existing managed-child coordinator and runner.

Fresh worktrees preserve a verified working-tree snapshot. Resumed Task or Workflow children retain the source placement and canonical history-copy behavior. Command sandbox derivation retains parent network and protected-path restrictions. Current parent and target Agent authority intersect with the original ceiling, including translated absolute restrictions.

## Admission defects found during review

The first draft checked external-directory authorization only for fresh placement. A real provider fixture then resumed an external child after revocation: the next provider request contained the child prompt instead of the expected parent rejection. Current authorization now applies to saved placement and is rechecked after waits. Separate resume and follow-up tests compare source history and durable inbox rows, not only result text.

The first draft also allocated a worktree before target Agent admission without cleanup. The corrected negative fixture observed the target Agent rejection, no child Task record, and one registered worktree where zero was expected (0 passing tests, 1 failure, 6 assertions). A scoped finalizer now removes only an unchanged, exactly identified allocation with no admitted child. Modified or admitted copies remain owned data. Cleanup uses the source snapshot captured before allocation, so a modification delivered through the real ProjectCopy Updated event cannot become a new deletion baseline. Registration occurs before project admission once exact allocation identity is known; failures before identity proof retain unknown data rather than deleting it.

The corrected initial boundary run passed 5 tests and 28 assertions. It covered external resume rejection, exact unadmitted allocation cleanup, and parent denial, target Agent reload and filesystem replacement at the actual child Created boundary. Extended continuation and persisted-reference assertions are recorded in the final validation below.

## Fixture and validation distinctions

A source fixture initially initialized Git after the test Location had already bound its project; using a Git-initialized fixture before Location creation corrected that setup. An allocation fixture initially transformed `{directory}` while the persisted Location reference included `workspaceID: undefined`; these are distinct Effect cache keys. The final test uses actual persisted parent and child references and verifies the runtime boundary, rather than treating a passing unrelated cache entry as proof. A provider configuration delimiter failure is recorded under BUG-20261014-082 and is not a product failure.

A real CLI direct-Session probe then failed twice with `ProjectCopy.SourceDirectoryNotFoundError` and no child. Deferring backend startup until after Git initialization did not fix it, disproving the initial fixture-only explanation. Direct Session creation does not register the root with ProjectDirectories; TestInstance had supplied this prerequisite. The placement domain now resolves the current parent Location's Git project, checks its project ID, and registers only that matching root before canonical copy creation. Both Task CLI placement modes then passed; arbitrary requested cwd does not take this registration path.

The initial production draft's direct LocationServiceMap dependency was removed in favor of the narrow execution-owned capability. No alternate runner, foreign runtime or legacy execution loop was introduced.

## Reproduction and verification

From `packages/apexo`, run the child-placement E2E, admission and revocation tests with pinned Bun and `--timeout 30000`. Run `script/grok-child-placement.mjs cli cwd`, `script/grok-child-placement.mjs cli worktree`, and `script/grok-workflow-placement.mjs cli`; repeat against the rebuilt Desktop backend. Installed reference scripts are behavioral comparisons only.

The focused sandbox and Workflow run passed 3 tests and 53 assertions, including actual shell output, parent-write denial, Git metadata write denial and network denial. The expanded run passed 9 tests and 92 assertions, including saved external cwd follow-up and persisted child Location cache identity. Core and Apexo typechecks and canonical Client/SDK generation passed. Task CLI cwd and worktree each passed eight checks with eight provider calls, including backend restart. A subsequent review added final model/sandbox preflight and modified-allocation retention; their focused runtime checks and Workflow/nested CLI/Desktop acceptance remain pending until recorded in the integration handoff. Missing-placement reconstruction remains explicitly unsupported; it fails closed.

A Workflow CLI run timed out at the initial recovered-backend readiness deadline with an empty backend log and zero provider calls while concurrent package typechecks were still running. This is an unresolved startup observation until the unchanged serialized rerun; it is not evidence that placement execution failed or that load is a proven root cause.

The serialized Workflow CLI rerun then reached fixture Git initialization but inherited global commit signing and failed with `gpg: signing failed: Bad PIN` before backend startup. Placement acceptance scripts now disable commit signing only for their fixture Git subprocesses; no user Git configuration is changed. This setup failure is separate from the earlier empty-log startup timeout.

A final strategy review removed unconditional forced deletion from copy-application/source-race failures. Those failures lack a verified post-copy receipt, so their allocation is retained and its directory stays in the typed Git worktree error. This deliberately trades cleanup completeness for preservation; no universal no-orphan guarantee is made.

The real ProjectCopy Updated-event control also wrote a Git-ignored file before target admission rejected the child. The pre-fix run failed (0 passing tests, 1 failure, 6 assertions): the allocation was deleted despite the foreign edit. Git patch capture excludes ignored files. Cleanup now enumerates at most 1,024 filesystem entries without traversing symlinks and consults canonical Git ignored-path classification. Any ignored entry, symlink, oversized enumeration or unknown failure retains the allocation. The ordinary non-ignored foreign-change control remains separate.

The first combined regression attempt ended with 29 passing tests, 2 failures and 323 assertions. Both failures occurred in fixture `git commit` setup (exit 128), before product admission; those assertions did not retain stderr, so they are not independently claimed as proven signing failures. The actual Workflow CLI Bad PIN output above established signing interference in the same acceptance session. All new fixture Git subprocesses now explicitly disable signing.

## Final private handoff verification

The final combined run passed 32 tests, 0 failures and 339 assertions across nine files. This includes the two saved external-directory revocation paths, actual parent/target/model/filesystem changes at Created, unchanged allocation cleanup, non-ignored and ignored foreign-edit retention, plus prior Task and Workflow transcript-resume regressions. The final Core typecheck passed. The Apexo typecheck passed before the final bounded cleanup guard and fixture-only unsigned/ignored variants; the composed shared typecheck must cover that exact final snapshot.

Task CLI cwd and worktree probes each passed eight checks with eight provider turns. Workflow CLI passed five checks with four provider turns. Nested Task CLI passed three checks with six provider turns and verified the immediate parent ID, actual nested directory and real child write. The successful Workflow run used per-command unsigned fixture Git; it does not establish a cause for the earlier empty-log startup timeout. Client and SDK generation completed successfully. Rebuilt Desktop and the composed shared gates remain integration acceptance, not privately claimed results.
