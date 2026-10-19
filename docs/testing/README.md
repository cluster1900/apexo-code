# Bug Fix Records

Whenever a test fails or a bug is fixed, create or update a record in this directory organized by bug type (do **not** read this directory before normal coding; read only [docs/rules](../rules/README.md) before changing code). Reuse an existing record when the same root-cause bug recurs and increment its occurrence count; see [AGENTS.md](../../AGENTS.md#bug-records-and-recurring-constraints).

Each record must include: a stable ID, affected scope, observed vs. expected behavior, reproduction steps, root cause, fix, verification commands and results, and linked constraints (if any). Temporary logs under `/tmp` may be used freely during test runs (and are not committed to git), but **do not record `/tmp` paths or ephemeral temporary directory names in these docs**. Keep unresolved symptoms or unconfirmed root causes marked as `Investigating`; a passing rerun alone does not prove a root cause or fix.

| Category       | Record                                                                                          | Status                        | Verified Occurrences |
| -------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- | -------------------- |
| Runtime | [Provider auth reuse, Antigravity User-Agent model gating, and TUI RootRenderable listener limit](runtime/provider-auth-and-tui-listeners.md) | Fixed; `xai.test.ts` 15/15, `antigravity.test.ts` 24/24, PTY `/model` verification, Desktop Node sidecar + Chrome UI verification, and live `grok-4.7-build-fast` + `gemini-4-argon` runs pass | 4 distinct defects |
| Runtime | [CLI headless background wait, session title resolution, prompt quoting, and export parity](runtime/cli-grok-1062-parity.md) | Fixed; `run-process` 18/18, `session-list` 12/12, `httpapi-sdk` 5/5, `export-process` 1/1, and live Grok Build 1.0.62 comparison pass | 5 distinct defects |
| UI | [CLI inline task header defaulted omitted subagent_type to Unknown Agent](ui/cli-task-agent-label.md) | Fixed; `tool-inline.test.ts` 1/1 and types pass | 1 confirmed defect |
| UI | [Slash commands with arguments in the terminal UIs](ui/slash-args-tui.md) | Fixed; unit tests 45/45, fullscreen PTY 12/12, minimal PTY 5/5, and types pass | 7 distinct defects |
| UI | [Slash commands with arguments and V2 layout parity in Desktop](ui/slash-args-desktop.md) | Fixed; unit tests 17/17, real Chrome browser 20/20, and types pass | 7 distinct defects |
| UI | [Grok tool name rendering parity](ui/grok-tool-name-rendering.md) | Fixed; CLI and Desktop --edit-fuzzy 2/2 each, shell/slash regressions and mapping4/4 pass | 1 confirmed defect |
| Runtime | [Edit newString replacement patterns](runtime/edit-replacement-patterns.md) | Fixed; shared engine16/16, native edit1/1, compatibility edit29/29 and types pass | 1 confirmed defect |
| Runtime | [Native batch Dream automatic admission binding](runtime/native-batch-dream-trigger.md) | Corrected; final affected57/279 pass; final UI/types separate | 1 observed draft defect |
| Runtime | [Native batch read pagination](runtime/native-batch-pagination.md) | Both before probes fail; corrected2/4 and aggregate57/279 pass | 1 review episode, two distinct mechanisms |
| Permissions | [TUI attach misses pending requests](permissions/attach-pending-requests.md) | Fixed; CLI dashboard flow 12/12 | 1 observed episode |
| UI | [Agent dashboard keyboard ownership](ui/dashboard-keyboard-ownership.md) | Fixed; CLI and Desktop dashboard flows 12/12 | 3 distinct mechanisms, 1 episode |
| UI | [Settled batch deferred status](ui/memory-batch-deferred-status.md) | Fixed; shared browser/native and three PTY cases pass | 1 observed episode |
| UI | [Memory fullscreen footer height](ui/memory-operation-fullscreen-height.md) | Fixed; fullscreen 100×40 and 80×24 pass | 1 observed episode |
| Runtime | [Native child placement](runtime/child-placement.md) | Integrated; private32/339 and CLI placement probes pass; composed shared checks pending | 1 feature omission with independently verified boundary defects |
| Runtime | [Native LSP socket transport](runtime/native-lsp-socket-transport.md) | Shared socket/Goal38/218 and CLI5/6 pass; rebuilt Desktop pending | 1 confirmed omission |
| Persistence | [Native plugin data lifecycle](persistence/native-plugin-data-lifecycle.md) | Integrated; private19/98 and CLI/TUI pass; shared acceptance pending | 1 confirmed omission; distinct fixture/UI corrections |
| Test stability | [Native Goal aggregate lifecycle deadline](test-stability/native-goal-aggregate-timeout.md) | FIFO fixture scheduling defect reproduced and corrected; shared two-schedule2/87 passes; original aggregate timeout remains unconfirmed | 1 unresolved aggregate observation; one separately proved fixture defect |
| Test stability | [Task receipt client package hook deadline](test-stability/task-receipt-hook-timeout.md) | Investigating; canonical-command4/29 passes, original default-deadline failure retained | 1 unresolved observation |
| UI | [Task wake draft receipt across launch refresh](ui/task-wake-draft-receipt.md) | Shared canonical-client4/29 and native three-mode UI pass; stronger reopen check pending | 1 confirmed defect |
| Runtime | [Native Shell owned lifetime](runtime/native-shell-owned-lifetime.md) | Shared CLI/Desktop4 checks each and shared10/34 pass | 1 confirmed omission; separate fixture corrections |
| Runtime | [Completed Task operator continuation](runtime/task-operator-wake.md) | Integrated; private43/300 and terminal2/22 pass, shared checks in progress | 1 feature omission; separate integration boundary mistake |
| Test stability | [Feedback browser action after reload](test-stability/feedback-browser-reload-action.md) | Investigating; draft save passed, reopened dialog was absent | 1 browser observation |
| Runtime | [Native Shell command prefix and output policy](runtime/native-shell-prefix-output.md) | Integrated; shared33/311 passes, rebuilt Desktop pending | 1 confirmed omission |
| Test stability | [Native Shell configuration provider readiness](test-stability/native-shell-config-provider-timeout.md) | Investigating; unchanged isolated1/11 passes, no confirmed repair | 1 combined-gate observation |
| Test fixtures | [Native legacy Dream LLM fixture contracts](test-fixtures/native-legacy-dream-fixture-contracts.md) | Corrected; focused26/153, types, real CLI/Desktop/crash/browser/native-window checks pass | 1 independent authoring episode |
| Test stability | [Native Plan aggregate approval timeout](test-stability/native-plan-aggregate-approval-timeout.md) | Investigating; unchanged isolated13/136 passes, no confirmed fix | 1 aggregate observation |
| Runtime | [Hook settings source kind](runtime/hook-settings-source-kind.md) | Shared31/140, Core/Apexo types and CLI4/6 pass; rebuilt Desktop pending | 1 confirmed defect |
| Test fixtures | [Hook source fixture assumptions](test-fixtures/hook-source-fixture-assumptions.md) | Shared31/140, types and CLI4/6 pass; reference differences retained | Distinct fixture mistakes |
| Persistence | [Native Shell host configuration migration](persistence/native-shell-host-config-migration.md) | Integrated; private21/293, types, CLI6 and reference3 pass; shared acceptance pending | 1 confirmed omission |
| Test fixtures | [Workflow resume identifiers and history](test-fixtures/workflow-resume-history.md) | Integrated; private45/365 and CLI5/3 pass; shared acceptance pending | Distinct fixture authoring mistakes |
| Test fixtures | [Workflow resume accounting evidence](test-fixtures/workflow-resume-accounting.md) | Private native assistant/Workflow receipt assertions pass | 1 fixture episode |
| Permissions | [Workflow selection late revocation](permissions/workflow-agent-late-revocation.md) | Shared combined76/675 and package types pass; negative control proves one provider request before repair | 1 confirmed defect |
| Test fixtures | [Workflow selection contracts and reference wire](test-fixtures/workflow-agent-selection.md) | Shared CLI4/2 and isolated reference3 cases pass | Distinct fixture mistakes; no recurring count |
| Test fixtures | [Subagent Hook final-turn provider routing](test-fixtures/subagent-hook-provider-routing.md) | Shared combined76/675 and package types pass | 1 fixture-authoring episode |
| Runtime | [Scoped file-lock acquisition masked cancellation](runtime/flock-effect-acquisition-cancellation.md) | Shared negative control reproduced; four corrected lock and three ownership cases, broader Memory regression and all 21 types pass | 1 confirmed canonical defect |
| Test fixtures | [Legacy HTTP flush contract became stale](test-fixtures/native-memory-legacy-http-contract.md) | Corrected; both HTTP hosts pass in shared54/495 | 1 independent episode |
| Test stability | [CLI subprocess aggregate deadlines](test-stability/cli-process-aggregate-timeouts.md) | Investigating; unchanged-source isolated14/62 pass does not prove repair | 1 aggregate episode |
| Permissions | [Operator Task send retained a replaced Agent](permissions/task-message-operator-agent.md) | Task authority previously verified; native Dream Agent-switch regression passes within26/153, types and Desktop acceptance pass | 2 confirmed selected-operator validation defects |
| Persistence | [Task message admission omitted current Goal eligibility](persistence/task-message-goal-admission.md) | Integrated; private pause/budget and provider accounting checks pass | 1 confirmed defect |
| Test fixtures | [Task message permission alias](test-fixtures/task-message-permission-alias.md) | Integrated; private verification retained | 1 independent episode |
| Test fixtures | [Task Goal response fixture selected historical text](test-fixtures/task-message-goal-response.md) | Integrated; private verification retained | 1 independent episode |
| Runtime | [Memory recovery readiness outlived its lease](runtime/native-memory-maintenance-recovery-ownership.md) | Integrated; private negative control and correction pass; acquisition cancellation remains separate | 1 confirmed defect |
| Persistence | [V1 legacy flush configuration forwarding omitted](persistence/native-memory-flush-v1-migration.md) | Integrated; private negative control and correction pass | 1 omission episode |
| Runtime | [Metadata checkpoint rejected the trusted stopped boundary](runtime/native-memory-metadata-stopped-boundary.md) | Integrated; private61/365 and CLI/Desktop5 checks pass | 1 independent episode |
| Test fixtures | [Metadata lock fixture released twice](test-fixtures/native-memory-metadata-lock-release.md) | Integrated; private verification retained | 1 independent episode |
| Test fixtures | [Metadata event fixture used the wrong timestamp type](test-fixtures/native-memory-metadata-event-timestamp.md) | Integrated; private verification retained | 1 independent episode |
| Runtime | [Recovery preview used a Bun-only file probe](runtime/native-memory-recovery-node-file-probe.md) | Fixed; shared24/162, Core types and CLI/Desktop recovery6+retry9, all zero-provider, pass | 1 independent defect |
| Runtime | [Scheduler restoration eager module cycle](runtime/native-scheduler-restore-module-cycle.md) | Shared restoration18/181, all21 types and source CLI/Desktop4/11 pass | 1 independent episode |
| Runtime | [Scheduler retirement recorded user Stop](runtime/native-scheduler-retirement-stop.md) | Shared restoration18/181, all21 types and source CLI/Desktop4/11 pass | 1 independent episode |
| Runtime | [Stop did not fence a held restoration](runtime/native-scheduler-restoration-stop-fence.md) | Shared restoration18/181, all21 types and source CLI/Desktop4/11 pass | 1 independent episode |
| Runtime | [Empty managed Session restoration bound timers](runtime/native-scheduler-empty-restoration.md) | Shared restoration18/181, all21 types and source CLI/Desktop4/11 pass | 1 independent episode |
| Test fixtures | [Restoration interruption observation used the wrong result wrapper](test-fixtures/scheduler-restore-interruption-observation.md) | Shared restoration18/181, all21 types and source CLI/Desktop4/11 pass | 1 independent episode |
| Test fixtures | [Already-imported migration retry expectation](test-fixtures/native-memory-retry-no-work.md) | Shared service24/162, CLI9/0, HTTP15, all21 types and Desktop9/0 pass | 1 independent episode |
| Test fixtures | [Installed Memory comparison egress and classification](test-fixtures/memory-reference-isolation.md) | Shared8 checks/5 classified calls, actual isolation and clear2/0 pass | 1 source audit; no runtime recurrence |
| Test fixtures | [Recovery capture admission contract](test-fixtures/native-memory-recovery-capture-contract.md) | Integrated; shared Memory82/525 and Core types pass | 1 independent episode |
| Types | [Recovery publication callback inference](types/native-memory-recovery-publication-callback.md) | Integrated; shared Memory82/525 and all21 types pass | 1 independent episode |
| Persistence | [Old clear retry settled unrelated work](persistence/native-memory-recovery-action-targets.md) | Shared Memory82/525, Core types and CLI/Desktop6/0 pass | 1 independent episode |
| Persistence | [Clear omitted the generated index](persistence/native-memory-recovery-generated-index.md) | Shared Memory82/525, Core types and CLI/Desktop6/0 pass | 1 independent episode |
| Test fixtures | [Recovery note writer exposure argument](test-fixtures/native-memory-recovery-note-writer.md) | Integrated; shared Memory82/525 pass; all21 workspace types pass | 1 independent episode |
| Test fixtures | [Text converter fixture guessed error constructor tags](test-fixtures/native-text-error-constructors.md) | Shared text/headless/side-question22/178 and refreshed Core/Apexo types passed | 1 independent episode |
| Test fixtures | [Text fixture supplied an inferred MIME field](test-fixtures/native-text-prompt-mime.md) | Shared text/headless/side-question22/178 and refreshed Core/Apexo types passed | 1 independent episode |
| Test stability | [Side-question HTTP timeout during text regression](test-stability/native-text-side-question-regression-timeout.md) | Investigating; shared 22/178 passed without an established timing repair | 1 independent episode |
| Test stability | [Shared Memory validation deadlines](test-stability/native-memory-shared-validation-timeouts.md) | Serial CI-configured 68/436 passes; original internal phase delays unresolved | 1 independent episode |
| Test stability | [Initial HTTP auth probe timeout](test-stability/httpapi-auth-probe-startup-timeout.md) | Serial auth326 and focused Effect12 pass; original probe delay unresolved | 1 independent episode |
| Test fixtures | [Native transport fixtures mixed DOM HTTP globals](test-fixtures/protocol-health-dom-response.md) | Fixed; `packages/app` `bun test` 74/74 pass; RULE-20261015-009 active | 5 independent episodes |
| Test fixtures | [Private Electron dependency lacked its optional installed binary](test-fixtures/scheduler-private-electron-install.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Test fixtures | [A draft locale helper shadowed Python's standard library](test-fixtures/scheduler-refresh-python-module.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Test fixtures | [Scheduler UI fixtures assumed the wrong delete and selector contracts](test-fixtures/scheduler-ui-client-contract.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Test fixtures | [Scheduler UI assertions confused changed state and wrapped prose](test-fixtures/scheduler-ui-state-and-wrap.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Types | [Handwritten SDK NodeNext import extensions](types/scheduler-loop-sdk-extension.md) | Shared canonical SDK build passes after MCP helper correction | 2 independent authoring episodes |
| Types | [Scheduler action filtering lost contextual callback types](types/scheduler-ui-action-context.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Ui | [Mini terminal rejected the newly supported loop command](ui/scheduler-mini-loop-admission.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Ui | [Permission presentation disposed the Scheduler action owner](ui/scheduler-permission-owner.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Types | [Native headless CLI argument typing](types/native-headless-cli-arguments.md) | Shared compiled CLI/Desktop, startup/race gates and refreshed Core/Apexo types passed | 1 independent episode |
| Runtime | [Headless output decoded global notifications as Session events](runtime/native-headless-sse-domain.md) | Shared compiled CLI/Desktop, startup/race gates and refreshed Core/Apexo types passed | 1 independent episode |
| Runtime | [Embedded native logs contaminated headless stdout](runtime/native-headless-stdout-logging.md) | Shared compiled CLI/Desktop, startup/race gates and refreshed Core/Apexo types passed | 1 independent episode |
| Test fixtures | [Headless acceptance selected an unconfigured fixture model](test-fixtures/native-headless-model-selection.md) | Shared compiled CLI/Desktop, startup/race gates and refreshed Core/Apexo types passed | 1 independent episode |
| Runtime | [Output deduplication omitted assistant identity](runtime/native-headless-fragment-identity.md) | Shared compiled CLI/Desktop, startup/race gates and refreshed Core/Apexo types passed | 1 independent episode |
| Runtime | [Unconfirmed remote cleanup returned a signal-success exit](runtime/native-headless-unconfirmed-cleanup.md) | Shared compiled CLI/Desktop, startup/race gates and refreshed Core/Apexo types passed | 1 independent episode |
| Test fixtures | [Attachment fixture repeated a scalar format option](test-fixtures/native-headless-attachment-argv.md) | Shared compiled CLI/Desktop, startup/race gates and refreshed Core/Apexo types passed | 1 independent episode |
| Runtime | [Native text attachment is unsupported by Responses conversion](runtime/native-text-attachment-responses.md) | Shared22/178, compiled files7/4, packaged Desktop17/22 and refreshed Core/Apexo types passed | 1 independent episode |
| Runtime | [Headless signals could not stop held startup HTTP](runtime/native-headless-startup-stop.md) | Shared compiled CLI/Desktop, startup/race gates and refreshed Core/Apexo types passed | 1 independent episode |
| Types | [Dream used projected User fields as Session selection](types/native-memory-dream-selection.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Runtime | [Implicit migration waited on an explicitly interrupted relocation](runtime/native-memory-relocation-crash-lock.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Runtime | [Ineligible automatic Dream created durable no-work operations](runtime/native-memory-automatic-dream-admission.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Runtime | [Read-only Memory preview requested conflicting SQLite flags](runtime/native-memory-readonly-preview-flags.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Permissions | [Joined release transferred a prepared Dream without its receipt](permissions/native-memory-prepared-dream-owner.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Test fixtures | [Native Dream fixture confused Core messages with the HTTP envelope](test-fixtures/native-memory-message-envelope.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Persistence | [Overlapping plan codecs discarded durable operation evidence](persistence/native-memory-operation-plan-decoder.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Test fixtures | [Migration preview fixture assumed constructor key order](test-fixtures/native-memory-preview-order.md) | Integrated; private evidence retained; shared acceptance pending | 1 independent episode |
| Test fixtures | [Event inventory assertion omitted native input settlement](test-fixtures/headless-event-manifest-count.md) | HistoryCopy count corrected; focused5/35 passes; fresh aggregate pending | 2 independent episodes |
| Test stability | [AI SDK tool completion returned stop in the complete unit gate](test-stability/processor-tool-unexplained-stop.md) | Investigating; scoped pass does not prove a repair | 1 independent episode |
| Performance | [Scheduler management and loop composer measurement](performance/native-scheduler-management-composer.md) | Paired observations retained; no causal performance claim | Not a bug recurrence |
| Types | [Canonical input events omitted from exhaustive transcript dispatch](types/headless-input-event-exhaustiveness.md) | Second withdrawal-event correction integrated; all21 shared types pass | 2 independent episodes |
| Types | [Input API omitted required missing-message error identifiers](types/headless-message-not-found-constructor.md) | Shared all 21 workspace types passed | 1 independent episode |
| Runtime | [Headless provider failure was classified as unavailable](runtime/headless-provider-error-outcome.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Test fixtures | [Replay fixture omitted canonical event sequence order](test-fixtures/headless-event-replay-order.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Test fixtures | [Private migration bootstrap split a SQL comment](test-fixtures/headless-migration-comment-split.md) | Private bootstrap corrected; shared canonical migration generation/check passed | 1 independent episode |
| Test fixtures | [Historical retry fixture changed optional prompt fields](test-fixtures/headless-exact-retry-prompt-shape.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Test fixtures | [Headless Task fixture used a nonexistent native child query](test-fixtures/headless-task-child-query.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Test fixtures | [Headless notice fixture treated Session wait as prompt completion](test-fixtures/headless-advisory-wake-readiness.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Persistence | [Headless admission policy missing from durable projection](persistence/headless-input-policy-projection.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Persistence | [Prompt replay depended on process liveness](persistence/headless-replay-owner-liveness.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Runtime | [Native observation timestamp used milliseconds](runtime/native-memory-observation-time.md) | Shared lifecycle60/449, all 21 types and CLI/rebuilt Desktop5 each passed | 1 independent episode |
| Test fixtures | [Memory fixture expected JSON success from a bodyless wait](test-fixtures/memory-operation-wait-status.md) | Original lifecycle accepted; second Workflow cancellation episode corrected privately | 2 independent episodes |
| Test fixtures | [Capture fixture counted the generated index as an observation](test-fixtures/memory-operation-note-count.md) | Shared lifecycle60/449, all 21 types and CLI/rebuilt Desktop5 each passed | 1 independent episode |
| Test fixtures | [Scoped controller fixture assumed a LayerNode has a layer field](test-fixtures/memory-controller-layer.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Test fixtures | [Stop capture fixture waited for projected text before stopping](test-fixtures/memory-terminal-source-readiness.md) | Original lifecycle accepted; second Workflow history episode corrected privately | 2 independent episodes |
| Test fixtures | [Foreign-lease fixture assumed unsupported store inputs and fields](test-fixtures/memory-foreign-lease-contract.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Test fixtures | [Reference Dream fixture used object fields for tuple evidence](test-fixtures/memory-dream-reference-evidence-shape.md) | Fresh isolated installed comparison7 checks/4 requests passed | 1 independent episode |
| Runtime | [Native control lane settlement](runtime/native-control-interrupt-receipt.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 2 independent episodes |
| Runtime | [Native Memory lock heartbeat overflow](runtime/memory-owner-lock-timer.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Types | [Native Memory draft contract authoring diagnostics](types/native-memory-lifecycle-authoring.md) | Shared all 21 workspace types passed | 1 independent episode |
| Test stability | [Native Memory phase deadlines failed in one combined run](test-stability/native-memory-lifecycle-timeouts.md) | Investigating; unchanged later shared60/449 passed without proven timing repair | Unknown causes; two observations in one run |
| Types | [Nested input endpoints collide with Session client operations](types/headless-client-operation-names.md) | Canonical Client/SDK generation, isolated-index consistency and all 21 types passed | 1 independent episode |
| Runtime | [Scheduler binding precedes headless policy selection](runtime/headless-scheduler-binding.md) | Shared lifecycle60/449, Scheduler18/345 and all 21 types passed | 1 independent episode |
| Runtime | [Unsupported native Memory extraction returned conflict](runtime/memory-operation-unsupported-status.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Test fixtures | [Compaction fixture assumed extraction request order](test-fixtures/memory-compaction-extraction-order.md) | Integrated; private verification retained; shared lifecycle60/449 and all 21 types passed | 1 independent episode |
| Permissions | [Schedule Resume returned an empty 500 after permission refusal](permissions/scheduler-resume-declined-response.md) | Real pure/mixed red reproduced; corrected Scheduler18/345 and all 21 types passed | 1 independent episode |
| Runtime | [Finished Memory receipt briefly rejected immediate retry](runtime/memory-finished-operation-retry.md) | Shared lifecycle60/449, all 21 types and CLI/rebuilt Desktop5 each passed | 1 independent episode |
| Test fixtures | [Handoff merge conflict count](test-fixtures/handoff-merge-conflict-count.md) | Private preparation corrected; source conflicts remain under review | 1 tooling episode |
| Runtime | [Scheduler durability default](runtime/scheduler-durability-default.md) | Shared Scheduler22/391, all 21 types and CLI/Desktop real recurrence acceptance passed | 1 independent episode |
| Runtime | [Scheduler same-Session restart intent](runtime/scheduler-session-restart-intent.md) | Shared CLI/Desktop restart retention and fresh installed recovery passed; automatic restore remains open | 1 independent episode |
| Test fixtures | [Mixed-protocol Process list](test-fixtures/session-protocol-process-list.md) | Focused shared2/6 passed; full aggregate rerun required | 1 independent episode |
| Runtime | [Stop after admitted Scheduled Task lost cancellation receipt](runtime/scheduler-admitted-stop-receipt.md) | Integrated; private verification recorded; shared gates pending | 1 independent episode |
| Test fixtures | [Captured Goal fixture context was attached outside the queued action](test-fixtures/scheduler-control-context.md) | Integrated; private verification recorded; shared gates pending | 1 independent episode |
| Test fixtures | [Scheduler deletion fixture waited for cleanup before releasing admission](test-fixtures/scheduler-delete-readiness.md) | Integrated; private verification recorded; shared gates pending | 1 independent episode |
| Test fixtures | [Scheduler fixture assumed a missing Session returned undefined](test-fixtures/scheduler-missing-session-contract.md) | Integrated; private verification recorded; shared gates pending | 1 independent episode |
| Test fixtures | [Scheduler delay fixture replaced a node with an unbound layer](test-fixtures/scheduler-replacement-dependencies.md) | Integrated; private verification recorded; shared gates pending | 1 independent episode |
| Types | [Scheduler DELETE endpoint used an unavailable constructor](types/scheduler-http-endpoint-constructor.md) | Integrated; private verification recorded; shared gates pending | 1 independent episode |
| Types | [Scheduler runtime omitted a managed-ownership failure mapping](types/scheduler-managed-failure-boundary.md) | Integrated; private verification recorded; shared gates pending | 1 independent episode |
| Performance | [Monitor manager composer comparison](performance/native-process-monitor-ui-composer.md) | Fixed-backend before/after complete; uncontrolled host load, no causal claim | Not a bug occurrence |
| Test fixtures | [Process UI locale report](test-fixtures/process-ui-locale-report.md) | Report corrected; explicit shared browser/native en/zh/zht matrices passed | 1 authoring episode |
| Test fixtures | [Worker environment source assertion](test-fixtures/tui-worker-env-source-assertion.md) | Shared real Worker11/23 and all 21 types passed | 1 authoring episode |
| Runtime | [Worker environment mode selection](runtime/tui-worker-mode-env-substitution.md) | Exact private red/green; shared Worker11/23, all 21 types and compiled both-mode interaction passed | 1 runtime episode |
| Test fixtures | [Process UI snapshot parent](test-fixtures/process-ui-snapshot-parent.md) | Private corrected verification passed; shared builds passed | 1 authoring episode |
| Types | [Process UI target fixture](types/process-ui-task-target-fixture.md) | Shared terminal50/215 and all 21 types passed | 1 authoring episode |
| Test fixtures | [Process UI footer readiness](test-fixtures/process-ui-footer-readiness.md) | Shared pure/packaged mini/fullscreen passed | 1 authoring episode |
| UI | [Process mini wait refresh](ui/process-mini-wait-refresh.md) | Shared terminal50/215 and live mini/packaged mini passed | 1 product episode |
| UI | [Process mini list warning](ui/process-mini-list-warning.md) | Shared terminal50/215 and real partial-list recovery passed | 1 product episode |
| Types | [Media configuration fixture discriminator](types/config-media-fixture-discriminator.md) | Apexo types and configuration36/112 passed | 1 authoring episode |
| Runtime | [Media attachment compatibility alias](runtime/config-media-attachment-alias.md) | Corrected; configuration36/112 passed; complete unit gate pending | 1 root-cause episode |
| Build | [Native local split chunks](build/native-local-split-chunk-collision.md) | Standalone build and eleven compiled acceptance commands passed | 1 build episode |
| Test fixtures | [Compiled local database selection](test-fixtures/native-local-compiled-database.md) | Corrected; compiled both-mode interaction and same-ID reopen passed | 1 authoring episode |
| Types | [Native local host callback](types/native-local-host-fetch-callback.md) | Shared Apexo types and source mini/fullscreen checks passed | 1 authoring episode |
| Test stability | [Native local empty startup](test-stability/native-local-empty-startup.md) | Investigating; later shared mini/fullscreen passed without a proven causal repair | Unknown cause |
| Test fixtures | [Native local MCP wire shape](test-fixtures/native-local-mcp-tool-wire-shape.md) | Shared actual MCP ownership and passive reopen passed | 1 authoring episode |
| Test fixtures | [Native local compatibility comparison](test-fixtures/native-local-compatibility-comparison.md) | Shared compiled default mini/fullscreen comparison passed | 1 authoring episode |
| Test fixtures | [Memory query encoding](test-fixtures/native-memory-query-encoding.md) | Shared real-HTTP adapter6/28 passed | 1 authoring episode |
| Test fixtures | [Memory dialog assertion scope](test-fixtures/native-memory-dialog-assertion-scope.md) | Shared browser/native18 each passed | 1 authoring episode |
| Test fixtures | [Memory child-control expectation](test-fixtures/native-memory-child-control.md) | Shared actual child checks passed | 1 authoring episode |
| Test fixtures | [Memory terminal readiness](test-fixtures/native-memory-mini-readiness.md) | Shared pure/packaged mixed terminal24 passed | 1 authoring episode |
| UI | [Memory unsupported slash menu](ui/native-memory-unsupported-slash-menu.md) | Shared browser/native18 and terminal24 passed | 1 authoring episode |
| UI | [Memory toast registry](ui/native-memory-toast-registry.md) | Shared browser/native18 each passed | 1 authoring episode |
| Test stability | [Memory scope-navigation automation](test-stability/native-memory-scope-browser-command.md) | Investigating; final registered-endpoint checks pass without causal repair | Unknown cause |
| Test fixtures | [Mixed-terminal reconnect trigger](test-fixtures/mixed-terminal-reconnect-trigger.md) | Corrected packaged mini/fullscreen5/3 each passed | 1 authoring episode |
| UI | [Terminal stream spacer column](ui/terminal-stream-spacer-column.md) | Red/green19/75, package types and packaged Plan mini/fullscreen4/5 each passed | 1 product episode |
| Test fixtures | [Fresh-terminal backend selection](test-fixtures/native-terminal-fresh-backend.md) | Packaged mini/fullscreen fresh2/2 each passed | 1 authoring episode |
| Test fixtures | [HttpApi database-reset ownership](test-fixtures/httpapi-database-reset-ownership.md) | Shared48/169, package types and complete three-mode309-each gate passed without cleanup warnings | 1 investigation; no recurrence inflation |
| Types | [HttpApi workspace observer contracts](test-fixtures/httpapi-workspace-observer-types.md) | Shared48/169 and package types passed | 1 authoring episode |
| Test fixtures | [Promise cancellation readiness](test-fixtures/effect-promise-cancellation-readiness.md) | Shared48/169 and package types passed | 1 authoring episode |
| Runtime | [Process trailing preview](runtime/process-trailing-preview.md) | Shared141/803, all 21 types and CLI/Desktop10/57 each passed | 1 |
| Runtime | [Process output union projection](runtime/process-output-union-projection.md) | Shared141/803, all 21 types and CLI/Desktop10/57 each passed | 1 |
| Runtime | [Monitor independent pipe decoding](runtime/monitor-independent-pipe-decoding.md) | Real red/green; shared141/803, all 21 types and CLI/Desktop10/57 each passed | 1 |
| Test fixtures | [Async provider projection](test-fixtures/monitor-provider-projection.md) | Shared Monitor and isolated Scheduler/headless corrections passed; RULE016 promoted | 3 independent episodes |
| Test fixtures | [Monitor Plan summary projection](test-fixtures/monitor-plan-summary-projection.md) | Corrected case and shared141/803 passed | 1 |
| Types | [Session protocol argument key](types/session-protocol-argument-key.md) | Integrated; private types and terminal matrix passed | 1 authoring episode |
| Test fixtures | [Session protocol panel hook deadline](test-fixtures/session-protocol-panel-hook-timeout.md) | Investigating; unchanged private22/76 passed | 1; cause unknown |
| Runtime | [Mixed mini Session startup](runtime/session-protocol-mixed-mini-startup.md) | Investigating; recorded serial reruns passed | 1 episode; cause unknown |
| Test fixtures | [Session protocol recorder](test-fixtures/session-protocol-recording-proxy.md) | Corrected; private terminal checks and cleanup passed | 1 authoring episode |
| Test fixtures | [Session protocol CLI diagnostic](test-fixtures/session-protocol-cli-diagnostic.md) | Corrected; four rejection cases with zero side effects | 1 |
| Test stability | [HttpApi compatibility Session read deadline](test-stability/httpapi-session-get-timeout.md) | Cause remains unknown; latest complete three-mode309-each gate passed | 1 investigation; causes unknown |
| Test stability | [Native terminal backend readiness](test-stability/native-terminal-backend-readiness.md) | Investigating; unchanged mini/fullscreen3/3 each passed | Two observations in one run; cause unknown |
| Test fixtures | [Native terminal workspace install](test-fixtures/native-terminal-workspace-install.md) | Shared21 types and96tests/371assertions passed | 1 integration episode |
| Test stability | [Native Memory context deadline](test-stability/native-memory-context-timeout.md) | Investigating; unchanged isolated1/13 and combined96/371 passed | 1; cause unknown |
| Runtime | [Native Memory construction cycle](runtime/native-memory-execution-dependency.md) | Shared96/371 plus capture lifecycle60/449, all 21 types and CLI/Desktop5 each passed | 2 independent episodes |
| Permissions | [Native Memory root permission precedence](permissions/native-memory-root-precedence.md) | Shared real denial/control cases passed within96/371 | 1 |
| Runtime | [Native Memory aliased-home append](runtime/native-memory-home-alias.md) | Shared actual append case passed within96/371 | 1 |
| Types | [Native Memory skipped-path output](types/native-memory-search-output.md) | Shared96/371 and all 21 types passed | 1 |
| Test fixtures | [Native Memory ToolCall discriminator](test-fixtures/native-memory-tool-call-discriminator.md) | Shared96/371 and all 21 types passed | 1 |
| Test fixtures | [Memory reference SSE creation timestamp](test-fixtures/native-memory-reference-sse.md) | Isolated installed enabled comparison passed | 1 |
| Types | [Native terminal type boundaries](types/native-terminal-draft-boundaries.md) | Shared96/371 and all 21 types passed | 1 authoring episode |
| Runtime | [Native terminal activity reconciliation](runtime/native-terminal-activity.md) | Shared96/371,21types and both actual terminal modes passed | 1 |
| Runtime | [Native terminal fresh bootstrap](runtime/native-terminal-bootstrap.md) | Shared96/371,21types and both fresh terminal modes passed | 1 authoring episode |
| Runtime | [Native terminal request lifetime](runtime/native-terminal-request-lifetime.md) | Shared real owner/per-call cancellation tests passed | 1 |
| Test fixtures | [Native terminal PTY expectations](test-fixtures/native-terminal-pty-readiness.md) | Shared Plan/permission/Stop PTYs passed; startup163 separate | 1 authoring episode |
| Performance | [Process manager composer comparison](performance/native-shell-ui-composer.md) | Fixed-backend before/after complete; no causal timing claim | Not a bug occurrence |
| UI | [Process SDK error policy](ui/process-sdk-error-policy.md) | Shared App24/89, all 21 types and browser/native7/16 passed | 1 |
| Test fixtures | [Process listener idle timeout](test-fixtures/process-ui-listener-idle-timeout.md) | Explicit timeout cause; shared browser/native7/16 wait checks passed | 1 |
| Test stability | [Media options legacy deadline](test-stability/media-options-legacy-timeout.md) | Investigating; unchanged isolated1/4 and aggregate68/623 passed | 1; cause unknown |
| Test fixtures | [Private process migration import](test-fixtures/process-private-migration-import.md) | Shared68/623 and all 21 types passed | 1 integration episode |
| Permissions | [Invalid explicit media selection](permissions/native-media-invalid-selection.md) | Shared68/623, all 21 types and CLI/Desktop5/8 passed | 1 |
| Types | [Storage fixture response buffer](types/native-media-storage-response-buffer.md) | All 21 shared types and media-options CLI/Desktop5/8 passed | 1 authoring episode |
| Runtime | [Background process captured Goal admission](runtime/process-captured-goal-admission.md) | Shared68/623, all 21 types and CLI/Desktop9/26 passed | 1 |
| Runtime | [Historical process cancellation](runtime/process-historical-cancel.md) | Shared CLI/Desktop9/26 including repeated restart cancellation passed | 1 |
| Runtime | [Process ID schema statics](runtime/process-id-schema-statics.md) | Shared68/623 and all 21 types passed | 1 |
| Runtime | [Process invocation argument order](runtime/process-receipt-request-order.md) | Shared68/623 exact-retry coverage and all 21 types passed | 1 |
| Runtime | [Unspawned process completion](runtime/process-unspawned-completion.md) | Shared68/623 failure/notification coverage and all 21 types passed | 1 |
| Types | [Process callback Effect contract](types/process-notify-fixture-effect-contract.md) | All 21 shared types and shared68/623 passed | 1 authoring episode |
| Types | [Process runner error contract](types/process-runner-error-contract.md) | Third history-copy episode verified privately; RULE022 active | 3 independent episodes |
| Test fixtures | [Shell reference wait continuation](test-fixtures/shell-reference-wait-continuation.md) | Corrected isolated installed comparison passed | 1 |
| Test fixtures | [Source-copy build metadata](test-fixtures/source-copy-build-metadata.md) | Private rebuilt Desktop succeeds with explicit channel/version | 2 |
| Test fixtures | [Media video frame visibility](test-fixtures/media-video-visibility.md) | Final shared browser/native12/10 each; decoded/visible frames inspected | 1 authoring episode |
| UI | [Native media current prompt attachment](ui/native-media-prompt-attachment.md) | Shared App4/9, all 21 types and browser/native12/10 each pass | 1 |
| UI | [Native media fetch receiver](ui/native-media-fetch-receiver.md) | Shared browser/native12/10 each pass | 1 |
| Types | [Media keyed renderer](types/media-keyed-renderer.md) | All 21 shared types passed | 1 authoring episode |
| Test fixtures | [Media UI navigation](test-fixtures/media-ui-navigation.md) | Shared browser/native12/10 each pass; native terminal gap remains open | 1 authoring episode |
| Test fixtures | [Preserved backend external modules](test-fixtures/preserved-backend-module-resolution.md) | Both fixed-backend benchmarks pass; 1,810 preserved hashes verified | 1 |
| Test fixtures | [Plan reply request method](test-fixtures/plan-reply-request-method.md) | Corrected native6/6 and all 21 types passed | 1 |
| UI | [Explicit disabled custom Question answers](ui/question-custom-disabled.md) | Shared browser/native6/6 each and all 21 types passed | 1 |
| UI | [Plan review document clipping](ui/plan-review-text-clipping.md) | Shared browser/native6/6 each and all 21 types passed | 1 |
| Runtime | [Native Plan active Stop event](runtime/native-plan-stop-question-event.md) | Shared Plan14/153, all 21 types and browser/native6/6 each pass; focused Stop event verified | 1 |
| Runtime | [Native Plan global execution binding](runtime/native-plan-execution-binding.md) | Shared Plan14/153, all 21 types, CLI/Desktop recovery13/10 each and crash10/6 pass | 1 |
| Types | [Native Plan Location dependencies](types/native-plan-location-dependency.md) | Integrated; all 21 types pass | 1 authoring episode |
| Test fixtures | [Native Plan fixture contracts](test-fixtures/native-plan-fixture-contracts.md) | Shared Plan gate 14/153 and all 21 types pass | 1 authoring episode |
| Test fixtures | [Plan App adapter package resolution](test-fixtures/plan-app-adapter-package-alias.md) | Shared CLI/Desktop recovery13/10 each pass | 1 |
| Test fixtures | [Plan crash event observer](test-fixtures/plan-crash-event-observer.md) | Shared actual crash checkpoints10/6 pass | 1 |
| Permissions | [Native media exact output target](permissions/native-media-output-target.md) | Native 14/104 and compatibility 7/39; CLI/Desktop allow+deny and official comparison passed | 2 implementation paths |
| Test stability | [Native media whole-test deadlines](test-stability/native-media-api-redirect-timeout.md) | Investigating original timing; scoped read-denial passes without proving a repair | 3 failing runs; cause unknown |
| Test fixtures | [Native media query delimiter](test-fixtures/native-media-query-delimiter.md) | Fixed and privately verified | 1 |
| Types | [Guarded properties in deferred callbacks](types/native-media-webp-fixture-narrowing.md) | Four episodes; RULE012 active; shared prior gates and private headless types passed | 4 independent episodes |
| Performance | [Native media and Plan UI baseline](performance/native-media-plan-composer.md) | Fixed-backend Plan/media comparisons complete; no causal timing claim | Not a bug occurrence |
| Permissions | [Goal managed child prompt admission](permissions/goal-managed-child-admission.md) | Live 12/217, all 21 types and CLI/Desktop summary acceptance passed | 1 |
| Test Fixtures | [Goal managed continuation fixture](test-fixtures/goal-managed-continuation-fixture.md) | Corrected; isolated 2/16 and types passed | 1 |
| Test Fixtures | [Workflow managed admission fixture](test-fixtures/workflow-managed-admission-fixture.md) | Corrected; isolated acceptance passed | 1 |
| Test fixtures | [Escaped generated DDL extraction](test-fixtures/managed-child-ddl-extraction.md) | Actual SQLite schema facts verified; second independent helper episode | 2 |
| Test stability | [Ordinary V2 full-suite timeout](test-stability/ordinary-v2-full-suite-timeout.md) | Investigating; unchanged bounded diagnostic passed without identifying cause | 1 observed; cause unknown |
| Test fixtures | [Task managed rejection message](test-fixtures/task-managed-rejection-message.md) | Exact fixture correction verified: two tests / 43 assertions | 1 |
| Test fixtures | [Sandbox compatibility connection registration](test-fixtures/sandbox-compatibility-server-registration.md) | Browser/native eight checks / three calls each passed | 1 |
| Test fixtures | [Sandbox toast layout selector](test-fixtures/sandbox-toast-layout-selector.md) | Baseline detects defect; repaired browser/native seven checks each passed | 1 |
| Permissions | [Plan entry configured ask](permissions/plan-enter-configured-ask.md) | Live CLI/rebuilt Desktop six checks and ten calls each passed | 1 |
| Test fixtures | [Plan comparison construction](test-fixtures/plan-comparison-construction.md) | Installed default/ask/deny and live CLI verified | 1 |
| UI | [Duplicate Session-creation errors](ui/session-create-duplicate-toast.md) | Corrected before/after, native-window and paired performance verification passed | 1 |
| Runtime | [Public managed-child resume ownership](runtime/managed-child-public-resume.md) | Live 39/272, all 21 types and CLI/rebuilt Desktop Task/Workflow/Goal acceptance passed | 1 |
| Test fixtures | [Managed resume multi-tool reply](test-fixtures/managed-resume-multiple-tool-reply.md) | Live managed 39/272 and Plan 14/153; all 21 types pass | 2 |
| Types | [App sandbox client boundary](types/app-sandbox-client-shape.md) | Integrated; types and browser acceptance passed | 1 |
| Test fixtures | [Sandbox localized fixture expectation](test-fixtures/sandbox-ui-localized-expectation.md) | Live browser seven checks passed | 1 |
| UI | [Native App prompt envelope](ui/native-prompt-envelope.md) | Live transport 3/18 and browser three profile roundtrips passed | 1 |
| UI | [Sandbox command on fullscreen Home](ui/sandbox-home-command.md) | Live mini/fullscreen actual command routes each three checks passed | 1 |
| Performance | [Command sandbox composer measurement](performance/command-sandbox-composer.md) | Repaired final artifact 112.5/118 ms vs baseline 112/128; variation cause unproven | Not a bug occurrence |
| Test fixtures | [Background Task preview visibility](test-fixtures/task-background-preview-visibility.md) | Browser/native ten checks / 22 calls each; visible guidance/output inspected | 1 visual finding |
| Test fixtures | [Background UI assistant marker](test-fixtures/task-background-ui-assistant-marker.md) | Helper and both terminal layouts/sizes verified | 1 |
| Test fixtures | [Background fullscreen navigation](test-fixtures/task-background-fullscreen-navigation.md) | Both terminal sizes verified | 1 |
| Test fixtures | [Background parent wait](test-fixtures/task-background-parent-wait.md) | Child receipt readiness verified | 1 |
| Test fixtures | [Background Task reference parent marker](test-fixtures/task-background-reference-parent-marker.md) | Isolated installed comparison corrected and verified | 1 |
| Test fixtures | [Background Task repeated-file preload](test-fixtures/task-background-rerun-preload.md) | Fresh-process correction verified | 1 |
| Test fixtures | [Background Task provider classifier and cancellation readiness](test-fixtures/task-background-provider-classifier.md) | Active delivery classifier correction integrated; shared validation pending | Classifier 2; cancellation readiness 2 independent episodes |
| Test stability | [Background Task SOAP-shaped response](test-stability/task-background-soap-response.md) | Investigating; original peer/cause unproven | 3 failing runs; cause unknown |
| Test stability | [Background Task Session-create reset](test-stability/task-background-connection-reset.md) | Investigating; later shared 33-test gate passed without proving a repair | 1 observation; cause unknown |
| Persistence | [Accepted Session ID report ownership](persistence/session-report-owner-id-contract.md) | Shared 23/188 and CLI/rebuilt Desktop six checks each passed | 1 |
| Test Stability | [Native MCP reload in full unit gate](test-stability/mcp-native-reload-full-suite.md) | Investigating; unchanged single-test and ordered reruns passed | 1 observed; cause unknown |
| Permissions | [Workflow managed child prompt admission](permissions/workflow-managed-child-admission.md) | Live 12/217, all 21 types and CLI/Desktop boundary acceptance passed | 1 |
| Runtime | [Compatibility Session deletion not found](runtime/compat-session-delete-not-found.md) | Focused verification passed | 1 |
| Test Fixtures | [Native Goal API Coverage](test-fixtures/native-goal-httpapi-coverage.md) | Fixed & Verified | 1 |
| Test Fixtures | [Official Fixture Home Isolation](test-fixtures/official-fixture-home-isolation.md) | Hardened fixtures verified; one observed contamination | 1 |
| Typecheck      | [Goal Test Service Type Reference](types/goal-test-service-type.md)                             | Fixed & Verified              | 2                    |
| Typecheck      | [Goal Git Evidence Service Layer Export](types/goal-changes-service-layer.md)                   | Fixed & Verified              | 2                    |
| Typecheck      | [Goal Git Path Decode Effect.try Signature](types/goal-changes-effect-try.md)                   | Fixed & Verified              | 3 independent occurrences |
| Test Fixtures  | [Goal File Protocol vs. Legacy Fixture Mismatch](test-fixtures/goal-report-contract.md)         | Fixed & Verified              | 1                    |
| Test Commands  | [Wrong Working Directory for Package Tests](test-fixtures/test-working-directory.md)            | Fixed; Rule Distilled         | 4                    |
| Test Stability | [Goal Full-Suite Regression Timeout](test-stability/goal-suite-timeout.md)                      | Investigating                 | Unconfirmed          |
| Test Stability | [Goal Suite Model Request Failure Without Usage](test-stability/goal-transport-suite.md)        | Investigating                 | Unconfirmed          |
| Test Fixtures  | [Goal Cancel Fixture Waiting on Model Request](test-fixtures/goal-cancel-provider-readiness.md) | Fixed & Verified              | 1                    |
| Test Fixtures  | [Official Git Evidence Path Extraction](test-fixtures/goal-changes-official-path.md)            | Fixed & Verified              | 1                    |
| Test Fixtures  | [Official Temporary Patch Cleanup](test-fixtures/goal-changes-official-cleanup.md)              | Fixed & Verified              | 1                    |
| Test Fixtures  | [Git Evidence Shell Tool Name](test-fixtures/goal-changes-shell-name.md)                        | Fixed & Verified              | 2                    |
| Permissions    | [Goal Session Summary Diff Leak](permissions/goal-review-summary-diff.md)                       | Fixed & Verified              | 1                    |
| Test Fixtures | [Non-Git Permission Path Pattern](test-fixtures/goal-fallback-permission-pattern.md) | Second Workflow source-permission fixture corrected; tighten/relax2/14 pass privately | 2 |
| Permissions    | [Report Catalog Authority Hash](permissions/goal-report-catalog-authority.md)                   | Fixed & Verified              | 1                    |
| Persistence    | [Legacy Report Cleanup Recovery](persistence/goal-report-legacy-cleanup.md)                     | Fixed & Verified              | 1                    |
| UI             | [Report Panel State Isolation on Goal Replacement](ui/goal-report-replacement-state.md)         | Defensive Fix & Verified      | 0 (Static Review)    |
| UI             | [Fullscreen Report Toggle Remounts Goal Dialog](ui/goal-terminal-report-root.md)                | Fixed; Rule Distilled         | 4                    |
| Test Fixtures  | [Terminal Preview Readiness False Match](test-fixtures/goal-terminal-preview-readiness.md)      | Fixed & Verified              | 1                    |
| Test Stability | [Native Window Dialog Disappears After Click](test-stability/goal-native-dialog-click.md)       | Investigating                 | Unconfirmed          |
| Tooling        | [Desktop Model Catalog Certificate Verification](tooling/desktop-model-catalog-certificate.md)  | Investigating; Snapshot Built | Unconfirmed          |
| Test Fixtures  | [Native Window Offscreen Click](test-fixtures/goal-native-offscreen-click.md)                   | Fixed & Verified              | 1                    |
| UI             | [Report Preview Scroll Visibility](ui/goal-report-preview-visibility.md)                        | Fixed & Verified              | 1                    |
| Performance    | [Composer Display Latency vs. Baseline](performance/goal-report-composer-baseline.md)           | Investigating                 | Unconfirmed          |
| Test Fixtures  | [Native Click Animation Frame Wait Hang](test-fixtures/goal-native-animation-frame-wait.md)     | Fixed & Verified              | 1                    |
| Typecheck      | [Session Remove Cleanup Error Boundary](types/goal-cleanup-remove-errors.md)                    | Fixed & Verified              | 1                    |
| Test Fixtures  | [Cleanup Test Temporary Directory Service Layer](test-fixtures/goal-cleanup-fixture-layer.md)   | Fixed & Verified              | 4 independent occurrences |
| Persistence    | [Corrupt Goal State Blocking Session Deletion](persistence/goal-cleanup-corrupt-session.md)     | Fixed & Verified              | 1                    |
| Persistence    | [Stale Cleanup Task Blocked After Reusing Goal ID](persistence/goal-cleanup-reused-id.md)       | Fixed & Verified              | 1                    |
| Test fixtures | [Rendered preview readiness](test-fixtures/goal-preview-paint-readiness.md) | Two verified fixture episodes; separate historical uncertainties retained | 2 |
| Runtime        | [Session Deletion and Detached Jobs](runtime/session-delete-detached-jobs.md)                   | Fixed & Verified              | 1                    |
| Runtime        | [Memory Retrieval Ranking](runtime/memory-retrieval-ranking.md)                                | Implemented & Verified        | 0 (Static Finding)   |
| Test Fixtures  | [Official Shell Default Description](test-fixtures/shell-host-default-description.md)          | Fixed & Verified              | 1                    |
| Persistence    | [Atomic Terminal Cleanup Intent](persistence/goal-terminal-intent.md)                          | Implemented; see verification boundaries | See record      |
| Persistence    | [Optional Retention Decoding](persistence/goal-retention-optional.md)                           | Fixed & Verified              | 1                    |
| Typecheck      | [Goal Cleanup Service Requirement](types/goal-cleanup-service-requirement.md)                   | Fixed & Verified              | 1                    |
| Test Fixtures  | [Electron Terminal Worker Liveness](test-fixtures/goal-terminal-park-node.md)                   | Fixed & Verified              | 1                    |
| Test Fixtures  | [Media Inventory and Image Fixtures](test-fixtures/media-edit-fixtures.md)                     | Fixed & Verified              | 1 per distinct defect |
| Runtime        | [Media Attachment File URLs](runtime/media-attachment-file-url.md)                             | Fixed & Verified              | 0 (Static Finding)   |
| Test Fixtures  | [Official Media Command Surface](test-fixtures/media-official-command-surface.md)               | Corrected comparison scope    | 1                    |
| Typecheck      | [Desktop Profile Preload Imports](types/desktop-profile-preload-import.md)                      | Fixed & Verified              | 1                    |
| Test Fixtures | [Reference Video Aspect Ratio](test-fixtures/media-reference-aspect-ratio.md) | Corrected fixture | See record |
| Runtime | [S3 Video Presign Policy](runtime/media-s3-presign-policy.md) | Implemented & Verified | 0 production failures; one audit finding |
| Runtime | [Image Request Defaults](runtime/media-image-defaults.md) | Implemented & Verified | One protocol comparison finding |
| Test Fixtures | [Profile CLI Standard Input](test-fixtures/profile-cli-stdin.md) | Fixed; final acceptance pending | 1 |
| Runtime | [Profile CLI Session Execution Layer](runtime/profile-cli-session-execution-layer.md) | Integration verification pending | 1 |
| Test Fixtures | [Feedback Directory Return Shape](test-fixtures/feedback-directory-return-type.md) | Three independent episodes verified; Rule007 active | 3 |
| Test Fixtures | [Feedback Session Routing Contract](test-fixtures/feedback-session-routing-contract.md) | Corrected & Verified | 1 |
| Performance | [Feedback Composer Baseline](performance/feedback-composer-baseline.md) | Image slice paired comparison recorded; median/p95 +20.5/+29 ms, cause unproven | Not a bug occurrence |
| Test Stability | [Feedback HTTP Scope Teardown](test-stability/feedback-http-teardown.md) | Investigating | Unconfirmed |
| Runtime | [Native Stop Context Token Transition](runtime/hooks-runner-token-transition.md) | Fixed; see current integration evidence | 1 |
| Test Fixtures | [Interpreter Control Channel Lifetime](test-fixtures/workflow-interpreter-stdin.md) | Corrected and verified | 1 |
| Test Fixtures | [Generated Candidate Index](test-fixtures/generated-candidate-index.md) | Candidate consistency verified; committed CI pending | 1 |
| Runtime | [Cold Location Plugin Readiness](runtime/location-plugin-readiness.md) | Fixed & Verified; full unit/type gates passed | 1 |
| Test Fixtures | [Cold Location Configuration](test-fixtures/location-readiness-config.md) | Corrected & Verified | 1 |
| Types | [Branded fixture values](types/location-model-id.md) | Shared restoration18/181 and all21 types pass; RULE-20261015-003 active | 4 |
| Performance | [Side-question UI composer benchmark](performance/side-question-composer-baseline.md) | See record | See record |
| Permissions | [Native Goal snapshot evidence isolation](permissions/goal-v2-snapshot-evidence.md) | See record | See record |
| Persistence | [Workflow scratch and host receipts lacked cumulative limits](persistence/workflow-storage-capacity.md) | See record | See record |
| Runtime | [Native Goal launch promotion and terminal delivery](runtime/goal-v2-launch-boundary.md) | See record | See record |
| Runtime | [Native Goal report error responses](runtime/goal-v2-report-errors.md) | See record | See record |
| Runtime | [Empty SystemContext baseline](runtime/hooks-empty-context.md) | Three independent occurrences; RULE-20261015-006 active | 3 |
| Runtime | [Host hook environment expansion and runner identity were incomplete](runtime/hooks-environment-identity.md) | See record | See record |
| Runtime | [Host HTTP hooks lacked the reference transport policy](runtime/hooks-http-network-policy.md) | See record | See record |
| Runtime | [Pre-tool hook denial was reported as tool execution failure](runtime/hooks-pretool-denial-failure.md) | See record | See record |
| Runtime | [Host hook configuration and permission decisions were not integrated](runtime/host-hook-discovery-and-permissions.md) | See record | See record |
| Runtime | [Concurrent workflow interruption returned before child finalization](runtime/workflow-child-scope-cancellation.md) | See record | See record |
| Runtime | [Rhai exit values leaked as ordinary completion results](runtime/workflow-script-terminal-control.md) | See record | See record |
| Runtime | [Explicit production service outputs](runtime/workflow-source-registration.md) | Third independent Shell host episode verified; RULE011 active | 3 |
| Runtime | [Stopping an old workflow interrupted an unrelated Session drain](runtime/workflow-stale-ownership.md) | See record | See record |
| Runtime | [Stopping a paused workflow kept it paused](runtime/workflow-stop-paused.md) | See record | See record |
| Runtime | [Late workflow settlement overwrote explicit control state](runtime/workflow-terminal-race.md) | See record | See record |
| Test Fixtures | [Coordinator fixture announced readiness before installing cleanup](test-fixtures/coordinator-finalizer-readiness.md) | See record | See record |
| Test Fixtures | [Feedback Export Completion Assertion](test-fixtures/feedback-export-completion.md) | See record | See record |
| Test fixtures | [Feedback browser clipboard permission](test-fixtures/feedback-browser-clipboard-permission.md) | Private final browser grant/denial12+12 checks pass; shared UI verification pending | 1 independent episode |
| Test Fixtures | [Feedback Terminal Emulator Wiring](test-fixtures/feedback-terminal-emulator.md) | See record | See record |
| Test Fixtures | [Feedback Terminal Screen Assertions](test-fixtures/feedback-terminal-screen.md) | See record | See record |
| Test Fixtures | [Official compaction fixture returned an invalid summary](test-fixtures/hooks-compaction-summary.md) | See record | See record |
| Test Fixtures | [Environment comparator expected a noncanonical workspace path](test-fixtures/hooks-environment-canonical-path.md) | Three independent path-identity episodes verified; RULE-20261015-017 active | 3 |
| Test Fixtures | [Native fixture queried a different Location](test-fixtures/hooks-native-permission-location.md) | Corrected recovery CLI6/0 and retry CLI9/0 pass; private retry9/0 also passes | 2 independent episodes |
| Test Fixtures | [Official failure-hook fixture selected a result error instead of a dispatch error](test-fixtures/hooks-official-failure-kind.md) | See record | See record |
| Test Fixtures | [Stop acceptance fixture setup and deadline](test-fixtures/hooks-stop-fixtures.md) | See record | See record |
| Test Fixtures | [Stop comparison assumed snake-case event-specific fields](test-fixtures/hooks-stop-payload-fields.md) | See record | See record |
| Test Fixtures | [Host-hook comparison fixtures assumed the wrong transport framing and route](test-fixtures/host-hooks-comparison.md) | See record | See record |
| Test Fixtures | [Profile Interactive Tool Availability](test-fixtures/profile-interactive-tools.md) | See record | See record |
| Test Fixtures | [Browser fixture read a Desktop artifact during rebuild](test-fixtures/side-question-artifact-build-race.md) | See record | See record |
| Test Fixtures | [Terminal image test selected a text-only fixture model](test-fixtures/side-question-image-model.md) | See record | See record |
| Test Fixtures | [Native fixture config syntax](test-fixtures/side-question-native-provider-config.md) | Four independent delimiter episodes verified; Rule013 distilled | 4 |
| Test Fixtures | [Official ACP extension response envelopes](test-fixtures/side-question-official-envelope.md) | Side-question and MCP reference comparisons verified | 2 |
| Test Fixtures | [Side-question fixture PNG failed integrity validation](test-fixtures/side-question-official-image.md) | Valid PNG verified in installed headless16, compiled files7 and packaged Desktop17 checks | 2 independent authoring episodes |
| Test Fixtures | [Scratch tests used invalid branded Workflow IDs](test-fixtures/workflow-branded-id.md) | See record | See record |
| Test Fixtures | [Workflow browser fixture retained the prior panel selector](test-fixtures/workflow-browser-scroll-selector.md) | See record | See record |
| Test Fixtures | [Direct Desktop backend fixture omitted the interpreter resource environment](test-fixtures/workflow-desktop-interpreter.md) | See record | See record |
| Test Fixtures | [Native Workflow fixture used its wrapper as the app root](test-fixtures/workflow-native-app-path.md) | See record | See record |
| Test Fixtures | [Official saved-workflow comparison ignored project trust](test-fixtures/workflow-official-discovery.md) | See record | See record |
| Test Fixtures | [Workflow provider fixture omitted its terminal event](test-fixtures/workflow-provider-finish.md) | See record | See record |
| Typecheck | [Feedback UI Wire Types](types/feedback-ui-wire-types.md) | See record | See record |
| Typecheck | [Permission notification used an unavailable plugin event](types/hooks-permission-notification-boundary.md) | See record | See record |
| Typecheck | [Stop integration used a nonexistent Session lookup](types/hooks-stop-session-lookup.md) | See record | See record |
| Typecheck | [Side-question adapter message ID import](types/side-question-adapter-import.md) | See record | See record |
| Typecheck | [Server handler imported an undeclared Schema dependency](types/side-question-server-dependency.md) | See record | See record |
| Typecheck | [Readonly JSON arrays were not narrowed by Array.isArray](types/workflow-json-narrowing.md) | See record | See record |
| UI | [Feedback Dialog Scroll Region](ui/feedback-dialog-scroll.md) | See record | See record |
| UI | [Terminal side command omitted existing composer attachments](ui/side-question-composer-images.md) | See record | See record |
| UI | [Side-question image picker retained a stale filename](ui/side-question-image-picker.md) | See record | See record |
| UI | [Mini side-question panel used composer height](ui/side-question-mini-panel.md) | See record | See record |
| UI | [Workflow dashboard reversed newest-first results](ui/workflow-run-order.md) | See record | See record |
| UI | [Native-only Server Protocol Detection](ui/native-server-protocol-health.md) | Production browser and native Desktop verified | 1 |
| Test fixture | [Native memory index assertion](test-fixtures/native-memory-index-expectation.md) | Verified | 1 |
| Types | [Native memory configuration error boundary](types/native-memory-config-error.md) | Verified | 1 |
| Runtime | [Native wait and manual compaction unavailable](runtime/native-session-controls-unavailable.md) | Native, CLI and rebuilt Desktop verified | 1 |
| Test fixture | [Native compaction message shape](test-fixtures/native-compaction-message-shape.md) | Verified | 1 |
| Test fixture | [Native memory permission route](test-fixtures/native-memory-permission-route.md) | Verified | 1 |
| Test fixture | [Native Feedback delete request builder](test-fixtures/native-feedback-delete-request.md) | Verified | 1 |
| Test fixture | [Native Feedback empty transcript envelope](test-fixtures/native-feedback-message-envelope.md) | Verified | 1 |
| Test fixture | [Native acceptance message order](test-fixtures/native-feedback-message-order.md) | Feedback and MCP CLI/Desktop verified; two independent occurrences | 3 |
| Types | [Native saved-permission service boundary](types/native-permission-saved-service-boundary.md) | Verified | 1 |
| Test fixtures | [Native compaction route mismatch](test-fixtures/native-compaction-route.md) | Verified | 1 |
| Test Fixtures | [Goal fixture identifier format](test-fixtures/native-compaction-goal-id.md) | Verified privately; fifth episode integrated; RULE-20261015-004 active | 5 |
| Test fixtures | [Native Goal compaction provider count](test-fixtures/native-goal-compaction-call-count.md) | Verified | 1 |
| Test fixture | [Official compaction response contract](test-fixtures/official-compaction-response-contract.md) | Verified | 1 |
| Test fixture | [Official compaction home isolation](test-fixtures/official-compaction-home-isolation.md) | Verified | 1 |
| Runtime | [Compatibility hook controls did not settle](runtime/hooks-compat-control-settlement.md) | Focused, CLI and rebuilt Desktop verified | 1 |
| Types | [Hook management service boundaries](types/hooks-management-service-boundaries.md) | Verified | 1 |
| Runtime | [Hook events lost instance context](runtime/hooks-event-instance-context.md) | Verified | 1 |
| Runtime | [Hook reload repeated Session startup](runtime/hooks-reload-startup-lifecycle.md) | Focused, CLI and rebuilt Desktop verified | 1 |
| Runtime | [Compatibility Location map ownership](runtime/compat-location-map-lifetime.md) | Lifetime, MCP CLI/Desktop registry, complete unit/types and HTTP gates verified | 2 |
| UI | [Native Feedback routing](ui/native-feedback-routing.md) | Native/compatibility browser and native window verified | 1 |
| Types | [Hooks UI wire types and package export](types/hooks-ui-wire-types.md) | Types and both terminal modes verified | 1 |
| Test fixture | [Terminal pending-action sequencing](test-fixtures/hooks-terminal-pending-action.md) | Shared held-refresh and packaged fullscreen passed; RULE015 active | 3 independent episodes |
| Test fixture | [Native-window persisted server registration](test-fixtures/native-window-server-registration.md) | Session routing verified | 1 |
| Runtime | [Native Server CORS preflight](runtime/native-server-cors.md) | Seven focused tests, package types and three native windows verified | 1 |
| Runtime | [Older prompt retries lost their hook receipt](runtime/hooks-prompt-retry-receipts.md) | Focused, CLI and rebuilt Desktop verified | 1 |
| Types | [Native Plugins reload error mapping](types/native-plugins-error-mapping.md) | Server types, native HTTP and CLI verified | 1 |
| Test fixture | [Official Plugins executable resolution](test-fixtures/official-plugins-binary-resolution.md) | Ten installed-reference lifecycle comparisons verified | 1 |
| Runtime | [Optional Goal strategy result validation](runtime/goal-strategy-optional-results.md) | Original live fix plus second isolated Workflow Type-side regression verified | 2 |
| Test fixture | [Official strategist title request routing](test-fixtures/official-strategy-title-routing.md) | Strategy, Workflow and headless comparisons verified; promoted into RULE016 | 3 independent authoring episodes |
| Test fixture | [Official Goal terminal-state observation](test-fixtures/official-goal-terminal-observation.md) | Installed-reference strategy comparisons verified | 1 |
| Test fixture | [Official strategist plan promotion](test-fixtures/official-strategy-plan-promotion.md) | Installed-reference strategy comparisons verified | 1 |
| Types | [Native strategy compatibility review kind](types/goal-strategy-compatibility-kind.md) | Apexo typecheck verified | 1 |
| UI | [Native Plugins routing and activation status](ui/native-plugins-routing.md) | Types, terminals, native browser and macOS window verified | 1 |
| Test fixture | [Native Plugins PTY dependency resolution](test-fixtures/native-plugins-pty-resolution.md) | Both terminal sizes verified | 1 |
| Runtime | [Native plugin skill optional description](runtime/plugin-embedded-skill-optional-description.md) | Third Feedback omission episode verified privately; Rule021 active | 3 |
| Runtime | [Duplicate compatibility installed hooks](runtime/compat-installed-hook-double-dispatch.md) | Actual duplicate trace reproduced and corrected; focused tests verified | 1 |
| UI | [Plugin activation failure recovery](ui/plugin-runtime-failure-recovery.md) | Both terminal sizes, native browser and macOS window verified | 0 (Static Finding) |
| Runtime | [Native Goal boolean override precedence](runtime/native-goal-role-boolean-precedence.md) | Resolver/flag tests and package types verified | 1 |
| UI | [Native Goal terminal routing](ui/native-goal-terminal-routing.md) | Types, compatibility terminals and both native terminal sizes verified | 1 |
| Test fixture | [Goal summary after cancelled usage](test-fixtures/goal-summary-cancelled-usage.md) | Both native terminal sizes, production browser and native window verified | 1 |
| Test fixture | [Concurrent SDK generation and readers](test-fixtures/concurrent-sdk-generation-and-typecheck.md) | RULE018 active; unchanged shared MCP helper rerun 3/23 passes after generation | 3 independent episodes |
| UI | [Native MCP management routing](ui/native-mcp-management-routing.md) | Types, native panels, real compatibility terminals, browser and native window verified | 0 (Static Finding) |
| Types | [MCP terminal status accessor](types/mcp-terminal-status-accessor.md) | TUI typecheck verified | 1 |
| Test fixture | [HTTP exercise selector option](test-fixtures/httpapi-selection-option.md) | Corrected four-route MCP exercise verified | 1 |
| Types | [Goal summary fixture types](types/goal-summary-fixture-types.md) | Core and Apexo package typechecks verified | 1 |
| Test fixture | [Goal completion versus summary receipt](test-fixtures/goal-summary-completion-receipt.md) | CLI and Desktop summary acceptance verified | 1 |
| Test fixture | [Responses finish receipts in shell provider](test-fixtures/shell-provider-responses-finish.md) | CLI and Desktop malformed-finish acceptance verified | 1 |
| Runtime | [Goal summary late usage admission](runtime/goal-summary-late-usage-admission.md) | Focused quota and usage race tests verified | 1 |
| Test fixture | [Legacy Session Location map graph](test-fixtures/legacy-session-location-map-graph.md) | 264 focused tests and complete unit gate verified | 1 |
| Test fixture | [Focused fixture test timeout](test-fixtures/focused-test-timeout-option.md) | Correct invocation and affected test verified | 1 |
| Test fixture | [Explicit bootstrap replacement](test-fixtures/explicit-bootstrap-replacement.md) | Focused feature and feedback fixtures verified | 1 |
| Runtime | [Unexplained Feedback HTTP response](runtime/feedback-http-unexplained-response.md) | Unresolved; passing isolated rerun does not establish a fix | 1 |
| Runtime | [Native MCP stdio frame byte limit](runtime/native-mcp-stdio-frame-limit.md) | Focused framing regression verified | 1 |
| Runtime | [Native MCP forced child shutdown](runtime/native-mcp-forced-shutdown.md) | Real process-tree shutdown regression verified | 1 |
| Runtime | [Native MCP authentication classification](runtime/native-mcp-auth-classification.md) | Real remote HTTP and SSE tests verified | 1 |
| Test fixture | [Installed MCP readiness and discovery](test-fixtures/mcp-reference-readiness.md) | Three isolated installed-reference checks verified | 1 |
| Runtime | [Interrupted Instance load settlement](runtime/instance-load-shutdown-settlement.md) | Lifecycle regressions and all 277 HTTP scenarios in each mode verified | 1 |
| Runtime | [Native MCP service identity](runtime/native-mcp-service-identity.md) | Focused, complete unit, types, CLI and rebuilt Desktop verified | 1 |
| UI | [Plugins five-locale fallback](ui/plugins-five-locale-fallback.md) | Static audit, production browser and native window verified | 1 |
| UI | [Plugins RTL identifiers](ui/plugins-rtl-identifiers.md) | Production browser and native window geometry verified | 1 |
| Runtime | [Goal role atomic pair fallback](runtime/goal-role-pair-atomic-fallback.md) | Focused regression, CLI and rebuilt Desktop verified | 0 (Static Finding) |
| Runtime | [Goal role capability preflight](runtime/goal-role-capability-preflight.md) | Focused regression, CLI and rebuilt Desktop verified | 0 (Static Finding) |
| Types | [Goal role Location service capture](types/goal-role-preflight-service-capture.md) | Core/Apexo types and focused regression verified | 1 |
| Test fixture | [Goal role model reference expectations](test-fixtures/goal-role-model-reference-expectations.md) | Focused regression and package types verified | 1 |
| Test fixture | [Mixed native and compatibility configuration dialects](test-fixtures/goal-role-config-dialect.md) | Third Plan fixture episode verified; Rule010 active; shared Plan14/153 and types pass | 3 |
| UI | [Punjabi script direction](ui/punjabi-script-direction.md) | Static audit, types, browser and native window verified | 0 (Static Finding) |
| Test fixture | [Opt-in MCP Status trigger](test-fixtures/mcp-status-visibility.md) | Production browser and native window verified | 1 |
| Test fixture | [Goal role report permissions](test-fixtures/goal-role-report-permission.md) | Corrected CLI and Desktop role scenarios verified | 1 |
| Test fixture | [Reference planner model exception](test-fixtures/goal-reference-planner-model-exception.md) | Three installed-reference comparisons verified | 1 |
| Permissions | [Compatibility Goal update permission](permissions/goal-compatibility-update-permission.md) | Focused permission regressions and native CLI verified | 0 (Static Finding) |
| Persistence | [Original Goal plan finish guard](persistence/goal-original-plan-finish-guard.md) | Immutable-plan regressions and CLI report hashes verified | 0 (Static Finding) |
| Test fixture | [Goal progress extension prerequisites](test-fixtures/goal-progress-extension-prerequisites.md) | Six-file regression verified | 1 |
| UI | [Goal terminal progress scrolling](ui/goal-terminal-progress-scrolling.md) | Native compact/expanded and actual mini/fullscreen PTYs verified | 0 (Static Finding) |
| Test fixture | [Goal progress Escape/Home sequence](test-fixtures/goal-progress-escape-home-sequence.md) | Parser evidence and native compact/expanded PTYs verified | 1 |
| Test fixtures | [Fixture public services](test-fixtures/native-delete-services.md) | RULE001 active; eighth Task fixture episode integrated; shared validation pending | 8 |
| UI | [Native LSP status states](ui/native-lsp-status-union.md) | App types and status-indicator regression verified | 1 |
| Runtime | [Native LSP request reload guard](runtime/native-lsp-request-reload-guard.md) | Focused in-flight retention and cancellation verified | 1 |
| Runtime | [Native LSP closed startup](runtime/native-lsp-closed-startup.md) | Early exit and interrupted startup regression verified | 1 |
| Test fixture | [Native LSP explicit external paths](test-fixtures/native-lsp-external-path.md) | Symlink rejection and explicit-path permission checks verified | 1 |
| Test fixture | [Reference Session deletion socket expectation](test-fixtures/reference-session-delete-socket-expectation.md) | ACP cancellation and durable removal verified; physical socket closure unverified | 1 |
| Runtime | [Native LSP writer rejection](runtime/native-lsp-write-failure.md) | Real missing-process probe and lifecycle regression verified | 1 |
| UI | [Goal fullscreen scroll key priority](ui/goal-fullscreen-scroll-key-priority.md) | Causal dispatch trace and all four real terminal modes verified | 1 |
| UI | [Native project bootstrap API](ui/native-project-bootstrap-api.md) | Core/HTTP and final browser/native bootstrap verified | 1 |
| Test fixture | [Native LSP child reaping](test-fixtures/native-lsp-child-reaping.md) | Real process lifecycle verification recorded | 1 |
| Test fixture | [Native LSP disabled default](test-fixtures/native-lsp-disabled-default.md) | Real clangd CLI and Desktop acceptance verified | 1 |
| Test fixture | [Native LSP tool part field](test-fixtures/native-lsp-tool-part-field.md) | Real native tool-result assertions verified | 1 |
| Test fixture | [LSP installed-reference contract](test-fixtures/lsp-reference-contract.md) | Feature-gated six-operation comparison verified | 1 |
| Runtime | [Processor retry status unexplained stop](runtime/processor-retry-status-unexplained-stop.md) | Unresolved; scoped and full reruns pass, diagnostics retained | 1 |
| Test fixture | [LSP policy reference polling arguments](test-fixtures/lsp-policy-reference-poll.md) | Corrected installed-runtime probe verified | 1 |
| Types | [Goal legacy transcript fixture payload](types/goal-legacy-transcript-payload.md) | Cleanup runtime and final package typecheck verified | 1 |
| Test fixture | [Explicit ID for synthetic legacy Goal](test-fixtures/goal-legacy-explicit-id.md) | Real CLI and rebuilt Desktop maintenance acceptance verified | 1 |
| Test fixture | [MCP resource capability registration](test-fixtures/mcp-resource-capability-registration.md) | Live real-server fixture and CLI/Desktop acceptance verified | 1 |
| Test fixture | [MCP resource validation layer](test-fixtures/mcp-resource-validation-layer.md) | SDK and native rejection boundaries verified in live suite | 1 |
| Test fixture | [Scheduler ownership Part ID](test-fixtures/scheduler-owner-part-id.md) | Isolated runtime and package types verified | 1 |
| Test fixture | [Native Session lifecycle setup](test-fixtures/native-session-lifecycle-fixture.md) | Three binding episodes verified; RULE001 extended; latest restoration integration awaiting shared gates | 3 binding episodes |
| Types | [Session lifecycle Effect parameters](types/session-lifecycle-effect-parameters.md) | Integrated focused suite and package types verified | 1 |
| Types | [Conditional Effect channel inference](types/session-lifecycle-generic-effects.md) | RULE008 active; seventh Feedback union episode verified privately | 7 |
| Types | [Background instance lifecycle environment](types/background-instance-lifecycle-requirement.md) | Integrated focused suite and package types verified | 1 |
| Types | [Memory worker graceful exit](types/memory-worker-graceful-exit.md) | Integrated focused suite and package types verified | 1 |
| Test fixture | [Side-question lifecycle service](test-fixtures/side-question-lifecycle-service.md) | Integrated focused suite and package types verified | 1 |
| Runtime | [Background job stale cancellation](runtime/background-job-stale-cancellation.md) | Integrated focused suite and package types verified | 1 |
| Runtime | [Memory capture incarnation namespace](runtime/memory-capture-incarnation-job-id.md) | Integrated focused suite and package types verified | 1 |
| Test fixture | [Native deletion message pagination](test-fixtures/native-delete-message-pagination.md) | Isolated HTTP and contract verification passed; live integration pending | 1 |
| Runtime | [Session owner settlement](runtime/session-owner-settlement.md) | Integrated nested retirement and finalizer joins verified | 1 |
| Test fixture | [Plugins localized tab readiness](test-fixtures/plugins-localized-tab-readiness.md) | Production browser source/locale checks verified | 1 |
| Test fixture | [Native deletion menu selector](test-fixtures/native-delete-menu-selector.md) | Browser and actual Desktop three-locale acceptance verified | 1 |
| Test fixture | [Memory browser artifact](test-fixtures/memory-browser-artifact.md) | Rebuilt browser and actual Desktop message acceptance verified | 1 |
| Test fixture | [Scheduler teardown expectation](test-fixtures/scheduler-owner-teardown-expectation.md) | CLI and packaged Desktop ownership acceptance verified | 1 |
| Runtime | [MCP preference retry publication](runtime/mcp-preference-retry-publication.md) | Integrated focused and CLI/Desktop/UI acceptance passed | 1 |
| Runtime | [MCP preference retained transport](runtime/mcp-preference-retained-transport.md) | Integrated focused and CLI/Desktop/UI acceptance passed | 1 |
| Runtime | [MCP preference lock cancellation](runtime/mcp-preference-lock-cancellation.md) | Integrated focused and CLI/Desktop/UI acceptance passed | 1 |
| Test fixtures | [MCP preference status metadata](test-fixtures/mcp-preference-status-metadata.md) | Integrated focused and CLI/Desktop/UI acceptance passed | 1 |
| Test fixtures | [Native deletion fixture lifecycle ownership](test-fixtures/native-delete-lifecycle-owner.md) | Live 20-test lifecycle gate passed | 1 |
| Test fixtures | [Workflow copied interpreter prerequisite](test-fixtures/workflow-copy-interpreter-artifact.md) | Live focused and CLI/Desktop acceptance passed | 1 |
| Test fixtures | [Workflow variant protocol field](test-fixtures/workflow-variant-protocol-field.md) | Live focused and CLI/Desktop acceptance passed | 1 |
| Types | [MCP action synchronization boundary](types/mcp-action-sync-boundary.md) | All 21 integration typecheck tasks passed | 1 |
| Types | [MCP optional preference wire fields](types/mcp-preference-optional-wire-fields.md) | Contract, generation, types and builds verified | 1 |
| Runtime | [Hook observer cancellation settlement](runtime/hook-observer-cancellation-settlement.md) | Live focused and CLI/Desktop acceptance passed | 1 |
| Test stability | [Compaction timing under shared host load](test-fixtures/compaction-loaded-host-timing.md) | Investigating; unchanged isolated rerun passed | 1 episode; cause unconfirmed |
| Test fixtures | [OAuth reference environment rewriting](test-fixtures/mcp-oauth-reference-environment.md) | Corrected installed configured-client comparison passed | 1 |
| Test fixtures | [OAuth extension request field shapes](test-fixtures/mcp-oauth-extension-fields.md) | Installed DCR and configured-client comparisons passed | 1 |
| Test fixtures | [Installed OAuth browser launcher assumption](test-fixtures/mcp-oauth-browser-shim.md) | Actual local browser consent and cleanup verified | 1 |
| Runtime | [Workflow restart error precedence](runtime/workflow-restart-error-precedence.md) | Live focused and CLI/Desktop acceptance passed | 1 |
| Types | [Workflow asynchronous validator type](types/workflow-async-validator-type.md) | Live focused gate and all 21 typecheck tasks passed | 1 |
| Types | [Workflow driver test error channel](types/workflow-driver-test-error-channel.md) | Live native fixture and all 21 typecheck tasks passed | 1 |
| Test fixtures | [Workflow recovery screenshot framing](test-fixtures/workflow-recovery-screenshot-framing.md) | Browser and actual native window captures verified across en/zh/zht | 1 |
| Test fixtures | [Workflow terminal capture lifetime](test-fixtures/workflow-terminal-capture-lifetime.md) | Pre-shutdown captures verified; separate layout cause identified | 1 |
| UI | [Workflow terminal fixed rows](ui/workflow-terminal-fixed-rows.md) | Renderer, both terminals, package types and rebuilt Desktop passed | 1 |
| Permissions | [Workflow Git evidence authority](permissions/workflow-git-authority.md) | CLI, rebuilt Desktop and native HTTP regression verified | 1 |
| Test fixtures | [Workflow host configuration loaders](test-fixtures/workflow-host-config-loaders.md) | CLI and rebuilt Desktop verified | 1 |
| Test fixtures | [Hook preference reference contract](test-fixtures/hooks-preference-reference-contract.md) | Live focused checks, CLI and rebuilt Desktop passed | 2 dependency episodes; other causes 1 |
| Test fixtures | [Hook preference typed error assertion](test-fixtures/hooks-preference-error-assertion.md) | Live focused checks, CLI and rebuilt Desktop passed | 1 |
| Test fixtures | [Hook preference optional result assertion](test-fixtures/hooks-preference-optional-result.md) | Live focused checks, CLI and rebuilt Desktop passed | 1 |
| Test fixtures | [Coherent private validation](test-fixtures/hooks-preference-private-workspace.md) | Five verified episodes; RULE-20261015-005 active | 5 |
| Types | [Compatibility Hook snapshot adapter contracts](types/hooks-snapshot-compat-adapter.md) | Integrated package types passed after the preference extension | 2 |
| Runtime | [Callback state and URL validation](runtime/mcp-oauth-callback-validation.md) | Live 29-test implementation gate and CLI/Desktop acceptance passed | 1 |
| Runtime | [Rejected OAuth start ownership](runtime/mcp-oauth-rejected-start.md) | Live 29-test implementation gate and CLI/Desktop acceptance passed | 1 |
| Test fixtures | [OAuth Effect assertion fixture](test-fixtures/mcp-oauth-effect-assertion.md) | Live 29-test implementation gate passed | 1 |
| Runtime | [OAuth same-origin SSE endpoints](runtime/mcp-oauth-sse-endpoint.md) | Live transport regression passed in the 29-test gate | 1 |
| Runtime | [OAuth eligibility and ordinary HTTP](runtime/mcp-oauth-ordinary-http.md) | Live transport regression passed in the 29-test gate | 1 |
| Runtime | [OAuth cancellation feedback](runtime/mcp-oauth-cancellation-feedback.md) | Live implementation and both terminal sizes passed | 1 |
| Types | [OAuth generated UI contracts](types/mcp-oauth-ui-integration.md) | Generators, all 21 typecheck tasks and both builds passed | 1 |
| UI | [OAuth terminal selected details](ui/mcp-oauth-terminal-detail-visibility.md) | Both live native PTY sizes passed five checks; captures inspected | 1 |
| Test fixtures | [OAuth consent-tab fixture focus](test-fixtures/mcp-oauth-consent-tab-focus.md) | Live browser and actual native window each passed nine checks | 1 |
| UI | [OAuth manager row identity](ui/mcp-oauth-row-identity.md) | Live browser and actual native window each passed nine checks | 1 |
| Test fixtures | [OAuth native document identity](test-fixtures/mcp-oauth-native-document.md) | Corrected native and browser fixtures each passed nine checks | 1 |
| Test fixtures | [Workflow effort reference request shapes](test-fixtures/workflow-effort-reference-requests.md) | Portable installed-reference fixture passed six checks | 1 |
| Types | [Workflow effort type diagnostics](types/workflow-effort-draft-types.md) | Live focused gate and all 21 typecheck tasks passed | 1 |
| Runtime | [Task admission guard introduced an authority module cycle](runtime/native-task-authority-module-cycle.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 |
| Runtime | [Foreground Task returned before cancellation receipt settlement](runtime/native-task-cancel-settlement.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 |
| Runtime | [Created publication preceded private Task ownership](runtime/native-task-created-publication.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 |
| Runtime | [Exact Task retry selected a later follow-up receipt](runtime/native-task-exact-retry-receipt.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 |
| Runtime | [Direct managed Task prompt admission stranded input](runtime/native-task-managed-input.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 |
| Runtime | [Cancellation accepted before Task worker registration](runtime/native-task-prestart-cancel.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 |
| Test fixtures | [Task compaction fixture could not fit its own summary](test-fixtures/native-task-compaction-capacity.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 authoring episode |
| Test fixtures | [Native Task E2E provider object was malformed](test-fixtures/native-task-e2e-object-formatting.md) | Delimiter mapped to BUG082; later fixture observations retained; prior live23/284 and types passed | Delimiter counted only in BUG082 |
| Test fixtures | [Permission authority fixture syntax](test-fixtures/native-task-permission-fixture-syntax.md) | Second independent media authoring correction verified privately; shared types pass | 2 |
| Test fixtures | [Task reference fixture assumed a different installed catalog](test-fixtures/native-task-reference-catalog.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 authoring episode |
| Test fixtures | [Native Task validation combined stale dependencies](test-fixtures/native-task-validation-snapshot.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 authoring episode |
| Test fixtures | [Sandbox Bash fixture omitted its real Agent registration](test-fixtures/sandbox-agent-catalog.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 authoring episode |
| Test fixtures | [Sandbox comparison fixture assumed isolated HOME preserved every startup capability](test-fixtures/sandbox-reference-isolation.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 authoring episode |
| Types | [Native Task draft type boundaries](types/native-task-authoring-boundaries.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 authoring episode |
| Types | [Frozen sandbox capability widened its private brand](types/sandbox-capability-literal.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 authoring episode |
| Types | [Created-observer fixture assumed a narrowed generic payload](types/sandbox-created-listener-payload.md) | RULE014 active; shared lifecycle60/449 and all 21 types passed | 4 independent episodes |
| Types | [Native host creation failure escaped the Workflow error contract](types/sandbox-workflow-creation-error.md) | Live implementation 23/284 and all 21 types passed; CLI/Desktop scoped acceptance passed | 1 authoring episode |
| Performance | [Native Task UI composer measurement](performance/native-task-composer.md) | Integrated UI adapters, native window and narrow PTYs passed; see record | See measurement |
| Test fixtures | [Task terminal fixture stores a reconciliation function](test-fixtures/task-terminal-reconcile-setter.md) | Integrated UI adapters, native window and narrow PTYs passed; see record | 1 authoring episode |
| Types | [Task UI uses the domain type for an encoded query value](types/task-ui-query-wire-type.md) | Integrated UI adapters, native window and narrow PTYs passed; see record | 1 authoring episode |
| UI | [Native Task details exceed the narrow fullscreen dialog](ui/task-fullscreen-row-budget.md) | Integrated UI adapters, native window and narrow PTYs passed; see record | 1 |
| Test fixtures | [Advanced Task provider binding](test-fixtures/task-advanced-provider-binding.md) | Shared installed comparison passes three cases after syntax validation | 1 |
| Test fixtures | [Task reference aggregate text](test-fixtures/task-reference-aggregate-text.md) | Shared installed comparison passes three cases with actual child output | 1 |
| Test fixtures | [Nested Task inherited catalog](test-fixtures/nested-task-inherited-catalog.md) | Shared nine-file gate passes 29 tests / 321 assertions, including real denied Bash | 1 |
| Test fixtures | [Nested Goal pause status](test-fixtures/nested-goal-pause-status.md) | Shared Goal cases retain canonical user_paused and exact usage | 1 |
| Test fixtures | [Legacy Memory transport retry](test-fixtures/native-memory-legacy-retry.md) | Shared five-file gate passes 48 tests / 302 assertions | 1 |
| Test stability | [Legacy Memory local HTTP symptom](test-fixtures/native-memory-legacy-http-symptom.md) | Investigating; successful reruns do not establish a cause | 1 observation; unknown cause |
| Test fixtures | [Legacy Memory disabled status](test-fixtures/native-memory-legacy-disabled-status.md) | Shared CLI and rebuilt Desktop each pass four checks / three calls | 1 |
| Performance | [Memory operations composer comparison](performance/native-memory-operation-ui-composer.md) | Paired private production measurement retained; +6.5 ms median, causal effect unproven | See measurement |
| Test fixtures | [Memory operation cancellation observation](test-fixtures/memory-operation-abort-observation.md) | Shared adapter/locale gate passes 15 tests / 418 assertions | 1 |
| Test fixtures | [Memory operation Retry readiness](test-fixtures/memory-operation-browser-readiness.md) | Shared browser/native each pass 16 checks / five calls | 1 evidence-limited episode |
| Test fixtures | [Memory operation consumed source](test-fixtures/memory-operation-consumed-source.md) | Shared browser/native and all six terminal configurations pass | 1 |
| Test fixtures | [Memory operation completed flush](test-fixtures/memory-operation-flush-completion.md) | Shared browser/native and all six terminal configurations pass | 1 |
| Test fixtures | [Memory operation migration backend](test-fixtures/memory-operation-migration-backend.md) | Shared browser/native and all six terminal configurations pass | 1 |
| Test stability | [Memory operation native startup](test-fixtures/memory-operation-startup-observations.md) | Investigating; no cause or repair established | 1 observation; unknown cause |
| Test fixtures | [Memory operation terminal selection](test-fixtures/memory-operation-terminal-browser-selection.md) | Four source and two rebuilt Desktop terminal configurations pass | 1 |
| Test fixtures | [Memory operation review transition](test-fixtures/memory-operation-terminal-review-transition.md) | Four source and two rebuilt Desktop terminal configurations pass | 1 |
| UI | [Memory operation outcome translation](ui/memory-operation-outcome-localization.md) | Shared locale gate and rendered en/zh/zht browser/native checks pass | 1 |
| UI | [Memory operation owner navigation](ui/memory-operation-owner-navigation.md) | Shared browser/native held Session and server navigation checks pass | 1 |
| UI | [Memory operation terminal scrolling](ui/memory-operation-terminal-scroll-ownership.md) | Four source and two rebuilt Desktop terminal configurations pass | 1 |
| Test fixtures | [Memory operation backend selection](test-fixtures/memory-operation-backend-selection.md) | Actual rebuilt Desktop mini/fullscreen each pass nine checks / three calls | 1 authoring defect |
| Test fixtures | [Memory operation handoff manifest](test-fixtures/memory-operation-handoff-manifest.md) | Shared all 21 types and all six terminal configurations pass | 1 packaging episode |


| Runtime | [Automatic Memory publication admission race](runtime/native-memory-automatic-publication.md) | Negative control reproduced; final private lifecycle gate 56/277 passes; shared CLI nine checks passes | 1 independent episode |
| Runtime | [Joined resume invalidated automatic Memory epoch](runtime/native-memory-joined-resume.md) | Negative control reproduced; final private lifecycle gate 56/277 passes; shared CLI nine checks passes | 1 independent episode |
| Runtime | [Manual compaction source identity and budget](runtime/native-memory-manual-compaction-source.md) | Final private lifecycle gate 56/277 and shared CLI original-source checks pass | 1 independent episode |
| Test fixtures | [Automatic Memory exact retry receipt](test-fixtures/native-memory-automatic-retry.md) | Corrected public CLI/rebuilt Desktop each pass nine checks | 1 authoring episode |


| UI | [Task message target identity](ui/task-message-target-identity.md) | Private focused gate 3/32 and browser/native/terminal acceptance pass; integrated | 1 independent episode |
| UI | [Task message Escape fallthrough](ui/task-message-escape-fallthrough.md) | Actual mini/fullscreen and focused Escape regression pass; integrated | 1 independent episode |
| Test fixtures | [Task message native host selection](test-fixtures/task-message-native-host.md) | Canonical native fixture passes browser/native and terminal acceptance | 1 authoring episode |
| Types | [Server handler imported an undeclared Schema package](types/mcp-attachment-server-schema-import.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| Types | [Attachment prepare used a top-level union payload](types/mcp-attachment-generator-payload.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| Types | [MCP attachment decoder encoding label](types/mcp-attachment-encoding-label.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| Runtime | [Bun POST disconnect does not notify the Node HTTP request owner](runtime/mcp-attachment-post-disconnect.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| Test fixtures | [Attachment race fixture bypassed active-work expectations](test-fixtures/mcp-attachment-active-disconnect.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| Types | [Lazy terminal picker stored an extra function wrapper](types/mcp-picker-lazy-component.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| UI | [Fullscreen MCP dialog consumed a descendant PromptRef context](ui/mcp-picker-prompt-owner.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| UI | [Picker cancellation could discard an unconfirmed owner](ui/mcp-picker-cancellation-owner.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| Test fixtures | [MCP client test teardown timed out during concurrent builds](test-fixtures/mcp-picker-teardown-timeout.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| Test fixtures | [Private Desktop build omitted the server build prerequisite](test-fixtures/mcp-picker-desktop-build-input.md) | See record; shared MCP scope passes with documented transport/timing limits | See record |
| Test fixtures | [Task wake native wire projection](test-fixtures/task-wake-wire-projection.md) | Corrected; shared CLI passes all three wake modes, combined focused20/215 passes | 1 independent authoring episode |

| Test fixtures | [Manual Dream disable receipt expectation](test-fixtures/native-dream-disable-receipt-expectation.md) | Fixture corrected; final focused56/262 pass | 1 independent episode |

| Test fixtures | [Validation shell runtime scope](test-fixtures/validation-shell-runtime-scope.md) | Generators and LSP CLI rerun with exported Bun 1.3.14 pass | 1 invocation episode |

| Test fixtures | [Desktop source-only preload probe](test-fixtures/desktop-source-preload-probe.md) | Unsupported mode rejects immediately; valid Desktop modes pass | 1 invocation episode |

| Test fixtures | [Linux container orphan reaping](test-fixtures/linux-container-orphan-reaping.md) | Zombie state proven; unchanged 117-test gate passes with init | 1 environment episode |

| Test fixtures | [Workflow reference capability mode](test-fixtures/workflow-reference-capability-mode.md) | Corrected installed worktree/resume comparison passes seven checks | 1 fixture episode |

When the same root-cause bug has occurred 3 to 5 times, distill a prevention constraint into [docs/rules](../rules/README.md) as part of completing the fix. Do not count multiple failed assertions in a single run or duplicate references to the same failure as separate occurrences.
| Runtime | [Automatic Dream sleeping Location guard](runtime/automatic-dream-location-guard.md) | Before defect reproduced; focused46/225, types/build, Desktop5+3 and browser/native4+4 pass | 1 independent episode |
| Runtime | [Task fresh-child resume and inherited wake](runtime/task-resume-history.md) | Integrated; private36/473 and CLI4/7 pass; shared/Desktop pending | 1 implementation episode, with separate boundary defects documented |
| Runtime | [LSP workspace activation and queued authorization](runtime/native-lsp-workspace-activation.md) | Integrated; private25/141, types and CLI6/8 pass; shared/Desktop pending | 1 feature episode and one reproduced queued-authority defect |
| Test stability | [Linux CI socket backlog, stdio pipe flush, and memory operation settlement races](test-stability/linux-ci-socket-stream-memory.md) | Fixed; focused 4-suite verification and typecheck pass | 1 Linux CI episode |
| Runtime | [PluginStore.tag annotated tag GPG signing, canonical root path, and git identity fallback](runtime/plugin-tag-gpgsign-realpath.md) | Fixed; `test/plugin/validate.test.ts` 5/5 pass | 1 independent episode |
| UI | [PromptInputV2 Mod+A select-all in headless Chrome and `/context` / `/context-window` metrics parity](ui/prompt-input-select-all-and-context-window.md) | Fixed; `--edit-prompt` 4/4, `--dashboard` 12/12, `packages/app` 74/74 pass | 1 independent episode |
