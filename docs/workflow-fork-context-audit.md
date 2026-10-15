# Workflow fork_context reference audit

Fixed reference commit: `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`.

`session/workflow/host_service.rs:445` rejects `fork_context` for sources without trusted builtin privilege, before `resume_from` clears the fork flag. `manager.rs:162` derives that privilege from resolved `WorkflowSource::Builtin`; an Agent name or caller-supplied script name cannot grant it. The registry's only compiled builtin is `deep-research` (`registry.rs:17`), loaded from `session/workflows/deep_research.rhai`.

The fixed builtin contains no `fork_context` option. The only explicit `fork_context: true` in the Workflow manager/host/builtin subtree is the nonbuiltin rejection test at `manager.rs:1695`, which verifies that the request never reaches the coordinator. Internal parent-context bootstrap exists: `agent/subagent/mod.rs::verbatim_or_normalize_fork` keeps a coherent complete tail within its 80% guard or normalizes background context; disk fallback excludes usage and live tool state. This internal branch alone does not establish a working Workflow entry point that invokes it.

This audit therefore records an unproven user-facing gap, without inventing a builtin policy or privileged caller to exercise it. Task transcript-fork behavior, operator Task wake, and native Session history continuation remain distinct scope items with their own acceptance requirements. Installed positive builtin-fork behavior has not been demonstrated. Existing source-listing and resume comparisons are not fork-execution evidence. No product code changed for this audit.
