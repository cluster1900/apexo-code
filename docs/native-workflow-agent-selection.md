# Native Workflow agent selection

Workflow Rhai calls now accept `agent_type` in `agent` and each `parallel` child option. The value names a visible native Apexo Agent with `subagent` or `all` mode. Unknown, hidden, disabled and primary-only agents fail before child creation. Native parent `task` permission controls delegation to the selected Agent ID.

```rhai
let result = agent("Review the patch", #{agent_type: "reviewer", capability_mode: "read-only"});
complete(result.output);
```

Apexo still owns the Workflow journal, managed child Session, model resolution, permissions, tool execution, lifecycle and provider stream. This does not invoke a Task executor or a reference-runtime executable. Omitted `agent_type` preserves Apexo's existing parent-agent inheritance.

The effective model is selected from the immutable journal selection, explicit Workflow model, selected Agent model, then parent/default model. Agent and effective model are journaled before child creation. Re-entry retains that selection even if an Agent's default model changes. A mismatched existing child or unavailable saved model fails rather than silently selecting another model.

The original selected-Agent and parent permission ceilings are saved with the selection. Each admission additionally intersects the current parent chain. Current selected-Agent policy remains active during native tool execution. A child Session grant or later policy relaxation cannot loosen the original ceiling. The existing runner receives this authority through the live Workflow role because the process-global coordinator does not inherit the caller's fiber context. Task roles retain precedence.

Pause/resume uses existing durable Workflow receipts. Completed calls replay without another provider turn. Existing process-restart restrictions on unfinished Workflows remain in force; this feature does not implement reference `resume_from` semantics.

## Reference comparison scope

Reference source revision: `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`.

- `xai-workflow/src/host.rs` decodes `agent_type`; `xai-grok-shell/src/session/workflow/host_service.rs` forwards the selected type and defaults omission to `general-purpose`.
- `xai-grok-shell/src/agent/subagent/handle_request.rs` resolves the definition, rejects unavailable/disabled types and checks the parent's allowed agent set.
- Apexo deliberately preserves its prior omitted-option behavior instead of changing existing scripts' agent identity. Explicit selection uses native Agent configuration and native Task permission.
- `fork_context`, `resume_from` and `isolation_worktree` remain separate future slices. This change makes no claim that they are implemented.

## Verification

Private focused verification on pinned Bun 1.3.14 passes 40 tests / 273 assertions:

`bun test test/workflow test/e2e/v2-workflow-agent.e2e.test.ts test/e2e/v2-workflow-model.e2e.test.ts --timeout 30000` from `packages/apexo`.

The new provider test observes the actual selected Agent system prompt and model, an explicit Workflow model override, a parent-denied private read and a successful public-file read, durable pause/resume, and zero provider work for rejected agent selection. The held Created-notification regression proves late task revocation prevents all child provider work. Direct real-service tests exercise held approval revocation, selected-agent removal, immutable saved model selection and permission ceilings after child grants.

`script/grok-workflow-agent.mjs` supplies CLI and rebuilt Desktop acceptance for the integrated source. `script/grok-workflow-agent-official.mjs` supplies an isolated installed Grok comparison for explicit, omitted and missing agent types. The shared source CLI passes four checks with two child provider calls, including durable replay/restart and rejected selection. The isolated installed comparison passes all three cases with two child and eight total provider requests; unknown selection returns an error string and zero child calls even though the script explicitly completes its Workflow with that string. Native rejected selection uses its own failed receipt contract. The newly rebuilt Desktop backend passes the same four checks / two provider calls. The combined shared Task/Hook/Workflow gate passes 76 tests / 675 assertions across 24 files; all 21 workspace typecheck tasks pass (19 valid cache hits). The repository unit/HTTP aggregate still needs a fresh run for this tranche. No public Protocol, HttpApi or generated client changes are required.
