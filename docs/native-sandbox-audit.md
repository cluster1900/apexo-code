# Native command sandbox audit

G02 remains open. This audit supports a bounded, opt-in native command sandbox; it does not implement or verify whole-agent confinement.

## Current authority

Apexo's native Bash uses AppProcess with normal host authority. Direct read/edit/write tools use in-process filesystem services. Project worktree records named `sandboxes` and Electron renderer isolation do not change that authority. Irreversibly confining the shared CLI/Desktop server would also confine unrelated Sessions and Locations, so it is not a safe integration boundary.

## Reference boundaries

Pinned source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` contains both whole-process profiles and a separate daemon command sandbox. The whole-process implementation covers direct filesystem tools and descendants. The command implementation confines only the launched process and descendants, preserves daemon authority, rejects failed wrappers and supports network-off or a controlled proxy. These scopes must not be conflated.

Installed Grok 1.0.52 on macOS 26.6.2 was exercised with owned directories and a local deterministic provider:

| Case | Observation |
| --- | --- |
| Workspace profile | In-workspace write allowed; outside write and protected configuration write denied with EPERM |
| Custom workspace-derived literal/glob denial | Same write limits; matched secret read denied |
| Read-only, normal HOME with isolated GROK_HOME | Workspace write denied in the initial audit |
| Read-only, fully isolated HOME | Startup refused because a system Docker socket symlink resolved outside the isolated automatic deny set; no provider/tool execution |
| Existing workspace hardlink to outside file | Writing the in-workspace alias modified the outside inode under both executing profiles |

The fully isolated final run served four model-turn requests and separate valid ancillary title responses. Each process exited and was reaped; owned test directories were removed. No system socket, global OS configuration or unrelated process was changed. The initial fixture assumptions are recorded in [BUG-20261015-059](testing/test-fixtures/sandbox-reference-isolation.md).

## Apexo-owned kernel probes

A small independent deny-default Seatbelt profile, passed to the absolute system sandbox executable, was tested against owned files and child processes. It allowed the designated workspace write and denied outside writes, symlink escape, protected control-file writes and directory renames, denied-file reads/renames/new hardlinks, network connection attempts, and a descendant shell's outside write.

Two limitations were observed directly:

- A pre-existing in-workspace hardlink can name an outside inode. Denying new links does not revoke that existing alias. This is a path-access boundary, not general inode isolation. Unsandboxed external writers also remain outside its protection. No incomplete workspace scan will be described as race-free security.
- Passing an already-open writable file descriptor explicitly to the sandboxed process bypassed path write denial. Ordinary child spawning closed the actual parent descriptor; sandbox admission must reject arbitrary inherited descriptors and file-backed stdio. Intended pipes remain necessary for input/output.

These are capability probes, not production tests. The planned service must still be verified through real AppProcess, native PermissionV2, Session lifecycle, CLI and rebuilt Desktop execution.

## Approved initial scope

The first implementation is off by default and reports `native_commands` scope. Workspace and read-only choices are immutable for an admitted Session and tied to its durable Created identity. Children inherit trusted private authority and may only narrow it. Network is blocked initially, explicitly narrower than the installed whole-process workspace profile. A denied or unavailable command never retries outside the sandbox.

Status separates stored policy, available backend and the latest confirmed execution receipt. Availability alone is never called enforcement. The existing process manager owns spawn, output limits, timeout and joined cancellation; the sandbox supplies the policy and wrapped command.

Full agent filesystem enforcement, direct tool workers, other tool hosts, advanced profile/glob policy, network proxy/grants and Linux acceptance remain separate deliverables. No Grok runtime or orchestration engine is embedded.
