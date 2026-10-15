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
| Workflow / research | Apexo-owned Rhai engine, bounded child orchestration, receipts, saved scripts, model/Agent/reasoning selection, output-schema correction, host operations and same-workspace resume | [Workflow](../workflow-native.md), [resume](../native-workflow-resume.md); deleted-worktree reconstruction remains |
| Task / Subagent | Foreground/background direct children, output/cancel, active steer/queue/interject, completed-child wake, retained message receipts, fresh-child history resume and nested foreground execution | [Task](../native-task.md), [operator UI](../native-task-message-ui.md), [resume](../native-task-resume.md); advanced descendant/background contracts remain |
| Child placement | Task cwd, retained Task/Workflow worktrees, dirty tracked/untracked snapshot, durable placement receipt and current authority checks | [Placement](../native-child-placement.md); CLI/Desktop cwd 8 checks each, Task worktree 8, Workflow worktree 5, nested foreground 3 |
| Shell / Monitor / Scheduler | Live output, background promotion, events/wake/cancel, native manager UI, wait/prefix/output policies, owned lifetime, durable Scheduler and restart recovery | [Shell](../native-shell.md), [Process UI](../native-shell-ui.md); omitted/zero native lifetime has an explicit ten-hour cap |
| Goal | Persistent control and budgets, independent evaluation/verification, reports, role/model preflight, closing summary, compaction accounting and guarded cleanup | [Goal](../goal-feature.md), [native Goal](../goal-native-v2.md); latest full-unit Goal timeout remains unresolved |
| Hooks | Sources/imports, exact-folder trust, repository-root Hook trust (`R02`), command/HTTP hooks, matching, decisions, lifecycle/Subagent hooks, Stop gates, snapshots, reload, preferences and management UI | [Hook sources](../native-hook-sources.md), [Hook parity](../grok-hooks-parity.md), [Repository Hook trust](../repository-hook-trust.md); CLI/Desktop backend 7/7 each, Browser/Native Electron UI + locales 5/5 each, unit/TUI 16/58 |
| Memory | Legacy lexical ranking, native/compatibility basic lifecycle, V2 capture/flush/Dream, explicit recovery and management, automatic/manual legacy Dream and consumed-source cleanup | [Current Memory contract](../memory-v2-feature.md); optional legacy semantic retrieval remains design-only |
| V2 batch Dream | Opt-in bounded consolidation, per-note applied/no-change/deferred/unplaceable outcomes, durable plans/recovery and new-Dream action | [Batch Dream](../native-memory-batch-dream.md); shared 57 tests / 279 assertions; CLI and rebuilt Desktop each 6 checks |
| Plugins | Local/recommended discovery and installation, storefront, sources, trust, enable/disable/update/uninstall, immutable snapshots, resource/template picker, permission-gated LSP activation | [Plugins](../plugins-feature.md); user-facing name stays Plugins with locale translations |
| Plugin socket LSP / persistent data | Socket transport without owning an external server process; plugin-owned data epochs, active-reader retention, keep-data uninstall and status refresh | [Socket](../plugins-socket-transport.md), [data](../plugins-persistent-data.md); shared data 19/98, CLI/Desktop 5 checks each, actual en/zh/zht windows 8 each |
| Feedback / side questions / media | Draft/review/export, image attachments, independent `/btw`, image/video tools, permissions, polling/cancel, saved-media presentation and explicit S3 options | [Feedback](../feedback-drafts.md), [images](../feedback-images.md), [side questions](../side-questions.md), [media](../native-media-tools.md); external/platform boundaries remain |
| Command sandbox | Immutable stored profiles, child inheritance and macOS native Bash/descendant Seatbelt enforcement | [Sandbox](../native-command-sandbox.md); whole-agent and Linux sandboxing are not implemented by this slice |
| Structured usage CLI | Read-only Session/turn/step/model usage reporting (`apexo usage <sessionID> [turn]`, `R04`) across native durable event ledgers and compatibility projected histories | [Usage handoff](handoffs/session-usage/README.md); 10 unit/adversarial tests (129 assertions); CLI, Desktop and Grok Build 1.0.52 verified side-by-side |

## Phase 1 verification and acceptance (`R01`, `R02`, `R04`)

- **Repository Hook trust (`R02`)**:
  - Integrated across `@apexo/core`, `@apexo/schema`, `@apexo/protocol`, `@apexo/server`, `@apexo/client`, `@apexo/sdk`, `@apexo/app`, `@apexo/tui`, and `apexo` CLI runtime (`BUG-20261015-379`, `BUG-20261015-381`).
  - Failing-before negative control verified; focused unit and TUI tests pass (`16 pass, 0 fail, 58 assertions` across `test/plugin/hook-repository-trust.test.ts` and `test/cli/hooks-browser.test.tsx`).
  - Backend acceptance (`bun script/grok-hook-repository-trust.mjs cli` and `desktop`): **7/7 checks each**.
  - UI & locale (`en`/`zh`/`zht`) acceptance (`bun script/grok-hook-repository-trust-ui.mjs browser --locales` and `native --locales` in real Electron window): **5/5 checks each**.
- **Session usage CLI (`R04`)**:
  - Implemented `apexo usage <sessionID> [turn]` (`packages/apexo/src/cli/cmd/usage.ts`) and registered `UsageCommand`.
  - Adversarial audit fixed zero-step failed settlement retention and out-of-order `durable.seq` event sorting (`BUG-20261015-381`), verified with a failing-before negative control and **10 tests / 129 assertions** (`test/cli/usage.test.ts`).
  - Live side-by-side verification across Apexo CLI, Apexo Desktop, and installed Grok Build (`1.0.52`) confirmed matching JSON fields and error messages.
- **Full repository regression gate (`R01`)**:
  - Diagnosed and fixed `AppNodeBuilder` shared `rewriteCache` deduplication (`BUG-20261015-382`), `apexo plugins` `--keep-data` option scope (`BUG-20261015-383`), and `v2-media-options.e2e.test.ts` drain completion wait (`BUG-20261015-384`).
  - All 4 CI gate commands pass on the final Phase 1 worktree.

## Aggregate and release gate status

| Gate | Latest recorded result | Does it cover the final worktree? |
| --- | --- | --- |
| Workspace types (`bun turbo typecheck --concurrency=2`) | **All 21 tasks pass, 0 errors** | **Yes** |
| Canonical Client / legacy SDK generation (`bun run check:generated`) | **Passed, zero diff** | **Yes** |
| App / Desktop builds | Both pass with repository Hook trust UI integrated | **Yes** |
| Complete unit gate (`GITHUB_ACTIONS=false bun turbo test --concurrency=2`) | **6/6 tasks pass; `packages/apexo`: 4,719 pass, 0 fail, 19 skip, 1 todo; 53 snapshots, 18,796 assertions across 476 files** | **Yes** |
| Complete HTTP gate (`bun run test:httpapi`) | **343 scenarios pass in each of coverage, authorization and Effect modes; 314 routes, zero gaps** | **Yes** |
| Linux scoped tests | **117 pass / 876 assertions across 19 files** with container init/reaping | Scoped Linux evidence only; not full Linux or sandbox enforcement acceptance |
| Windows / full platform matrix | Incomplete | No |
| CI / PR merge | Local gates green; awaiting branch push / PR CI | Ready for Phase 1 commit |

Historical intermittent observations (such as [BUG376](../testing/test-stability/native-goal-aggregate-timeout.md)) remain documented in the bug ledger as historical records until their underlying historical causes are separately proven.

## Not finished (Phase 2+ roadmap)

| Group | Remaining work | State after Phase 1 |
| --- | --- | --- |
| G01 Workflow | Reconstructing missing/deleted worktrees; remaining explicit execution/platform contracts | Not implemented / acceptance incomplete (`R06`) |
| G02 Sandbox | Whole-agent enforcement for file tools, Hooks, MCP and LSP; Linux/Landlock/network controls; custom policy/deny patterns | Not implemented; macOS command sandbox is already present (`R07`, `R08`) |
| G03 Hooks | Administrator-enforced / signed policy; remaining precise decision precedence | Repository Hook trust (`R02`) complete; admin policy (`R09`) pending |
| G04 `/btw` | Cross-platform acceptance | Feature implemented; validation incomplete (`R12`) |
| G05 Memory | Optional API embeddings, hybrid retrieval, semantic legacy-flush dedup; legacy installed-runtime equivalence and platform checks | Semantic work design-only (`R03`); historical unknown ownership deliberately remains fail-closed |
| G06 Goal | Platform validation; separately proven option gaps only | Core feature implemented; full unit gate green |
| G07 Native Task | Descendant routing, sender attribution/quotas, nested background work, deleted-placement recovery | Not implemented (`R05`, `R06`); direct-child messaging and nested foreground already exist |
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
| [Repository Hook trust](handoffs/repository-hook-trust/README.md) (`R02`) | **Integrated and verified** | 16 unit/TUI tests, 7/7 CLI + 7/7 Desktop backend checks, 5/5 browser + 5/5 native Electron UI + locale checks, Grok Build 1.0.52 side-by-side parity |
| [Usage CLI](handoffs/session-usage/README.md) (`R04`) | **Integrated and verified** | 10 unit/adversarial tests (129 assertions), CLI + Desktop + Grok Build 1.0.52 side-by-side parity |
| [Legacy semantic Memory](handoffs/legacy-memory-semantic-design.md) (`R03`) | Design ready for Phase 2 | Reviewed design, source contracts, file plan and acceptance cases |

