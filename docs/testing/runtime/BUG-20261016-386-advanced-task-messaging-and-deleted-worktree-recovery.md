# BUG-20261016-386: Advanced Task descendant messaging, nested background lifecycle, and deleted worktree recovery (`R05`, `R06`)

## Scope and observed behavior

- **Bug ID**: `BUG-20261016-386`
- **Affected Scope**:
  - `packages/core/src/session/task-store.ts`
  - `packages/core/src/session/task-message.ts`
  - `packages/core/src/session/task-control.ts`
  - `packages/core/src/session/task-role.ts`
  - `packages/core/src/config/task.ts`
  - `packages/core/src/session/task.ts`
  - `packages/core/src/session/runner/llm.ts`
  - `packages/core/src/tool/task.ts`
  - `packages/core/src/session/child-placement-record.ts`
  - `packages/core/src/session/child-placement.ts`
  - `packages/core/src/session/child-resume.ts`
  - `packages/core/src/workflow/store.ts`
  - `packages/core/src/workflow/agent.ts`
  - `packages/core/src/workflow/runtime.ts`
- **Observed Behavior**:
  1. **`R05` (Advanced Task Messaging and Background Nesting)**:
     - `SessionTaskStore.getForParent` and `getBySessionForParent` only matched direct `parentSessionID === ancestorSessionID`, rejecting owned descendant routing for `task_message`, `task_output`, and `task_cancel`.
     - `SessionTaskMessage` formatted `<subagent-message>` envelopes without `sender_agent_id`, `sender_role`, or `remaining_turns` attribution, and lacked per-pair directional turn quota enforcement (`max_messages_per_pair`, default `10`) and delivery depth enforcement (`max_delivery_depth`, default `3`).
     - `SessionTaskRole` hardcoded `max_nesting_depth = 1` and rejected nested `run_in_background: true`.
     - When a child task spawned its own background subagent (`run_in_background: true`) and returned its initial turn text, the child task immediately transitioned to `completed` while its nested background grandchild was still running (`activeNestedCount > 0`), violating Grok Build's owned-subtree settlement contract.
  2. **`R06` (Deleted Worktree Recovery)**:
     - `SessionChildPlacementRecord.Worktree` persisted only the allocated worktree path (`directory`, `device`, `inode`, `headCommit`), without an immutable `Snapshot` (`baseCommit`, `patch`, `untracked` files with sha256/mode/base64 content).
     - `SessionChildPlacement.validateSaved` failed closed whenever a recorded worktree directory was deleted on disk, even when an immutable placement snapshot could deterministically reconstruct the missing worktree at the recorded path inside the same repository.
     - During `task(resume_from)` and `workflow` `agent.resume`, if the source child's worktree had been deleted after completion, `SessionChildResume.prepare` failed before `SessionChildPlacement.prepare` could reconstruct the missing worktree from the source child's durable placement record.

## Expected behavior

1. **`R05`**:
   - Ancestor Sessions (root or intermediate parent) can inspect (`task_output`), message (`task_message`), and cancel (`task_cancel`) any owned descendant task in their subtree while strictly rejecting foreign or sibling sessions (`Task does not belong to the current session`).
   - `<subagent-message>` XML includes `sender_agent_id="..."`, `sender_role="..."`, and `remaining_turns="N"` attributes matching Grok Build (`1.0.52` / `1.0.60`), enforces `max_messages_per_pair` (default `10`) per directional `(sender, target)` pair, and enforces `max_delivery_depth` (default `3`).
   - Configurable `subagent.max_nesting_depth` (default `2`) allows depth-1 children to spawn depth-2 grandchildren (both foreground and background) while rejecting depth `>= max_nesting_depth`.
   - A parent task with active nested background children remains running until its owned background descendants settle and wake it for its final synthesis turn; cascading `task_cancel` cancels all active descendants in the owned subtree.
2. **`R06`**:
   - Fresh worktree allocations capture a bounded immutable `Snapshot` (`baseCommit`, tracked `patch`, and untracked regular files with mode/sha256/base64 content) in `SessionChildPlacementRecord.Worktree`, persisted on both `SessionTaskStore.Record` and `WorkflowStore.ChildRecord`.
   - When a recorded worktree directory is missing (`ENOENT`) during continuation (`task_message`, follow-up `task(task_id)`), fresh-child `task(resume_from)`, or `workflow` `agent.resume`, `SessionChildPlacement.validateSaved` verifies the parent repository identity (`projectID`, `repoRoot`, `gitCommonDir`), prunes stale worktree metadata, recreates the detached worktree at the exact recorded path and `baseCommit`, replays the captured tracked patch and untracked files, verifies the reconstructed snapshot against the receipt, and refreshes `(device, inode)` in `SessionStore`, `SessionTaskStore`, and `WorkflowStore`.
   - Deleted non-worktree `cwd` directories, symlinked or non-empty target paths, paths outside the managed worktrees root, corrupted snapshots, and foreign repositories continue to fail closed without silent fallback to the parent directory.

## Reproduction and negative controls

1. **`R05` Negative Controls**:
   - In `packages/apexo/test/session/task-depth.test.ts` and `packages/apexo/test/session/task-message.test.ts`, verified that depth-2 children attempting to spawn depth-3 tasks fail with `Nested subagent calls are disabled at depth 2 (max_nesting_depth = 2)`, foreign sessions attempting descendant `task_message` / `task_output` / `task_cancel` fail closed, directional pair messages beyond `max_messages_per_pair` fail with `Message quota exceeded for pair`, and delivery depth beyond `max_delivery_depth` fails closed.
2. **`R06` Negative Controls**:
   - Before enabling `reconstructDeletedWorktree` in `SessionChildPlacement.validateSaved` and `sourcePlacement` forwarding in `SessionChildResume.prepare`, removing a worktree directory before `task(resume_from)` or `workflow` `agent.resume` failed with `Saved child placement directory is unavailable`.
   - Added 5 adversarial negative-control tests in `packages/apexo/test/session/child-placement-admission.test.ts` proving fail-closed rejection when:
     1. A deleted `cwd` (non-worktree) directory is missing on continuation.
     2. A deleted worktree path is replaced by a symlink before reconstruction.
     3. A deleted worktree record lacks an immutable snapshot receipt.
     4. A deleted worktree path is outside the managed worktrees root.
     5. A deleted worktree snapshot contains a corrupted tracked diff patch.

## Fix

1. Updated `SessionTaskStore`, `SessionTaskMessage`, `SessionTaskControl`, `SessionTaskRole`, `ConfigTask`, `SessionTask`, `SessionRunnerLLM`, and `TaskTool` to support owned-subtree descendant lookup, sender attribution (`sender_agent_id`, `sender_role`, `remaining_turns`), directional pair quotas (`max_messages_per_pair`), delivery depth limits (`max_delivery_depth`), configurable nesting depth (`max_nesting_depth`, default `2`), nested background task lifecycle hold (`activeNestedCount`), and cascading subtree cancellation.
2. Updated `SessionChildPlacementRecord`, `SessionChildPlacement`, `SessionChildResume`, `SessionTaskStore`, `WorkflowStore`, `WorkflowAgent`, `WorkflowRuntime`, and `SessionTask` to capture immutable worktree snapshots on creation, persist `placement` on `WorkflowStore.ChildRecord`, pass `sourcePlacement` into `SessionChildPlacement.prepare` before `SessionChildResume.prepare`, reconstruct missing worktrees only from verified immutable snapshots, and synchronize refreshed `(device, inode)` across stores.

## Verification

- Focused unit & E2E suites (from `packages/apexo`):
  - `bun test ./test/session/task-store.test.ts ./test/session/task-depth.test.ts ./test/session/task-completion.test.ts ./test/session/task-background-ownership.test.ts ./test/session/task-message.test.ts ./test/e2e/v2-task-message.e2e.test.ts ./test/e2e/v2-task-nested.e2e.test.ts` -> **26 pass, 0 fail, 366 assertions**
  - `bun test ./test/e2e/v2-child-placement.e2e.test.ts ./test/session/child-placement-admission.test.ts ./test/session/child-placement-revocation.test.ts ./test/e2e/v2-workflow-resume.e2e.test.ts` -> **21 pass, 0 fail, 232 assertions**
- CLI, Rebuilt Desktop, and Installed Grok Build (`1.0.60`) parity scripts:
  - `bun script/grok-native-task-nested.mjs cli` & `desktop` -> **6/6 checks, 20 provider calls each**
  - `bun script/grok-native-task-advanced-official.mjs` -> **3/3 scenarios, 11 conversation requests**
  - `bun script/grok-child-placement.mjs cli cwd` & `desktop cwd` -> **8/8 checks, 8 provider calls each**
  - `bun script/grok-child-placement.mjs cli worktree` & `desktop worktree` -> **9/9 checks (including deleted worktree reconstruction across process crash + restart), 8 provider calls each**
  - `bun script/grok-workflow-placement.mjs cli` & `desktop` -> **6/6 checks (including deleted worktree reconstruction across process crash + restart), 4 provider calls each**
  - `bun script/grok-task-placement-official.mjs worktree` -> **7/7 checks**
  - `bun script/grok-workflow-placement-official.mjs` -> **7/7 checks**
