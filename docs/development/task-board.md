# Remaining work packages

Development is paused. This is a proposed review/ownership plan, not an instruction to start agents or resume implementation. The [checkpoint](progress.md) defines current status; [the guide](README.md) defines setup and verification.

## Suggested first review pass

1. Preserve the complete dirty worktree, including untracked files, and inspect the changed-file inventory.
2. Review native ownership, permissions and persistence changes before UI polish: Session admission/execution, child placement, Memory publication, Plugin data retirement and Hooks.
3. Inspect the last aggregate failure and the independent Goal fixture repair. Decide whether to first stabilize the existing integrated scope before adding another feature.
4. Review the unmerged Hook patch separately. It is not present in production files and should not be confused with the already integrated Hook source/import work.
5. Choose one bounded task below per contributor. Coordinate generated files and shared service composition centrally.

## Work packages and acceptance

| ID | Work / current state | Main entrypoints | Required result |
| --- | --- | --- | --- |
| R01 | **Current integrated regression gate.** **Completed (Phase 1)** | `packages/core/src/effect/layer-node.ts`, `packages/apexo/src/cli/cmd/plugins.ts`, `packages/apexo/test/e2e/v2-media-options.e2e.test.ts`, root Turbo tasks, `packages/apexo/script/httpapi-exercise.ts` | Fixed `BUG-20261015-382`, `BUG-20261015-383`, and `BUG-20261015-384`. All 4 required gates pass (`21/21` typecheck, `6/6` test packages / `4,719` tests in `apexo` with `0` failures, `check:generated` clean, `343/343` HTTP API scenarios across coverage/auth/effect). |
| R02 | **Repository Hook trust.** **Completed (Phase 1)** | [Handoff](handoffs/repository-hook-trust/README.md); Core `hook-project-trust.ts`, `hooks.ts`, `hook-dispatch.ts`, `hook-network.ts`; App/TUI Hook management | Integrated across Core, Protocol, Server, Client, SDK, App, TUI, and CLI (`BUG-20261015-379`, `BUG-20261015-381`). Verified negative control, `16` unit/TUI tests, `7/7` CLI + `7/7` Desktop backend checks, `5/5` browser + `5/5` native Electron UI (`en`/`zh`/`zht`) checks, and Grok Build `1.0.52` parity. |
| R03 | **Optional legacy semantic Memory.** **Completed (Phase 2)** | [Design](handoffs/legacy-memory-semantic-design.md); Core `config/memory.ts`, `memory-embedding.ts`, `memory-search.ts`, `memory-legacy-native.ts`, `memory-context-native.ts` | Implemented authenticated optional API embeddings, content/model-bound SQLite `chunks_vec` + `embedding_meta` cache, hybrid retrieval and durable semantic-flush dedup (`0.92` threshold, `BUG-20261016-385`). Verified across `84` unit/E2E tests and `6/6` CLI + `6/6` Desktop backend checks (`grok-memory-legacy-native.mjs`). |
| R04 | **Structured usage CLI.** **Completed (Phase 1)** | [Handoff](handoffs/session-usage/README.md); `packages/apexo/src/cli/cmd/usage.ts`, `packages/apexo/test/cli/usage.test.ts` | Implemented `apexo usage <sessionID> [turn]` across native durable event ledgers and compatibility projected histories (`BUG-20261015-381`). Verified with negative control, `10` unit/adversarial tests (`129` assertions), and side-by-side CLI, Desktop, and Grok Build `1.0.52` comparison. |
| R05 | **Advanced Task messaging and background nesting.** **Completed (Phase 2)** | Core `session/task-store.ts`, `session/task-message.ts`, `task-control.ts`, `task-role.ts`, `config/task.ts`, `session/task.ts`, `runner/llm.ts`, `tool/task.ts` | Implemented owned-subtree descendant routing (`task_output`/`task_message`/`task_cancel`), `<subagent-message>` attribution (`sender_agent_id`, `sender_role`, `remaining_turns`), directional pair quotas (`max_messages_per_pair`), delivery depth (`max_delivery_depth`), configurable nesting depth (`max_nesting_depth`), and nested background task lifecycle (`BUG-20261016-386`). Verified across `26` unit/E2E tests (`366` assertions), CLI + Desktop (`6/6` checks, `20` calls each), and Grok Build (`3/3` scenarios). |
| R06 | **Deleted worktree recovery.** **Completed (Phase 2)** | Core `session/child-placement.ts`, `child-placement-record.ts`, `child-resume.ts`, `task-store.ts`, `workflow/store.ts`, `workflow/agent.ts`, `workflow/runtime.ts` | Implemented immutable worktree `Snapshot` capture (`baseCommit`, `patch`, `untracked`), verified deleted-worktree reconstruction in `SessionChildPlacement.validateSaved`, `sourcePlacement` forwarding before `SessionChildResume.prepare`, and `(device, inode)` synchronization (`BUG-20261016-386`). Verified across `21` unit/E2E tests (`232` assertions, including `5` fail-closed negative controls), CLI + Desktop Task (`9/9`) and Workflow (`6/6`) checks, and Grok Build (`7/7` each). |
| R07 | **Whole-agent sandbox.** Not implemented | Core `command-sandbox`, `session/command-sandbox.ts`, tool registry, Hook/MCP/LSP launch services | Design a common enforcement boundary for in-process file access and external helpers before claiming isolation. Preserve immutable inheritance and fail-closed behavior. Prove allowed access plus writes/network/path/symlink bypass rejection through each covered tool family. Renderer sandbox settings are insufficient. |
| R08 | **Linux sandbox and richer policies.** Not implemented | Existing sandbox policy/paths and process launch code; Linux test/container setup | Implement supported kernel/policy behavior and custom/deny-pattern contracts. Verify on actual Linux with correct init/reaping, child processes and network boundaries. Existing scoped Linux unit passes do not prove kernel enforcement. Coordinate the design with R07. |
| R09 | **Administrator/organizational Hook and Plugin policy.** Not implemented or not fully audited | Core Hook config/dispatch/snapshots; Apexo Plugin store/bundle capture; [Hook contract](../grok-hooks-parity.md), [Plugins](../plugins-feature.md) | Pin real configuration provenance and precedence. Enforced policy must not be editable away by ordinary project configuration. Keep trusted key/deployment requirements explicit; test revocation and captured-reader behavior. Ordinary repository consent is not administrator enforcement. |
| R10 | **Media policy and service completion.** Missing contracts / external validation | Core media tools, Apexo media adapter, [media contract](../grok-media-parity.md), [native options](../native-media-options.md) | Bind team ZDR to actual supported claims, implement or explicitly bound transient signing, and verify authorized real storage/provider paths. Maintain read/edit authority and never forward provider credentials to unrelated CDN hosts. Local mocks do not certify production services. |
| R11 | **Product comparison audit.** Bounded differences remain | [Audit](../grok-build-contract-audit.md), current Session/dashboard/context UI, CLI export/trace/fork | Demonstrate actual reference behavior before opening new feature work. Distinguish native top-level fork from existing Task fresh-child resume, current context metrics from a usage ledger, local trace bundles from vendor uploads. Discard only proven stubs/ignored options, not valid unfinished scope. |
| R12 | **Cross-platform and external acceptance.** Incomplete | Existing feature-specific `grok-*` fixtures; Desktop packaging; native clipboard, Git authentication and PTY paths | Complete a named macOS/Linux/Windows matrix per changed feature, real clipboard input, required authenticated remote Git/service paths and clean-host UI measurements. Record unsupported environments and missing credentials explicitly. Do not describe unavailable tests as passes. |

R01 is the recommended first work package when development resumes because it validates the already integrated code. R02 and R04 are narrower implementation slices than whole-agent sandboxing. This ordering is a review suggestion; it does not change the agreed feature scope or invent a new deadline.

## Representative feature checks

Run these from `packages/apexo` with pinned Bun and required local fixture dependencies. They are examples for the currently integrated slices, not a substitute for the complete gate or reading each script's flags.

```sh
bun script/grok-lsp-socket-native.mjs cli
bun script/grok-lsp-socket-native.mjs desktop
bun script/grok-plugin-data-native.mjs cli
bun script/grok-plugin-data-native.mjs desktop
bun script/grok-memory-batch-dream-native.mjs cli
bun script/grok-memory-batch-dream-native.mjs desktop
```

Rendered batch checks:

```sh
bun script/grok-native-memory-batch-dream-ui.mjs browser --deferred
bun script/grok-native-memory-batch-dream-ui.mjs native --deferred
bun script/grok-native-memory-batch-dream-tui.mjs
bun script/grok-native-memory-batch-dream-tui.mjs --fullscreen
bun script/grok-native-memory-batch-dream-tui.mjs --fullscreen --narrow
```

The UI fixture may require an available browser automation executable selected by `APEXO_AGENT_BROWSER`. The scripts own isolated data and processes; inspect the dependency contract before running them. Desktop backend checks require a current Desktop build, and window checks require the built renderer. Do not infer one from the other.

The reference baseline for this phase is source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` and installed Grok 1.0.52. Official probes must isolate HOME, Grok configuration and XDG paths, use authorized fixture endpoints, and avoid external messages or unrelated user plugins. Version differences remain separate evidence. No reference runtime should enter an Apexo product call path.

## Contributor handoff checklist

Each contributor should return the actual source/test/doc changes, baseline and final file hashes, exact commands and outcomes, unresolved symptoms, process-cleanup status and a concise acceptance boundary. If working in an isolated snapshot, verify it is coherent with the shared source rather than refreshing selected consumers against stale dependencies.

Integrate handwritten source first, resolve overlap without dropping another contributor's hunks, run canonical generators, then types/builds/tests. Keep one coordinator for shared generation and heavyweight local gates. Do not count private-only evidence as integrated acceptance. Record every bug fix and apply recurring constraints as described in AGENTS.md.

No work item is automatically resumed by this document. The current phase ends after handoff, awaiting the user's review.
