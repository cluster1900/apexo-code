# Native child placement

Task accepts `cwd` for an existing directory or `isolation: "worktree"` for a fresh Git worktree. Workflow accepts `isolation_worktree: true`; it does not expose a `cwd` option. These options use Apexo's ProjectCopy, Git, Session and permission services. No Grok executable or orchestration runtime is needed.

Fresh worktrees capture the parent's HEAD, tracked changes and untracked files. A changed source snapshot fails admission. Child commands run in the recorded directory, and Task details expose `worktreePath` for worktree placement. A terminal direct child's `resume_from` creates a fresh managed Session with native history import and retains its recorded placement. Task follow-up reuses its owned Session. New placement options cannot replace an existing placement during continuation.

Placement records preserve canonical directory, filesystem identity, project and Git repository identity. The process-global Session execution owner supplies a narrow inspection capability for the target Location, protected by both Session ownership and that Location's reload guard. Model execution remains in the ordinary Location-scoped runner. Persisted Location references and admission inspection use the same cache identity.

Parent and selected target Agent permissions intersect with the original authority ceiling. Absolute parent resource restrictions are also translated into child-relative equivalents, preserving both sets. External `cwd` requires current external-directory authorization on initial admission and every continuation. Admission rechecks policy and filesystem identity after asynchronous boundaries. A derived command sandbox retains the parent's profile, network restriction and protected paths while allowing writes only under the selected child workspace.

An allocation that has no admitted child is removed only if its recorded filesystem identity, HEAD and captured changes remain unchanged. An admitted or externally modified allocation is retained. Cleanup also retains any allocation containing ignored entries, symlinks, more than 1,024 enumerated entries, or an unknown inspection failure. Unknown cleanup identity is never grounds for forced removal. A failed copy/application or source-race check retains its allocation and reports the directory in the typed copy error.

Deleted or replaced placements fail closed. Reconstructing a missing worktree, switching an existing child's placement, and Workflow context-fork policy are outside this slice. Desktop acceptance uses the rebuilt native backend; unchanged Task panels retain their earlier UI coverage.

## Shared integration acceptance

The composed Task/Workflow/Goal gate passes34 tests /426 assertions across10 files. Source CLI and the unified rebuilt Desktop backend each pass Task cwd8 checks /8 calls, Task worktree8/8, Workflow worktree5/4 and nested Task3/6. Canonical generation, isolated-index Client consistency, all21 uncached workspace types and App/Desktop builds pass; Apexo typechecking also passes after the Goal fixture amendment. These backend checks do not imply deleted-worktree reconstruction or new Task panel controls. The isolated installed reference and its version boundaries remain documented separately.
