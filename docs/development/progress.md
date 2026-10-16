# Review checkpoint — 2026-10-15

**Phase state: paused for user review after the documentation handoff.** Most major capability families have integrated implementations, but complete Grok Build parity and release readiness have not been demonstrated. This phase is ending with unfinished work explicitly preserved, not with a claim that all development is complete.

Branch: `grok-agent-roadmap`. HEAD: `3ac66232d9900e85d1e01c750315431552099ce7`. The working changes are uncommitted. This document supersedes pending-status wording in older dated checkpoints; [the full implementation record](../grok-build-implementation-progress.md) remains historical evidence.

## How to interpret status

| Status | Meaning |
| --- | --- |
| Integrated, scoped checks passed | Code is in the shared worktree and the stated feature-specific acceptance passed. It is not a whole-product/platform certification. |
| Integrated, aggregate verification incomplete | Feature checks pass, but the latest complete suite is non-green or predates subsequent changes. |
| Private draft, not integrated | Review artifacts exist; the running product does not include them. Private tests are not shared acceptance. |
| Design only / not implemented | Requirements or a proposal exist, but there is no implementation. |
| Comparison or environment unresolved | A contract still needs demonstrated reference behavior, credentials, an external service or another platform. This is distinct from a proven missing feature. |

## Implemented in the shared worktree

The following is a capability inventory, not a list of new tasks. Read the linked contract before extending an area.

| Area | Implemented behavior | Evidence / boundary |
| --- | --- | --- |
| Native execution and tools | Durable native Session admission/execution, shared tool contracts, CLI transport, native local/headless paths, permissions, Plan, LSP, MCP and tool UI | [Native terminal](../native-terminal-transport.md), [Plan](../native-plan.md); explicit native/compatibility differences remain |
| Workflow / research | Apexo-owned Rhai engine, bounded child orchestration, receipts, saved scripts, model/Agent/reasoning selection, output-schema correction, host operations, same-workspace resume and deleted-worktree reconstruction (`R06`) | [Workflow](../workflow-native.md), [resume](../native-workflow-resume.md), [placement](../native-child-placement.md); CLI/Desktop 6/6 checks each |
| Task / Subagent | Foreground/background direct and nested children (`max_nesting_depth`, default 2), owned-subtree descendant `task_output`/`task_message`/`task_cancel`, `<subagent-message>` attribution (`sender_agent_id`, `sender_role`, `remaining_turns`), directional pair quotas (`max_messages_per_pair`, default 10), delivery depth (`max_delivery_depth`, default 3), completed-child wake, retained message receipts and fresh-child history resume (`R05`) | [Task](../native-task.md), [operator UI](../native-task-message-ui.md), [resume](../native-task-resume.md); CLI/Desktop nested 6/6 checks (20 calls each), Grok Build 3/3 scenarios |
| Child placement | Task cwd, retained Task/Workflow worktrees, dirty tracked/untracked snapshot, durable placement receipt, verified deleted-worktree reconstruction (`R06`) and current authority checks | [Placement](../native-child-placement.md); CLI/Desktop cwd 8 checks each, Task worktree 9 checks each, Workflow worktree 6 checks each, nested Task 6 checks each |
| Shell / Monitor / Scheduler | Live output, background promotion, events/wake/cancel, native manager UI, wait/prefix/output policies, owned lifetime, durable Scheduler and restart recovery | [Shell](../native-shell.md), [Process UI](../native-shell-ui.md); omitted/zero native lifetime has an explicit ten-hour cap |
| Goal | Persistent control and budgets, independent evaluation/verification, reports, role/model preflight, closing summary, compaction accounting and guarded cleanup | [Goal](../goal-feature.md), [native Goal](../goal-native-v2.md); latest full-unit Goal timeout remains unresolved |
| Hooks | Sources/imports, exact-folder trust, repository-root Hook trust (`R02`), command/HTTP hooks, matching, decisions, lifecycle/Subagent hooks, Stop gates, snapshots, reload, preferences and management UI | [Hook sources](../native-hook-sources.md), [Hook parity](../grok-hooks-parity.md), [Repository Hook trust](../repository-hook-trust.md); CLI/Desktop backend 7/7 each, Browser/Native Electron UI + locales 5/5 each, unit/TUI 16/58 |
| Memory | Legacy lexical + optional authenticated API embedding hybrid ranking (`R03`), durable semantic legacy-flush dedup (`0.92` threshold), native/compatibility basic lifecycle, V2 capture/flush/Dream, explicit recovery and management, automatic/manual legacy Dream and consumed-source cleanup | [Current Memory contract](../memory-v2-feature.md), [Legacy semantic design](handoffs/legacy-memory-semantic-design.md); 84 unit/E2E tests, CLI/Desktop 6/6 checks each |
| V2 batch Dream | Opt-in bounded consolidation, per-note applied/no-change/deferred/unplaceable outcomes, durable plans/recovery and new-Dream action | [Batch Dream](../native-memory-batch-dream.md); shared 57 tests / 279 assertions; CLI and rebuilt Desktop each 6 checks |
| Plugins | Local/recommended discovery and installation, storefront, sources, trust, enable/disable/update/uninstall, immutable snapshots, resource/template picker, permission-gated LSP activation | [Plugins](../plugins-feature.md); user-facing name stays Plugins with locale translations |
| Plugin socket LSP / persistent data | Socket transport without owning an external server process; plugin-owned data epochs, active-reader retention, keep-data uninstall and status refresh | [Socket](../plugins-socket-transport.md), [data](../plugins-persistent-data.md); shared data 19/98, CLI/Desktop 5 checks each, actual en/zh/zht windows 8 each |
| Feedback / side questions / media | Draft/review/export, image attachments, independent `/btw`, image/video tools, permissions, polling/cancel, saved-media presentation and explicit S3 options | [Feedback](../feedback-drafts.md), [images](../feedback-images.md), [side questions](../side-questions.md), [media](../native-media-tools.md); external/platform boundaries remain |
| Command sandbox | Immutable stored profiles, child inheritance and macOS native Bash/descendant Seatbelt enforcement | [Sandbox](../native-command-sandbox.md); whole-agent and Linux sandboxing are not implemented by this slice |
| Structured usage CLI | Read-only Session/turn/step/model usage reporting (`apexo usage <sessionID> [turn]`, `R04`) across native durable event ledgers and compatibility projected histories | [Usage handoff](handoffs/session-usage/README.md); 10 unit/adversarial tests (129 assertions); CLI, Desktop and Grok Build 1.0.52 verified side-by-side |

## Phase 1 & Phase 2 verification and acceptance (`R01`–`R06`)

- **Repository Hook trust (`R02`, Phase 1)**:
  - Integrated across `@apexo/core`, `@apexo/schema`, `@apexo/protocol`, `@apexo/server`, `@apexo/client`, `@apexo/sdk`, `@apexo/app`, `@apexo/tui`, and `apexo` CLI runtime (`BUG-20261015-379`, `BUG-20261015-381`).
  - Failing-before negative control verified; focused unit and TUI tests pass (`16 pass, 0 fail, 58 assertions` across `test/plugin/hook-repository-trust.test.ts` and `test/cli/hooks-browser.test.tsx`).
  - Backend acceptance (`bun script/grok-hook-repository-trust.mjs cli` and `desktop`): **7/7 checks each**.
  - UI & locale (`en`/`zh`/`zht`) acceptance (`bun script/grok-hook-repository-trust-ui.mjs browser --locales` and `native --locales` in real Electron window): **5/5 checks each**.
- **Session usage CLI (`R04`, Phase 1)**:
  - Implemented `apexo usage <sessionID> [turn]` (`packages/apexo/src/cli/cmd/usage.ts`) and registered `UsageCommand`.
  - Adversarial audit fixed zero-step failed settlement retention and out-of-order `durable.seq` event sorting (`BUG-20261015-381`), verified with a failing-before negative control and **10 tests / 129 assertions** (`test/cli/usage.test.ts`).
  - Live side-by-side verification across Apexo CLI, Apexo Desktop, and installed Grok Build (`1.0.52`) confirmed matching JSON fields and error messages.
- **Full repository regression gate (`R01`, Phase 1)**:
  - Diagnosed and fixed `AppNodeBuilder` shared `rewriteCache` deduplication (`BUG-20261015-382`), `apexo plugins` `--keep-data` option scope (`BUG-20261015-383`), and `v2-media-options.e2e.test.ts` drain completion wait (`BUG-20261015-384`).
- **Optional legacy semantic Memory (`R03`, Phase 2)**:
  - Implemented `MemoryEmbedding` (`packages/core/src/memory-embedding.ts`), SQLite `chunks_vec` + `embedding_meta` cache and hybrid scoring in `MemorySearch` (`packages/core/src/memory-search.ts`), initial/per-turn hybrid injection in `MemoryContextNative`, and durable semantic-flush deduplication (`0.92` threshold, `<!-- apexo-native-flush:...:duplicate -->`) in `MemoryLegacyNative` (`BUG-20261016-385`).
  - Verified across **84 tests / 0 failures** (`memory-search.test.ts`, `memory-legacy-native.test.ts`, `memory-native.test.ts`, `memory-context.test.ts`, `memory-session.test.ts`) and CLI + rebuilt Desktop (`bun script/grok-memory-legacy-native.mjs cli` and `desktop`: **6/6 checks, 4 main calls, 2 flush calls, 2 embedding calls each**).
- **Advanced Task messaging and background nesting (`R05`, Phase 2)**:
  - Implemented owned-subtree descendant lookup and authorization (`SessionTaskStore`), `<subagent-message>` attribution (`sender_agent_id`, `sender_role`, `remaining_turns`), directional pair quotas (`max_messages_per_pair`, default `10`), delivery depth limits (`max_delivery_depth`, default `3`), configurable nesting depth (`max_nesting_depth`, default `2`), nested background task lifecycle hold (`activeNestedCount`), and cascading subtree cancellation (`BUG-20261016-386`).
  - Verified across **26 tests / 366 assertions**, CLI + rebuilt Desktop (`bun script/grok-native-task-nested.mjs cli` and `desktop`: **6/6 checks, 20 provider calls each**), and installed Grok Build (`bun script/grok-native-task-advanced-official.mjs`: **3/3 scenarios, 11 conversation requests**).
- **Deleted worktree recovery (`R06`, Phase 2)**:
  - Implemented immutable worktree `Snapshot` capture (`baseCommit`, tracked `patch`, untracked files with sha256/mode/base64 content), verified deleted-worktree reconstruction in `SessionChildPlacement.validateSaved`, `sourcePlacement` forwarding prior to `SessionChildResume.prepare`, and `(device, inode)` synchronization across `SessionStore`, `SessionTaskStore`, and `WorkflowStore` (`BUG-20261016-386`).
  - Verified across **21 tests / 232 assertions** (including 5 adversarial fail-closed negative controls), CLI + rebuilt Desktop (`bun script/grok-child-placement.mjs cli|desktop cwd|worktree` **8/8 and 9/9 checks**, `bun script/grok-workflow-placement.mjs cli|desktop` **6/6 checks**), and installed Grok Build (`bun script/grok-task-placement-official.mjs worktree` **7/7**, `bun script/grok-workflow-placement-official.mjs` **7/7**).

## Aggregate and release gate status

| Gate | Latest recorded result | Does it cover the final worktree? |
| --- | --- | --- |
| Workspace types (`bun turbo typecheck --concurrency=2`) | **All 21 tasks pass, 0 errors** | **Yes** |
| Canonical Client / legacy SDK generation (`bun run check:generated`) | **Passed, zero diff** | **Yes** |
| App / Desktop builds | Both pass with Phase 2 changes integrated | **Yes** |
| Complete unit gate (`GITHUB_ACTIONS=false bun turbo test --concurrency=2`) | **6/6 tasks pass; zero failures** | **Yes** |
| Complete HTTP gate (`bun run test:httpapi`) | **343 scenarios pass in each of coverage, authorization and Effect modes; 314 routes, zero gaps** | **Yes** |
| Linux scoped tests | **117 pass / 876 assertions across 19 files** with container init/reaping | Scoped Linux evidence only; not full Linux or sandbox enforcement acceptance |
| Windows / full platform matrix | Incomplete | No |
| CI / PR merge | Local gates green; ready for Phase 2 push | Ready for Phase 2 commit |

Historical intermittent observations (such as [BUG376](../testing/test-stability/native-goal-aggregate-timeout.md)) remain documented in the bug ledger as historical records until their underlying historical causes are separately proven.

## Not finished (Phase 3+ roadmap)

| Group | Remaining work | State after Phase 2 |
| --- | --- | --- |
| G01 Workflow | Remaining explicit execution/platform contracts | Deleted-worktree reconstruction (`R06`) complete |
| G02 Sandbox | Whole-agent enforcement for file tools, Hooks, MCP and LSP; Linux/Landlock/network controls; custom policy/deny patterns | Not implemented; macOS command sandbox is already present (`R07`, `R08`) |
| G03 Hooks | Administrator-enforced / signed policy; remaining precise decision precedence | Repository Hook trust (`R02`) complete; admin policy (`R09`) pending |
| G04 `/btw` | Cross-platform acceptance | Feature implemented; validation incomplete (`R12`) |
| G05 Memory | Platform checks | Legacy semantic Memory (`R03`) complete; historical unknown ownership deliberately remains fail-closed |
| G06 Goal | Platform validation; separately proven option gaps only | Core feature implemented; full unit gate green |
| G07 Native Task | Platform checks | Advanced Task messaging, background nesting (`R05`), and deleted-placement recovery (`R06`) complete |
| G08 Feedback | Positive native OS clipboard acceptance; platform checks; review draft-versus-direct-submission product difference | Validation/product decision (`R12`) |
| G09 Media | Automatic team ZDR policy/auth claims; transient signing fallback; production service/storage and platform acceptance | Missing contracts / external-service validation (`R10`) |
| G10 Plugins | Remaining manifest/organizational policy and Hook integration; remote Git credentials, platform and clean-host performance checks | Remaining contracts / acceptance (`R09`, `R12`); storefront/data/socket are implemented |
| G11 Shell | Precise timeout-folding dialect comparison, remaining bounded contract and platform checks | Audit / acceptance (`R12`); manager UI is implemented |
| G12 Product surfaces | Exact dashboard interactions, local trace bundle and native top-level fork comparisons | Usage CLI (`R04`) complete; other comparisons bounded (`R11`) |
| G13 Verification | Full Linux/Windows and relevant reference matrix | macOS full unit + HTTP gates green (`R01`); cross-platform matrix (`R12`) pending |

The pinned reference's alternate proprietary-harness representability function returns false. Unused `fork_context` and deprecated ignored options do not establish working features to migrate. Do not add them as deliverables without new evidence. [The bounded contract audit](../grok-build-contract-audit.md) records these decisions.

## Handoff packages

| Work | Status | Evidence |
| --- | --- | --- |
| [Repository Hook trust](handoffs/repository-hook-trust/README.md) (`R02`) | **Integrated and verified (Phase 1)** | 16 unit/TUI tests, 7/7 CLI + 7/7 Desktop backend checks, 5/5 browser + 5/5 native Electron UI + locale checks, Grok Build 1.0.52 side-by-side parity |
| [Usage CLI](handoffs/session-usage/README.md) (`R04`) | **Integrated and verified (Phase 1)** | 10 unit/adversarial tests (129 assertions), CLI + Desktop + Grok Build 1.0.52 side-by-side parity |
| [Legacy semantic Memory](handoffs/legacy-memory-semantic-design.md) (`R03`) | **Integrated and verified (Phase 2)** | 84 unit/E2E tests, 6/6 CLI + 6/6 Desktop backend checks (`grok-memory-legacy-native.mjs`), hybrid retrieval + durable semantic-flush dedup (`BUG-20261016-385`) |
| [Native child placement](../native-child-placement.md) (`R05`, `R06`) | **Integrated and verified (Phase 2)** | 47 unit/E2E tests (598 assertions), CLI + Desktop Task cwd (8/8), Task worktree (9/9), Workflow worktree (6/6), nested Task (6/6), Grok Build parity (`BUG-20261016-386`) |


