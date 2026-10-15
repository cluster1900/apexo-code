# Repository Hook trust

Repository Hook trust is explicit host consent to execute Hook configuration from a repository root in Sessions located inside that repository. It does not alter a Session's Location or grant filesystem, sandbox, MCP, LSP or plugin permissions.

Open the Hook panel to inspect the canonical repository root. Allow repository Hooks, then reload an already captured Session to apply its root definitions. A new Session captures current allowed definitions when it first executes. Refreshing the panel or choosing a folder does not grant trust or start model work.

Revoking repository trust prevents new Hook invocations from captured sources in that repository, including previously exact-trusted folder sources. It does not kill an already running Hook; existing cancellation and Session deletion still own and join that work. Regranting does not revive a captured authority from before revocation: reload or start a new Session. A saved grant can remain visible while an independent host folder denial prevents execution; the panel reports current allowance separately.

Existing exact canonical folder entries retain their exact scope. They are not automatically migrated into repository consent. Nested Git repositories require separate consent, and linked worktrees do not implicitly share grants. Home and filesystem roots cannot receive repository grants. Symlink aliases resolve to canonical identity, while changed roots or Git metadata invalidate prior proof.

The native implementation discovers root Hook files under explicit repository consent. The pinned reference source does the same. Installed reference version 1.0.52 additionally loaded nested Hook files in the observed trusted-root case; native repository consent does not silently expand to arbitrary ancestor configuration. This difference is explicit.

Administrator-enforced and signed organization Hook policy is separate from repository trust. A project field, ordinary environment variable, filename or user-owned signing key never makes a repository Hook administrator policy.
