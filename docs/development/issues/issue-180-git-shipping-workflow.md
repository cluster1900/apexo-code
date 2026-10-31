# Issue 180 — Git Shipping Workflow: Diff, Commit, Push, and Pull Requests

## Status and engineering finding

Apexo has Git/worktree helpers, PR checkout support, review concepts, and GitHub connector access, but no unified Desktop shipping contract. The missing behavior is the safe transition from an Agent's working tree to a reviewed branch and PR. Relevant code includes [`packages/apexo/src/git/index.ts`](../../../packages/apexo/src/git/index.ts), [`packages/apexo/src/worktree/index.ts`](../../../packages/apexo/src/worktree/index.ts), [`packages/app/src/utils/diffs.ts`](../../../packages/app/src/utils/diffs.ts), [`packages/apexo/src/cli/cmd/pr.ts`](../../../packages/apexo/src/cli/cmd/pr.ts), and GitHub connector adapters.

## Goals and non-goals

Goals: expose status/diff/hunk staging, conventional commit, safe push, draft/open PR creation, checks and review comment ingestion through one operation contract; associate every operation with Project/Run/worktree; preserve branch protection and user confirmation.

Non-goals: no automatic merge to main, no force push by default, no token handling in Desktop, and no bypass of required checks or review approval.

## Domain model

```text
GitWorkspace
  projectID / locationID / worktreePath
  repository / branch / head / upstream
  dirtyState / conflictState / operationState

GitOperation
  operationID / workspaceID / runID?
  kind: status | diff | stage | unstage | commit | fetch | push | pr | checks
  inputHash / headBefore / headAfter?
  status: queued | running | awaiting_approval | succeeded | failed | cancelled
  resultArtifactID? / errorCode? / eventCursor

PullRequestLink
  workspaceID / provider / repository / number
  head / base / state / draft / checksCursor
```

## Required safety semantics

1. Read and fingerprint `HEAD`, index, worktree, branch, upstream, and repository before every mutation.
2. Stage only explicit file/hunk selections; never stage the entire worktree as a side effect.
3. Show staged file list and diff immediately before commit, then revalidate the fingerprint.
4. Commit returns SHA and preserves the index when hooks or signing fail.
5. Push defaults to fast-forward. A non-fast-forward result stops and displays fetch/compare options.
6. Force push is a separate operation requiring `--force-with-lease`, expected remote SHA, and fresh approval.
7. PR creation/update is idempotent by repository/head/base identity; repeated clicks update the known PR instead of creating duplicates.
8. Main/default-branch mutations are blocked or routed through explicit GitHub protections.

## Protocol and package impact

Add Schema contracts for status, patch/hunk selection, operation state, commit result, push result, PR link, check run, and review thread. Add Protocol groups and Server handlers for read operations and mutations. Local Git commands run in the Location/sandbox/permission boundary; GitHub mutations use the connector and credential reference, never raw token requests from Desktop. Regenerate `packages/client` after public API changes. App/Desktop consumes generated Client methods only.

Every operation emits `started`, `approval_required`, `completed` or `failed`, with `operationID`, workspace, branch, HEAD before/after and event cursor. Do not include credentials in event payloads.

## Desktop and CLI flow

1. Open a Project/worktree and display repository capability status.
2. Refresh status and render file tree plus unified/side-by-side diff.
3. User selects files/hunks/lines; preview staged diff.
4. Optional checks/hooks run in a bounded BackgroundJob and are visible.
5. User confirms commit message and exact staged set; commit executes with a fingerprint fence.
6. Refresh branch/upstream; user confirms push target and remote delta.
7. Create or update a draft PR; attach issue/run/worktree links.
8. Subscribe to checks and review comments; queue failures/comments back into the Session.

CLI/TUI should expose equivalent structured commands and use the same operation API; textual shell output is not the source of truth.

## Persistence, retry, cancellation

Persist operation intent, input hash, workspace identity, and result cursor. Retry is safe for reads, status refresh, failed hooks, and PR reads. Commit/push/PR mutations require revalidation and idempotency checks before retry. Cancellation may stop a queued/background check; once Git has accepted a commit or push, report the committed result rather than claiming cancellation. Recover interrupted operations as `unknown` until the repository/provider is re-read.

## Testing and acceptance

- Selective hunk staging produces a commit containing only selected changes.
- Binary, rename, untracked, conflict, detached HEAD, and in-progress rebase states are explicit.
- Commit hook failure preserves the index and shows output.
- Remote-ahead/non-fast-forward never overwrites the remote.
- Force-with-lease rejects a changed remote SHA.
- Duplicate PR clicks return the same PR link.
- Missing GitHub permission, expired credential, branch protection, network loss, and review/check failure are recoverable.
- Desktop Playwright covers status, diff, hunk selection, commit confirmation, push confirmation, PR creation and review queue.
- Terminal PTY covers the same operations and output cursor/event ordering.

## Implementation phases

1. Read-only status/diff contract and workspace fingerprint.
2. Stage/unstage operations with hunk identity and conflict invalidation.
3. Commit operation, hook runner, approval and audit events.
4. Push/fetch with lease-safe conflict handling.
5. PR/check/review connector projection and idempotent linking.
6. Desktop/CLI workflow and restart recovery.
7. Security audit, migration/backfill, and full acceptance matrix.

## Dependencies and risks

Depends on #179's run/worktree and Review Queue projection; uses #177 event cursors and owner fencing. The primary risk is confusing local command completion with remote acceptance. Every push/PR result must be re-read from the authoritative remote and represented as a durable operation event.
