# Native Workflow resume

Workflow scripts accept `resume_from` with a terminal direct child Session ID. A resumed call creates a fresh Workflow-owned child and imports the source's durable native transcript and Todo state before admitting its new prompt. The source and its managed owner remain unchanged. Both Workflow and native Task sources are supported, including completed, failed and cancelled sources with nonempty durable history and saved execution selection.

The source's saved Agent and provider/model take precedence over the requested Agent and model. An explicit supported reasoning effort may select a reasoning-only variant on a fresh resumed child after the source provider/model is pinned. This follows reference `handle_request.rs` lines 850–894: source-model pinning runs before effort application with `EffortTarget::NewSession`. An existing child retry retains its saved variant and rejects incompatible effort resolution. The original authority ceiling, source-local current permissions and current parent/Agent permissions all constrain execution. A source read-only capability remains read-only; Task-origin scheduler authority is not copied. The adapter verifies direct ownership, terminal/idle state, Created identity, durable revision, source selection and sandbox binding before child creation, around history import and before each drain. A source that changes, remains active or lacks durable selection evidence is rejected.

Historical tool state and usage remain context. Old tools, pending permission requests, processes, Goal leases and transport receipts do not restart or transfer. The fresh child uses the existing native Session coordinator and one stream per new provider turn. Only new turns contribute Session, Workflow and Goal usage. Current SystemContext producers initialize a fresh epoch; the source's historical system updates do not override current policy. Interrupted or inconsistent imports remain quarantined before input promotion or provider work. See [Session history copy](native-session-history-copy.md) for replay, mapping and accounting boundaries.

This slice supports the source's existing same-workspace sandbox placement. It rejects unavailable or different placement rather than silently relocating context. Native worktree reconstruction and `fork_context` remain separate features. Historical Workflow children created before immutable model/authority/capability selection was saved cannot safely resume and are rejected. Omitted `agent_type` retains Apexo's existing inherited-parent behavior.

## Reference

Compared source: Grok Build commit `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, under `crates/codegen/xai-grok-shell/src`:

- `session/workflow/host_service.rs::spawn_agent` allocates a fresh request ID and passes `resume_from`.
- `agent/subagent/handle_request.rs` resolves a terminal direct-child source, pins its Agent/model and checks current allowed-agent policy.
- `task/coordinator.rs` resolves same-parent completed source metadata independently of Task versus Workflow origin.
- `agent/subagent/mod.rs::bootstrap_initial_context` copies transcript, usage context and tool state into the fresh child. `durable_resume_source_from_meta` accepts completed, failed and cancelled metadata.

The installed-runtime comparator is isolated from the real user home and network, except its exact local provider port. No Grok executable or orchestration library is a migrated product dependency.

## Verification scope

The focused native tests cover completed Workflow, failed Workflow and cancelled Task sources; real tool results; saved Agent/model; unchanged source ownership and transcript; independent new usage; native replay after source deletion; fresh message IDs; interrupted import quarantine; source Created/revision/Todo changes; current SystemContext; and source-local permissions changed at the new child's Created boundary. The real CLI/Desktop harness restarts the process between source completion and resume, then checks durable transcript continuation, selection, capability and accounting. Final executed results are recorded in the reviewed handoff.

Pinned Bun 1.3.14 on the coherent composed candidate: the focused 17-file gate passed 45 tests / 365 assertions; Core and Apexo package typechecks and canonical SDK/Client generation exited successfully. `bun script/grok-workflow-resume.mjs cli` passed five checks / three provider calls, including restart between source and resume. `bun script/grok-workflow-resume-official.mjs` passed with two child turns; the returned source and resumed IDs differ and the resumed provider request contains the earlier user/assistant history.

Shared source CLI and the unified rebuilt Desktop each repeat all five checks / three calls. All 21 workspace typechecks and canonical Client/SDK generation pass. All Workflow cases pass in the combined 23-file gate, whose overall result is 65 passes / one separate Shell readiness timeout; see [BUG358](testing/test-stability/native-shell-config-provider-timeout.md). Refreshed full aggregate acceptance remains pending.
