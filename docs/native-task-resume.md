# Native Task transcript continuation

The native `task` tool accepts `resume_from`, the Session ID of a completed, failed, or cancelled direct child. It creates a new Task child and imports the source's durable messages and tool results before admitting the new prompt. The source may be Task-owned or Workflow-owned; its owner, transcript, and receipts remain unchanged.

```json
{
  "description": "Continue the earlier investigation",
  "prompt": "Use the earlier findings to check the remaining case.",
  "subagent_type": "helper",
  "resume_from": "ses_source"
}
```

The saved source Agent and model take precedence over the requested `subagent_type`. The source Agent must still exist and be allowed under current parent policy. Source read-only and tool restrictions persist. A Workflow source that inherited its parent's primary Agent may retain that selection without making arbitrary primary Agents available to ordinary Task creation.

`resume_from` and `task_id` cannot be combined: `task_id` continues an existing Task, while `resume_from` creates a fresh child from history. A running source, unrelated Session, partially imported source, process-interrupted Task, or foreign workspace/sandbox binding is rejected. Task cwd, retained Task/Workflow worktree placement, and verified deleted-worktree reconstruction from immutable placement snapshots (`R06`) are implemented; see [Native child placement](native-child-placement.md).

Imported history preserves tool state and provider context but does not replay historical tools, pending permissions, processes, Goal leases, or old domain system context. Current native producers build the new child's system context. Historical token usage remains in the transcript; only new provider turns produce new billing and Goal usage receipts. Failed or incomplete imports cannot run, including a retry of a child created before its import began.

Apexo owns the execution, persistence, permission checks, CLI and Desktop backend. Grok Build is only a source and isolated-runtime behavioral reference. See [BUG-20261015-364](testing/runtime/task-resume-history.md) for verification and the bounded acceptance status.

## Shared integration acceptance

Shared integration passes the combined Task/LSP gate (55 tests / 565 assertions), all 21 workspace typechecks, canonical Client consistency and unified App/Desktop builds. Source CLI and the rebuilt Desktop backend each pass four checks / seven provider calls. Existing Task panels are unchanged; these checks do not claim new GUI controls. The isolated installed reference remains three checks / two child turns, with nine total requests including ancillary work.
