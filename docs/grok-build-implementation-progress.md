# Grok Build Feature Implementation and Acceptance

## Review pause — 2026-10-15

The user ended this implementation phase after requesting developer documentation, to review the complete worktree before deciding what to resume. Start with the [developer guide](development/README.md), [current progress](development/progress.md), [remaining task board](development/task-board.md), and [preserved unmerged work](development/handoffs/README.md). Development is paused; no new code, merge or release is scheduled.

The last completed checks close the batch Dream rendered UI slice: browser and actual native window each pass 6 checks / 3 Dream calls; mini 100×40 and fullscreen 100×40/80×24 each pass 4 / 3. All owned processes exited and 3,647 source/artifact hashes remained unchanged. BUG378/380 verification is recorded. Final App/TUI types and App/Desktop builds pass. Plugins en/zh/zht native windows each pass 8 checks, including deferred-cleanup notice removal.

The latest complete unit aggregate remains non-green at 4,614 passes / one Goal deadline failure and predates the later socket/data/placement/batch work. The separately proved Goal FIFO fixture defect is repaired with two scheduling cases passing 2 / 87; this does not establish the original aggregate timeout cause. Full HTTP 339 per mode / 310 routes also predates later integration. Neither full gate was rerun for the final source before pause. Do not substitute an older green checkpoint for current acceptance.

Repository Hook trust is preserved as an unapplied private patch, with focused13/39 and remaining verification explicitly listed. Legacy semantic retrieval and Session usage CLI are design-only, with no production implementation. The original capability scope is unchanged. The sections below are historical checkpoints; later integration may supersede their pending wording.

## 19:00 target: current integration

Automatic legacy Dream, consumed-source cleanup, Task fresh-child history resume and plugin LSP workspace activation are integrated and pass shared source CLI plus unified rebuilt Desktop backend acceptance. Frozen runtime hashes were verified. All 21 workspace typechecks pass without cache hits, App/Desktop production builds pass, and canonical Client consistency passes using a temporary index with the real Git index unchanged.

- Task/LSP shared gate: 55 tests / 565 assertions. Task source CLI and rebuilt Desktop each pass four checks / seven calls; workspace LSP each passes six checks / eight calls.
- Cleanup/manual/automatic/V2/storage plus existing LSP policy gate: 62 tests / 311 assertions. Cleanup CLI and rebuilt Desktop each pass four checks / one call.
- Automatic Dream rebuilt Desktop: positive five checks / five calls; failed-source three checks / three calls. The two-check publication-order proof requires source CLI preload instrumentation and is explicitly rejected for packaged Desktop.
- Real native window using the rebuilt shared renderer and source backend: four checks / three calls, both Finished receipts visible and old consumed files deleted. Private crash and installed-reference evidence remain separately documented.

Linux dependencies and Apexo's own Linux workflow interpreter are built. The scoped Linux gate passes 117 tests / 876 assertions across 19 files after the proven container-init correction (BUG373). The exact macOS full-unit command has finished: 4614 passes, one failure, 19 skips, one todo, 53 snapshots and 17994 assertions across 463 files. All 5103 captured package source files remained unchanged. The native Goal end-to-end case exceeded 30 seconds (BUG376); its unchanged isolated rerun passes 1/39 but does not prove a repair. A green aggregate remains required. Socket LSP is integrated and passes the shared socket/Goal38/218 gate plus source CLI5/6. Persistent plugin data with uninstall controls is integrated from its20-handwritten-file handoff; private19/98, source CLI, CLI commands and terminal evidence are recorded. Task cwd and retained Task/Workflow worktree placement are integrated from the hash-checked31-handwritten-file handoff, with the retained-error-path amendment; private32/339 and all four CLI placement probes pass. Opt-in V2 batch Dream is now integrated, with57/279 private focused tests and Core/Apexo/App/TUI types passing. Canonical union generation, isolated-index Client consistency, all21 uncached shared types and App build now pass. Unified Desktop build and composed runtime acceptance now pass: Task cwd8/8, Task worktree8/8, Workflow worktree5/4, nested Task3/6, Plugins data5/6 and batch Dream6 checks (2 ordinary/2 capture/3 Dream) on both source CLI and rebuilt Desktop; socket Desktop5/6 also passes. Shared focused gates pass34/426 for Task/Workflow/Goal,19/98 for plugin data and57/279 for batch/default Memory/grep. Final rendered Plugins checks remain in progress. Batch browser/native initially pass5/3 each and mini terminal4/3; fullscreen readiness failed with its footer absent. Root visual review also found a misleading original-retry instruction for settled deferred notes. Both observations are under correction/investigation before final UI acceptance. The native Goal test now has bounded phase diagnostics; those do not establish a repair. The full G01–G13 scope remains active. The requested 19:00 Singapore delivery time is a target, not a claim of completed parity.

## 17:00 shared checkpoint

Eight bounded capabilities are now integrated on the same frozen source checkpoint. All 21 workspace typecheck tasks pass without cache hits; unified App and Desktop production builds pass. SDK generation is complete, and the unit gate's dry-run confirms its generated-source build prerequisite is a cache hit. Canonical Client consistency passed with an isolated index and no change to the real Git index. The complete HTTP gate exits zero in 723.266 seconds: coverage, authorization and Effect each pass all 339 scenarios over 310 routes, with zero failures, skips or inventory gaps. The complete unit gate exits1:4553 passes,19 skips,one todo,eight failures,53 snapshots and17692 assertions across458 files. Five of six Turbo tasks pass in23m30.061s; all5086 captured package files remain unchanged throughout the run. Its failures are one stale event inventory count, one unexplained SOAP-shaped Subagent fixture response and six CLI subprocess deadlines. The count is now corrected and its final focused gate passes5 tests/35 assertions; Apexo package typechecking passes after the fixture/diagnostic edits; process-output and HTTP-listener failure diagnostics are added, and the combined CLI/Subagent rerun passes22 tests/136 assertions in43.76s. That diagnostic-only rerun does not establish the original response or deadline causes. This is not a green aggregate.

| Capability | Shared acceptance | Reference boundary |
| --- | --- | --- |
| Hook source layers and imports | 31 tests / 140 assertions; CLI and rebuilt Desktop each four checks / six calls | Installed grouped imports pass; pinned-source additive precedence differs from installed1.0.52 |
| Feedback image snapshots and export | 18 /130 plus SDK2 /16; native/compatibility CLI and native Desktop each six scenarios; granted/denied browser12 each, actual native window11, mini/fullscreen7 each | Isolated installed image submission uses a fixture endpoint; no external issue is sent |
| Workflow same-workspace resume | CLI and rebuilt Desktop five checks / three calls; all Workflow cases pass in the combined gate | Isolated installed continuation preserves source history in a fresh child; worktree reconstruction remains |
| Native Shell wait settings | CLI and rebuilt Desktop six checks each | Installed three-scenario wait comparison; native lifetime remains a separately explicit contract |
| Native Shell prefix/output policy | Shared ownership/wait/output gate33 /311; CLI/Desktop two checks each | Installed two cases confirm host-only configuration and Unicode preview semantics |
| Native owned Shell lifetime | Shared ten tests /34 assertions; CLI/Desktop four checks each, all PIDs observed and reaped | Explicit ten-hour safety cap and native positive-deadline dialect; no ten-hour wall-clock or unlimited claim |
| Native manual legacy Dream | Shared26 /153; CLI/Desktop four checks /one provider call; private browser/native and three real crash boundaries pass | Fixed-source comparison; installed requested-legacy probe exposes V2 artifacts, so legacy runtime equivalence remains unproven |
| Completed Task operator wake and retained receipts | Shared45 /322; canonical receipt client4 /29; CLI/Desktop three modes; browser/native three modes; native close/reopen/New-message proof passes all three | Installed human-address continuation proves same-child history; Task fresh-child resume_from remains a separate real gap |

Counts overlap across regression suites and must not be added as a total. The initial native Plan aggregate timeout (BUG354), Shell readiness timeout (BUG358), Feedback browser reopen symptom (BUG360), and default-deadline receipt cleanup symptom (BUG363) remain unresolved observations. Their later passing focused runs do not establish repairs. The confirmed Dream selected-Agent race and Task receipt-refresh defect are fixed and recorded as BUG313 and BUG362.

The original G01–G13 scope remains active. Automatic legacy Dream is being implemented privately; Task fresh-child resume_from and remaining Plugins contracts are being audited against working source/runtime entrypoints. These private follow-ons are outside the frozen checkpoint. Review reproduced a private automatic-Dream timer holding the Location guard between ticks; its focused failing-before/passing-after proof is private and must finish integration acceptance. No overall completion, commit, push or merge is claimed.

## Four-feature shared composition

Hook source/import handling, Feedback images, bounded same-workspace Workflow resume and native Shell wait settings are now integrated. Every frozen baseline/final file hash was verified; the history readiness guard was composed as a two-line runner amendment to preserve current Task and Subagent Hook behavior. The independent optional-key and runner-error constraints are both retained, with 25 active rules. Public Client and legacy SDK outputs were regenerated canonically after integration.

The subsequent [Hook sources/imports](native-hook-sources.md), [Feedback images](feedback-images.md), [Workflow resume](native-workflow-resume.md) and [native Shell wait settings](native-shell-host-config.md) are integrated. Unified App/Desktop builds and all21 types pass. Source CLI and rebuilt Desktop each pass Hook4/6, Workflow5/3 and Shell6 checks; Feedback native/compatibility CLI and native Desktop each pass6. Shared Feedback18/130 and SDK2/16 pass. The combined Workflow/Shell gate is65pass/1Shell readiness timeout; its unchanged isolated case passes but the cause remains unknown. The subsequent Shell prefix/output integration passes33/311; its rebuilt Desktop acceptance is pending. Shared Feedback granted/denied browser checks each pass12, native window11 and both terminals7; the original reload symptom remains unexplained. Refreshed aggregate acceptance is still required.

Shared Feedback18/130, SDK2/16 and canonical migration consistency pass, including actual8MiB/16MiB HTTP payloads and exact bytes after process death. The Shell readiness failure is retained under BUG358; the browser reload symptom is retained under BUG360. Neither is declared repaired by an isolated pass.

The three Astra workstreams now address native legacy Dream, fresh operator/HTTP completed-child wake, and the remaining Shell lifetime contract. Shell prefix/output policy is integrated pending rebuilt Desktop acceptance. The [Workflow fork audit](workflow-fork-context-audit.md) found a privileged internal option without a demonstrated working builtin caller; it does not invent a new builtin behavior or certify Task transcript forking. The latest completed aggregate remains the non-green 4498-pass / one-failure checkpoint below.

## Hook source integration and latest aggregate result

The reviewed nine-file Hook source handoff is integrated. Shared discovery/precedence/import/snapshot tests pass **31 tests / 140 assertions**, Core and Apexo typechecks pass, and native CLI passes four checks / six provider calls. Rebuilt shared Desktop acceptance remains pending. Settings-file paths no longer admit JSON children when replaced by directories; the failing-before control is recorded in BUG351. Administrator-enforced policies and parent-directory trust are separate unfinished contracts.

The complete unit gate for the preceding Task wake, Stop cancellation, Workflow selection and Subagent Hooks checkpoint has finished: **4498 passes, 19 skips, one todo and one failure**, 53 snapshots and 17254 assertions across 448 files; five of six Turbo tasks passed and the process exited 1 after 23m4.889s. Native Plan approval timed out. The unchanged isolated Plan file passes 13 tests / 136 assertions; failure-only diagnostics now pass the affected case with 18 assertions. No timeout was raised and no runtime repair is claimed. See [the open investigation](testing/test-stability/native-plan-aggregate-approval-timeout.md). A green aggregate is still required.

Feedback images have a private final build and 18-test / 130-assertion gate, plus positive and denied clipboard browser checks; final native-window verification and shared integration are pending. Workflow resume has private completed/failed/cancelled-source evidence and remains under permission-boundary validation. A third GPT-6 Astra agent is implementing native Shell host settings after the Hook source handoff; BUG352 is not fixed by forwarding configuration alone. The target is 17:00 on October 15, but remaining G01–G13 scope is unchanged and is not a completion promise.

## Follow-on Task, Workflow and Subagent Hooks integration

Completed-child tool-message wake, Stop cancellation/join, Workflow `agent_type` selection and Subagent lifecycle Hooks are integrated. The shared combined regression passes **76 tests / 675 assertions across 24 files**, and all 21 workspace typecheck tasks pass (19 valid cache hits). Task wake and Stop cancellation each pass source CLI and rebuilt Desktop backend acceptance, including repetition after the later combined build. Workflow source CLI passes four checks / two child provider calls; its isolated installed comparison passes three selections / two child and eight total requests after correcting the fixture's error-result and title-wire assumptions. Workflow rebuilt Desktop passes the same four checks/two calls. Subagent shared CLI and rebuilt Desktop each pass three scenarios; the fresh isolated reference passes two scenarios with eight conversation and eleven auxiliary requests. The complete 4477-test checkpoint below predates this tranche and is not its aggregate acceptance.

The newer Hook-source and private work status is recorded above. Workflow resume is not yet an accepted feature. See [Task delivery](native-task-delivery.md), [Workflow selection](native-workflow-agent-selection.md), [Subagent Hooks](native-subagent-hooks.md) and [Hook cancellation](testing/runtime/hook-observer-cancellation-settlement.md). No full-scope completion, commit, push or merge is claimed.

## Shared automatic Memory, Task messages and MCP picker

The reviewed 20-file automatic Memory, 22-file Task message UI and 54-file MCP attachment handoffs are integrated. Shared-file overlaps preserve both additions; public clients were regenerated canonically. All 21 types and unified App/Desktop builds pass. Memory CLI and rebuilt Desktop each pass nine checks, and its combined lifecycle/input/Task regression passes 59 tests / 411 assertions. Task UI focused tests pass 3 / 32, and its unified browser/native window pass all delivery modes, receipt retention, cancellation and navigation; source mini/fullscreen also pass. MCP service/HTTP/client verification passes 18 / 154 across completed invocations, mini/fullscreen each four, and unified browser/native window each six. See [Memory](native-memory-automatic.md), [Task UI](native-task-message-ui.md), and [MCP picker](native-mcp-attachment-picker.md) for exact boundaries.

The paired MCP composer timing increased from a 186 ms to 203.5 ms median under concurrent host load, with a final 451 ms outlier; it is inconclusive, not a performance-equivalence claim. A repeated generated-SDK writer/reader collision is documented and promoted to RULE018. The complete 308-route HTTP gate now exits zero: coverage, auth and Effect each pass337 with zero failures/skips/missing/extra routes. The complete unit gate now exits zero with **4477 passes, 19 skips, one todo and zero failures**, 53 snapshots and 17052 assertions across 441 files; all six Turbo tasks pass. The subsequent serialized Client generated-consistency check exits zero and leaves the actual Git index unchanged. Historical intermittent CLI deadlines and the processor stop retain unknown root causes; a passing rerun does not establish their repair. The next private work covers completed-child message wake, Workflow agent selection and Subagent lifecycle Hooks, including a reproduced Hook cancellation/join failure; none is counted as integrated acceptance. No full-scope completion or merge is claimed.

## Task delivery and legacy Memory metadata integration

The reviewed legacy metadata, recovery-readiness and V1 migration supplements, active Task delivery backend and operator-agent amendment are integrated. All 57 frozen file versions were hash checked; the resulting 52 owned files preserve both shared documentation additions. The public Location group explicitly exposes SessionTask. Core migration generation/consistency, Client/legacy SDK generation, public configuration schemas and isolated-index generated consistency pass; the actual Git index is unchanged. All **21 workspace typechecks** pass without cache hits.

Task delivery retains canonical inbox admission, exact retries, launch ownership, Goal checks and distinct steer/queue/interject behavior. Root review reproduced an operator send accepted after its persisted Agent changed during permission approval; the narrow amendment rechecks that identity in the admission transaction. The shared Task/Memory regression now passes **54 tests / 495 assertions across 12 files**, including operator and Goal authority, nested Tasks and both corrected HTTP hosts. Three new Task HttpApi Effect scenarios pass over the 304-route inventory. Source CLI accepts all three delivery modes, with two child provider calls each. The fresh isolated installed comparison passes eight cases with 48 conversation and 42 auxiliary requests; this is reference evidence, not native acceptance. Operator UI and broader Task routing/wake contracts remain open.

The preceding Memory UI complete unit gate finished non-green: **4398 passes, 19 skips, one todo, nine failures and one unhandled error**, 53 snapshots and 16525 assertions across 431 files, in 20m0.991s. All 4992 captured package files were unchanged. Two failures were stale legacy flush rejection assertions; the corrected pure and mixed HTTP regression passes within the 54-test gate, distinguishing unsupported V2 recovery preview from supported empty flush. Seven CLI subprocess deadline failures did not reproduce in the unchanged-source isolated file (14 tests / 62 assertions, 35.93s); their cause remains unknown. The earlier processor stop did not recur in this run, which does not establish its repair. A new complete unit gate is still required.

Subsequent automatic Memory testing found a separate Flock acquisition cancellation defect. A shared negative control reproduced both waiting-cancellation failures. The utility correction passes four lock cases and three existing ownership/dead-owner cases. The initial Memory gate had 70 passes and two HTTP fixture route failures; those two fixtures were corrected and pass in the later 54-test gate. Source CLI and freshly rebuilt Desktop backend legacy metadata each pass five checks with four ordinary and one flush request. The complete Desktop build passes; its Task backend accepts all three modes with two child calls each. These are backend checks, not operator UI acceptance. Automatic lifecycle, MCP resource picker, final aggregate gates and platform acceptance remain open.

The three Astra agents stopped because of their usage limit. Their private drafts remain available, but unfinished private work is not shared implementation or acceptance. Root work continues on the current branch. No overall completion, commit, push or merge is claimed.

## Memory operation UI shared acceptance

Native Memory operation controls are integrated and have scoped shared acceptance. App adapter/locale tests pass **15 / 418**; corrected workspace types pass **21 / 21** (19 cached). Fresh complete App/Desktop builds pass. Browser and actual Electron window each pass **16 checks / five provider calls**, including en/zh/zht, real capture/Dream, exact retry, explicit reviewed clear and held Session/server navigation. Source mini/fullscreen at both terminal sizes and rebuilt Desktop mini/fullscreen at80×24 each pass **nine checks / three calls**. The fresh installed comparison passes **eight observations / five classified requests**, plus scope clear of two topics with zero calls. See [the UI contract and evidence](native-memory-operation-ui.md).

Integration corrected a dropped mixed-backend fixture option and an omitted package manifest in the private handoff. Both are recorded without inventing recurring causes. Legacy explicit flush/recall now also passes shared source CLI and rebuilt Desktop backend, four checks each with two ordinary and one flush request. Its V1 configuration forwarding supplement was discovered during the follow-on audit and remains pending integration; native-config passes do not prove that mapping. The requested installed legacy mode still returns V2 artifacts, so legacy runtime equivalence remains unresolved.

Deterministic legacy metadata and its maintenance-recovery/V1 migration amendments have passed handoff hash and base review and await shared integration. Active Task delivery has a frozen 34-file private backend handoff: 26 tests / 306 assertions, six package typechecks, and CLI/rebuilt Desktop acceptance for all three delivery modes pass. Root review then reproduced a separate operator-agent change during permission approval; its narrow amendment and regression are being verified before integration. Task operator UI remains in development. Native legacy automatic Memory has initial idle/admission/Stop and compaction race evidence, but broader validation is incomplete.

Native MCP attachment preparation/picker work has an approved lifecycle design and isolated reference evidence. Actual TCP disconnect probes exposed a pinned Bun POST cancellation limitation after request-body consumption, with Node as a control. A Session-bound reserve/execute/cancel operation design is being implemented so navigation can explicitly cancel and join local work; this does not claim to repair the transport or acknowledge arbitrary remote MCP cleanup. Final aggregate and platform gates remain open; no overall completion, commit, push or merge is claimed.

That checkpoint's required unit command has now finished with the result above. Review found a bounded Memory readiness Promise could outlive its file lock on cancellation; a private negative control reproduced the ordering, and the reviewed amendment is now integrated pending shared validation. Active Task Goal eligibility revalidation is included in the integrated backend.

## Nested foreground Task acceptance and legacy Memory integration

The reviewed nested Task handoff is integrated. Shared configuration, ownership, execution, headless denial and Goal accounting checks pass **29 tests / 321 assertions**. Source CLI and the freshly rebuilt Desktop backend each pass **six checks / twenty provider calls**, including real restart and immutable captured depth. The isolated installed comparison passes **three cases / eleven conversation and seventeen auxiliary requests** with explicit title/dashboard classification and isolation preflight. All **21 workspace typechecks**, public configuration schema, Client/legacy SDK generation and isolated-index generated consistency pass. The actual Git index is preserved. See [the nested Task contract](native-task-nesting.md).

The reviewed 17-file [native legacy Memory](native-memory-legacy.md) candidate is also integrated. Its shared five-file gate passes **48 tests / 302 assertions**, and shared Core/Apexo types pass. Rebuilt shared CLI/Desktop verification remains pending. The installed legacy backend probe cannot establish legacy runtime equivalence: the requested legacy mode still returns V2 artifacts. Source evidence and this limitation are retained separately from Apexo verification.

Memory operation UI has private browser/native-window, terminal and adapter evidence and is being frozen after a fresh paired composer measurement. Active Task delivery now has eight isolated installed-runtime reference cases; its native implementation is in a private workstream. Deterministic legacy metadata checkpoint work continues separately. These are incomplete portions of the original scope, not a complete-parity claim. The latest complete unit gate remains non-green; the subsequent 330-scenario HTTP attempt was interrupted in Effect mode after coverage and authorization each passed. Final aggregate gates remain required.

## Shared restoration, Memory recovery and exact retry checkpoint

The reviewed41-file Scheduler restoration,20-file Memory recovery and8-file exact-retry handoffs are integrated with original/final hashes checked. Apexo retains Session execution, permission, storage and lifecycle ownership. These are implementation checkpoints, not completed overall parity.

Shared restoration tests pass18/181 and App adapter/locale tests pass3/292. Source CLI restoration passes four checks/eleven provider calls, including real process death/reopen and one future cadence tick. The initial source backend readiness timeout is retained under [BUG163](testing/test-stability/native-terminal-backend-readiness.md); no timing fix or confirmed cause is claimed.

The shared Memory store/controller/crash gate passes82 tests/525 assertions; the subsequent Dream/recovery/retry gate passes24/162. Recovery source CLI passes six checks with zero provider calls, and server-derived retry passes nine with zero calls. All15 scoped Memory Effect HTTP scenarios pass. The fixture Location-query repair reuses [BUG091](testing/test-fixtures/hooks-native-permission-location.md); it does not change product placement. Native operation UI remains in development.

All21 refreshed workspace typecheck tasks pass without cache hits. Client and legacy SDK generation pass after composing all three handoffs; isolated-index `check:generated` passes and leaves the real Git index unchanged. Fresh shared App/Desktop builds pass. Packaged Scheduler restoration passes4/11, recovery6/0 and retry9/0. Browser and actual native window each pass four restoration checks in both branches across three locales. Mini/fullscreen each pass five ordinary checks and one permission-consent check at80×24; The latest HTTP coverage and authorization modes each passed all 330 scenarios over 302 routes. The Effect mode ended without a final summary when execution was interrupted; its process is no longer running, so no complete HTTP pass is claimed. All 4,971 captured package files remain unchanged. A fresh complete unit gate is still required. Private restoration acceptance and its paired composer measurement remain separately recorded in [the restoration feature](native-scheduler-restoration.md). The hardened [installed Memory reference](native-memory-reference-audit.md) is integrated; its shared runtime rerun passes eight checks/five classified requests plus actual isolation and clear checks.

Three Astra workstreams have resumed native Memory operation UI, legacy native Memory lifecycle, and the active Task delivery reference/design audit. The nested foreground Task handoff is frozen and awaiting shared integration. The complete scope remains in [the feature gap document](grok-build-feature-gap.md). The earlier aggregate processor failure and timing investigations below are still open. No commit, push, merge or complete-parity claim is made.

## Scheduler UI, headless CLI and Memory Dream shared integration

The reviewed Scheduler UI and `/loop`, native headless CLI including bounded startup cancellation/local attachments, and native Memory Dream/explicit migration are integrated in the shared branch. The subsequent canonical text-attachment conversion is also integrated; its runner composition preserves the Memory observers. Exact handoff and composition hashes were checked. Fresh App, standalone macOS ARM64 CLI and Desktop builds pass, including the compiled CLI version smoke test. Artifact builds do not establish completed CLI/Desktop/window acceptance.

Shared App tests passed 31 tests / 367 assertions; terminal/headless/help tests passed 45 tests / 214 assertions with 37 snapshots; the handwritten SDK command contract passed five tests / 13 assertions. Actual native-local source CLI passed 15 checks / 20 provider requests before the text conversion. The subsequent shared converter, native runtime, headless runner and side-question HTTP gate passed 22 tests / 178 assertions in 6.86 seconds. The fixed-backend Scheduler composer measurement is [recorded separately](testing/performance/native-scheduler-management-composer.md).

The serial shared Memory gate passes 68 tests / 436 assertions in 22.76 seconds with the existing CI outer budget. Expanded coverage and full authorization each pass 326 scenarios over 298 routes; focused Memory Effect mode passes all 12 scenarios. The first Dream invocation omitted the established outer timeout and also encountered separate internal phase deadlines; the first authorization run failed its health probe. No product code or internal deadline changed for the successful serial reruns, so those timing causes remain unresolved under [BUG271](testing/test-stability/native-memory-shared-validation-timeouts.md) and [BUG272](testing/test-stability/httpapi-auth-probe-startup-timeout.md). No complete post-Dream Effect aggregate is claimed.

Actual compiled native-local headless acceptance now passes 15 checks / 20 provider requests. Compiled local files pass seven checks / four requests, including both image-only and text-only prompts. The same compiled CLI attached to the freshly rebuilt mixed Desktop backend passes 17 checks / 22 requests, including text and PNG delivery, exact retry, inherited hard denial and joined signal cleanup. These are packaged-backend checks, not native-window acceptance. All commands exited zero and were reaped; see [the headless checkpoint](native-headless-cli.md#shared-integration-checkpoint).

Compiled held-startup cancellation passes three cases with zero provider requests; compiled active cancellation/supersession races pass three checks / three requests; seven invalid startup cases create no database and make no provider request. Shared [Memory Dream](native-memory-dream.md) source CLI and rebuilt Desktop backend each pass six checks with two ordinary, two extraction and three Dream calls. The shared prepared/completed crash boundaries pass ten checks total without repeated inference. These passes exclude the private Scheduler restoration and Memory clear/recovery drafts.

All 21 workspace typechecks, Client/legacy SDK generation and isolated-index generated consistency passed after UI/CLI/Dream integration; this typecheck checkpoint precedes the three production text-conversion changes. The actual Git index was unchanged. Refreshed Core and Apexo package typechecks also pass after the text amendment. The new [installed headless comparison](native-headless-reference.md) passes all16 scenarios with19 conversation and60 auxiliary requests, and its exact reviewed script/document handoff is integrated. Host-home and egress guards passed; both recorded shell/sleep pairs were absent at signal exit without forced fixture PID cleanup. The invalid PNG fixture was replaced in both shared native scripts; compiled files7/4 and packaged Desktop17/22 passed again. Shared Dream installed-reference and Scheduler UI/window acceptance remain pending.

The preceding complete unit checkpoint exited one: 4,313 passes, 19 skips, one todo, two failures, 53 snapshots and 15,880 assertions across 414 files; five of six Turbo tasks succeeded in 23m48.78s. All 4,928 package files remained unchanged throughout. The event-manifest count omitted the new canonical input-settlement event; the correction and complete processor test file now pass 21 tests / 104 assertions. The second failure, an unexpected compatibility tool-completion stop, did not reproduce and remains unexplained with failure diagnostics retained. See [BUG264](testing/test-fixtures/headless-event-manifest-count.md) and [BUG265](testing/test-stability/processor-tool-unexplained-stop.md). A successful focused rerun does not make the aggregate green.

The complete HTTP checkpoint below passed all 323 scenarios in each of three modes over 295 routes before these latest UI/CLI/Dream integrations. It remains valid for that checkpoint only. Scheduler restoration rearming, Memory orphan discard/clear and the broader feature-gap requirements remain in progress. Private restoration passes18 tests/181 assertions, App adapters/locales3/292 and six affected package typechecks. Frozen recovery passes82 tests/525 assertions and six CLI checks with zero provider calls. Both drafts are excluded from the fresh shared builds. Native Memory operation UI also needs a server-derived exact retry command after reopening; its design is reviewed and the narrow API amendment is in progress. No complete parity, commit, push or merge is claimed.

## Complete HTTP checkpoint after native input and Memory integration

The complete `bun run test:httpapi --trace --progress` gate exited zero. Coverage, authorization and Effect modes each passed 323 scenarios over 295 routes, with no failures, skips or inventory gaps. The 4,928-file package checkpoint remained unchanged throughout the run; no SQLite cleanup or Goal cleanup-recovery warning was found in the retained log. This checkpoint includes Scheduler permission refusal, headless input receipts and native Memory capture/flush. The complete unit gate is still running. The frozen Scheduler UI and headless CLI adapter have not yet been integrated and are excluded from this aggregate.

## Native headless and Memory capture integration checkpoint

The reviewed headless execution backend and native Memory capture/flush are now integrated with Scheduler. Per-input terminal receipts, passive waits, exact cancellation, captured headless policy, durable Memory operation receipts, strict ownership locks and canonical database migration are present in the shared branch. Client and legacy SDK generation passed. The combined real lifecycle/HTTP gate passed 60 tests / 449 assertions across eleven files. All 21 refreshed workspace typechecks passed after the final Memory retry-join and Scheduler refusal corrections. Isolated-index generated consistency and the shared Desktop build also passed; the actual Git index was unchanged. This is backend integration, not completed headless CLI or advanced Memory acceptance.

Integration reproduced and corrected unsupported Memory extraction returning the wrong HTTP status, a compaction fixture assuming extraction order, and immediate retry racing a finished operation's finalizers. See [BUG242](testing/runtime/memory-operation-unsupported-status.md), [BUG249](testing/test-fixtures/memory-compaction-extraction-order.md), and [BUG251](testing/runtime/memory-finished-operation-retry.md). Shared Memory source CLI and rebuilt Desktop each passed five checks with two ordinary and three extraction requests, including actual publication, deduplication, real crash/passive restart and exact explicit recovery. A fresh installed-reference run passed seven checks with four requests. Four input and nine Memory HTTP scenarios passed over 295 routes with zero failures, skips or inventory gaps. The Scheduler refusal correction passed an additional 18 tests / 345 assertions. Complete repository unit and HTTP gates are now running; actual headless CLI acceptance remains pending its adapter integration.

Three GPT-6 Astra workstreams continue in isolated coherent snapshots: Scheduler management UI and `/loop`, the headless CLI adapter, and Memory Dream/explicit migration. Their private passes do not substitute for shared integration. Scheduler automatic rearming after explicit Session restoration is still open. The broader remaining delivery scope includes advanced retrieval, Task steering/fork/worktree contracts, whole-agent sandboxing, remaining Hooks/Plugins contracts, and platform/external-service acceptance. No complete parity, commit, push or merge is claimed.

## Scheduler integration and current aggregate result

The reviewed native Scheduler backend is now integrated with five management routes and six HTTP inventory scenarios. The omitted durable default is corrected, and a further same-Session restart mismatch is reproduced and corrected: ordinary saved intent must not expire solely because its process owner changed. Shared Scheduler/Task/protocol regression passed 22 tests / 391 assertions, all 21 workspace typechecks passed without cached tasks, and the six focused HTTP scenarios passed with no failures, skips or inventory gaps. Canonical migration generation and consistency, Client and legacy SDK generation, isolated-index generated consistency and the shared Desktop build passed.

Source CLI and rebuilt Desktop each passed six checks / 15 provider calls with omitted durable and real recurrence, including restart retention, passive reads, explicit future-only Resume, deletion preserving admitted Tasks, active Stop joining children, and skipped overlapping ticks. Each also passed five checks / nine calls with explicit durable enabled. These are backend acceptance results; the Scheduler native window remains in the UI workstream. A fresh installed contract probe passed with 25 provider requests, and the separate same-Session restart probe passed four observations / 15 requests, including automatic firing at a real 60-second cadence after process kill and Session restoration. Native automatic rearming remains an open requirement; manual future-only Resume does not close it.

The complete pre-Scheduler unit gate has now finished with 4,266 passes, 19 skips, one todo and one failure; 53 snapshots and 15,198 assertions ran across 402 files. Five of six Turbo tasks passed in 19m13.025s. The 4,888-file package checkpoint remained unchanged during the run. Its sole failure was the old mixed-protocol panel fixture returning a health object for the newly added Process list route. The corrected fixture passes both modes, two tests / six assertions; see [BUG229](testing/test-fixtures/session-protocol-process-list.md). This does not retroactively make the complete gate green.

The complete 309-scenario HTTP gate predates Scheduler integration. A fresh complete HTTP and unit gate remain required; the new all-21 type gate includes Scheduler. Native Scheduler UI remains in private acceptance. Native Memory capture/flush and the headless execution backend have frozen handoffs awaiting shared review and composition; the parallel workstreams now continue Memory Dream/migration and the headless CLI adapter. Private passes are not shared acceptance.

## Current Worktree ownership and complete HTTP checkpoint

The actual workspace synchronization route no longer starts a process-global application graph outside its caller's lifetime. Built-in Worktree operations use the caller-owned service and cancellation signal. The shared five-file workspace/cancellation gate passed 48 tests / 169 assertions, and Apexo typechecking passed. The complete `bun run test:httpapi --trace --progress` command then exited zero: coverage, authorization and Effect modes each passed 309 scenarios over 283 routes, with no failures, skips or inventory gaps. The retained application log contains no Goal cleanup recovery or SQLite I/O warnings. See [BUG175](testing/test-fixtures/httpapi-database-reset-ownership.md).

The original Session/Goal read deadline causes remain unknown under [BUG174](testing/test-stability/httpapi-session-get-timeout.md); neither the green aggregate nor the separate owner repair establishes why those earlier requests timed out. The full-unit gate then exited one: 4,246 tests passed, 19 skipped, one todo and three failures, with 53 snapshots and 15,132 assertions across 402 files; five of six Turbo tasks passed. Two unchanged config snapshots exposed [BUG206](testing/runtime/config-media-attachment-alias.md), now corrected with configuration36/112 passing. The third failure was an outdated Worker environment source-shape assertion, now replaced with real workers. That verification also exposed and repaired a pinned-Bun worker mode-selection defect; shared Worker tests passed 11 tests / 23 assertions and the refreshed workspace type gate passed all 21 tasks. That subsequent complete unit aggregate has now finished as recorded in the newer checkpoint above. The reviewed 25-file native Process/Monitor UI is integrated, preserving current CLI/Memory runtime hunks. Shared App adapters passed 24 tests / 91 assertions; the terminal/footer gate passed 50 tests / 215 assertions with five existing skips. App/Desktop builds passed. Explicit English/Simplified Chinese/Traditional Chinese browser and actual native-window runs each passed eight checks, with 47 and 49 setup/Monitor-event provider calls respectively and zero UI-induced calls. Pure mini passed six checks and packaged mixed-backend narrow mini passed five, each with 21 setup calls and zero UI calls. The fullscreen timeout was a proven fixture action-readiness race, now recorded under recurring BUG157/RULE015. Shared held-refresh pure fullscreen passed seven checks and packaged narrow fullscreen passed five, each with 21 setup calls and zero UI calls. The fixed-backend composer comparison is complete. The updated standalone CLI also passed actual native/compatibility fullscreen interactions with opposite inherited worker flags. Scheduler backend is frozen and privately verified but not yet integrated; native Scheduler UI, advanced Memory and headless execution remain in progress. No commit, push or merge is claimed.

## Monitor and explicit terminal transport integrated

The reviewed Monitor backend and explicit attached-terminal transport are now integrated with native Memory. The combined 21-file gate passed **141 tests / 803 assertions**, with no failures and clean exit. It covers real process ownership, independent UTF-8 pipes, trailing output, Plan gating, Memory, selected Tasks/Goal panels and terminal transport. All **21 workspace typechecks**, Client and legacy SDK regeneration, isolated-index generated consistency and the shared Desktop build passed.

Shared Monitor CLI and rebuilt Desktop each passed **ten checks / 57 provider calls**, and all twenty command-owned PIDs were absent after cleanup. All six fresh installed-reference scenarios passed separately. The first shared Desktop attempt exposed a cancellation-readiness fixture mistake: cancellation completed before the command wrote its PID, then the driver incorrectly waited for that file. The corrected running-process scenario establishes PID liveness before cancellation and verifies joined cleanup afterward; see [BUG099](testing/test-fixtures/task-background-provider-classifier.md). Monitor-specific UI and the latest complete repository gates remain open. The packaged mixed-terminal matrix is now complete for the fourteen scoped scenarios described below.

The separate HTTP fixture reset now closes its web and scenario services before removing owned database files and no longer constructs a second process-global runtime in the reset helper. Four focused HTTP scenarios and Apexo package types passed without SQLite warnings. However, the fresh complete gate again logged a SQLite cleanup warning: coverage and authorization each passed all 309 scenarios, while Effect mode passed 308 and timed out in `v2.goal.get` at the existing thirty-second deadline. There were no skips or route-inventory gaps. The cleanup investigation [BUG175](testing/test-fixtures/httpapi-database-reset-ownership.md) remains open. The earlier compatibility Session-read timeout [BUG174](testing/test-stability/httpapi-session-get-timeout.md) also remains unexplained; similar timeout symptoms do not prove a shared cause.

The reviewed 29-file [Memory UI](native-memory-ui.md) is now integrated, preserving the explicit terminal selector through a narrow runtime composition. Its shared real-HTTP adapter passed six tests / 28 assertions. Private final acceptance passed browser18, actual native window18, and both terminal modes at two sizes24, with zero management-induced provider calls after five setup calls per run; all three affected package typechecks passed privately. Shared App, TUI and Apexo typechecks and the App production build now pass. Shared production browser and actual rebuilt Desktop windows now each pass eighteen checks. Pure-source normal-size and packaged mixed-server narrow mini/fullscreen runs pass twenty-four checks total, each with five setup calls and zero management-induced calls. A fresh installed reference comparison passed both selections with four requests. The paired composer comparison includes both run orders and remains bounded measurement evidence, not a causal performance claim.

Packaged mixed-terminal acceptance passed Tasks/Goal panels, fresh creation and managed-child views in both modes. Plan then exposed [BUG185](testing/ui/terminal-stream-spacer-column.md): the mini renderer measured a new entry with the preceding entry's column before writing its spacer. The new assistant/reasoning regression failed before the narrow repair; all nineteen scrollback tests / 75 assertions, Apexo types and both packaged Plan/permission/Stop modes passed afterward. The corrected reconnect fixture now explicitly closes live SSE responses and tracks their actual response lifetime; [BUG186](testing/test-fixtures/mixed-terminal-reconnect-trigger.md) records why the earlier request-close bookkeeping lost those connections. Reconnect passed five checks / three calls in each packaged mode. All fourteen packaged mixed-terminal scenarios now pass: panels, fresh creation, managed-child views, Plan, permission, Stop and reconnect, each in mini and fullscreen. Source CLI Plan also passed four checks / five calls in each mode.

Native local interactive CLI is integrated. Shared Apexo types and the combined terminal/scrollback gate passed 46 tests / 144 assertions. Shared real mini/fullscreen interaction, authenticated worker, rejected options, provider/Task/process/MCP cleanup and help snapshots passed. The standalone build initially exposed a Bun split-chunk collision; narrowing client-only SDK imports now passes compilation and the actual version smoke test. All eleven compiled terminal/rejection commands now pass, including native Question, permission/reopen, Plan, Stop and default compatibility in both modes. The refreshed workspace typecheck gate passed all 21 tasks (18 valid cache hits). The latest full unit and complete HTTP gates remain open. Scheduler lifecycle validation and Monitor-specific UI implementation continue in separate private snapshots. Advanced Memory lifecycle remains open. No commit, push or merge is claimed.

## Shared native CLI and Memory checkpoint

The combined eleven-file gate passed 96 tests / 371 assertions and all 21 workspace typechecks. Public Client and legacy SDK generation passed; candidate regeneration matched an isolated index and left the real Git index unchanged. TUI's direct Schema workspace dependency was installed from the frozen lockfile before validation. The new Memory HTTP inventory cases passed five scenarios over 283 routes. The complete three-mode gate exited 1: coverage and authorization each passed 309 scenarios, while Effect mode passed 308 and timed out in compatibility `session.get` at 30 seconds. There were no skips or route-inventory gaps. The timeout remains [BUG174](testing/test-stability/httpapi-session-get-timeout.md); it is not a completed gate.

Memory source CLI and rebuilt Desktop each passed four checks / three provider calls, including durable mode across actual process restart without model wake. A fresh isolated installed-reference comparison passed both enabled configuration selections with four total requests; both advertised filesystem tools, not legacy Memory tools. This does not certify Memory UI or advanced lifecycle work. See [native Memory](native-memory-tools.md).

The actual shared mini/fullscreen terminal matrix passed nine groups in each mode: fresh creation, Plan, SSE reconnect, permission, active Stop, media paths, passive managed-child view, Tasks manager and compatibility regression. The first parallel permission pair timed out before native fixture/terminal startup; unchanged single-mode reruns passed. That startup cause and the separate first-run Memory-context timeout remain investigations. No deadline was increased. See [native terminal transport](native-terminal-transport.md), [BUG163](testing/test-stability/native-terminal-backend-readiness.md) and [BUG161](testing/test-stability/native-memory-context-timeout.md).

This historical checkpoint excludes the later Monitor, explicit terminal selector and Memory UI integration described above. The previous complete unit checkpoint also excludes those changes; a fresh aggregate gate remains required. No commit, push or merge is claimed.

## Shared Shell, media options and Process manager checkpoint

The shared native Shell/media/Plan gate passed 68 tests / 623 assertions and all 21 typechecks. CLI and freshly rebuilt Desktop each passed nine Shell checks / 26 calls and five media-options checks / eight calls. Shared App adapters passed 24 tests / 89 assertions, browser and actual Desktop Process manager checks each passed seven checks / 16 setup calls with zero additional provider work, and compatibility panel regression passed. Client/SDK generation, candidate generated consistency, config schema generation and Core migration consistency passed. The complete HttpApi gate passed 304 scenarios in each of coverage/auth/Effect modes over 278 routes, with no failures/skips/inventory gaps. The [paired composer measurement](testing/performance/native-shell-ui-composer.md) is complete (after 115.5/127 ms median/p95 versus before 110.5/126; no causal timing claim). The earlier full-unit checkpoint below predates these changes. See [Shell](native-shell.md), [Process UI](native-shell-ui.md), and [media options](native-media-options.md).


## Previous full unit checkpoint: Plan and media UI

Before the later Shell/media-options integration, the complete `GITHUB_ACTIONS=false bun turbo test --concurrency=2` gate passed all six Turbo tasks: 4,155 tests passed, 19 existing skips, one todo, zero failures, 53 snapshots and 14,426 assertions across 383 files; process exit was zero. The Apexo test process took 1,044.59 seconds. All 21 typechecks and the 299-scenario three-mode HttpApi gate had also passed for this checkpoint. It excludes the subsequent Shell backend and media-options handoffs. Earlier unexplained MCP, V2 completion and media timing observations remain investigations; this green aggregate does not retroactively prove their causes or repairs.

## Native Plan backend: scoped CLI/Desktop recovery acceptance passed

Shared Plan behavior and background Task approval ordering passed 14 tests / 153 assertions; all 21 typechecks, Core migration consistency, Client/legacy SDK generation and candidate generated consistency passed. CLI and rebuilt Desktop recovery each passed 13 checks / 10 calls; two actual crash checkpoints passed ten checks / six calls. The localized approval UI now passes shared production browser and actual Desktop six checks / six calls each, including full-document keyboard reachability and ordinary custom-answer regression. The [fixed-backend composer comparisons](testing/performance/native-media-plan-composer.md) are complete; native-only terminal bootstrap remains pending. See [native Plan](native-plan.md). These scoped results do not establish complete G07 parity.

## Native media backend: scoped CLI/Desktop acceptance passed

The four canonical native image/video tools are integrated into Apexo's Location registry and existing Session drain. Shared real HTTP tests passed 14 tests / 104 assertions; all 21 package typechecks passed, and CLI plus rebuilt Desktop each passed five checks / eight language-provider calls. Isolated installed Grok comparison covers all four tools separately. Exact output-target authorization was repaired before billed work; the analogous compatibility path was separately reproduced and repaired, with seven tests / 39 assertions, package types, four denial checks on CLI/Desktop, normal media/S3 acceptance and a fresh official comparison all passing. Shared production media previews/playback now pass App tests four / nine, all 21 types and browser/actual rebuilt Desktop 12 checks / ten calls each across en/zh/zht. Final frame visibility and fixed-backend performance comparisons are complete. Native-only terminal rendering, native S3/model overrides and external-service acceptance remain open. The first shared read-denial timeout is recorded with unknown timing cause; the later bounded green gate does not prove a runtime repair. See [native media](native-media-tools.md).

## Native background Task: scoped three-surface acceptance passed

The shared native implementation now passes 33 tests / 328 assertions, App adapter 9 / 35 and all 21 package typechecks. Client/SDK generation, candidate generated consistency and production App/Desktop builds passed. CLI and rebuilt Desktop each passed eight lifecycle checks / 32 provider calls. Installed Grok idle/active/wait/cancel comparisons remain isolated reference evidence. Actual background row indicators are accepted: production browser and native Desktop each passed ten checks / 22 calls across en/zh/zht; live mini/fullscreen narrow terminals each passed seven / 22, with private normal-size checks also passing. Final visibility screenshots were inspected and the fixed-backend composer comparison is complete. Active steering, transcript-fork continuation, worktree delegation and Goal background ownership remain open. Earlier unexplained private SOAP/reset observations remain recorded. See [native Tasks](native-task.md).

## Native sandbox controls and compatibility Plan permission

Command sandbox creation controls and the native prompt adapter are integrated. Live App transport checks passed three tests / 18 assertions; browser and actual rebuilt native Desktop windows passed seven checks / three calls each across en/zh/zht. Both actual terminal slash routes passed three checks with zero provider calls. Visual review found duplicate Session-creation errors; a narrow early return now passes a corrected failing-before/passing-after browser regression and the real native window. App typecheck and production App/Desktop builds passed. The final repaired-artifact composer measurement was 112.5 ms median / 118 ms p95 against the same preserved backend, versus 122 / 126 ms before this repair, with no Long Task entries. This small sample does not establish a causal speedup. See [controls](native-command-sandbox-ui.md) and [BUG095](testing/ui/session-create-duplicate-toast.md).

Compatibility Plan entry now checks its canonical permission before switching agents or persisting its existing transition input. Live CLI and rebuilt Desktop each passed six checks / ten local-provider calls across allow, ask approval, ask rejection and deny. The Apexo package typecheck passed after shared integration. Installed default/ask/deny separately passed five/four/one comparisons with 14/9/10 requests. Native Plan now has the newer scoped integration checkpoint above; this earlier compatibility repair does not establish native parity. See [BUG097](testing/permissions/plan-enter-configured-ask.md).

## Earlier Plan and media HTTP checkpoint

After native media backend, Plan backend/recovery and UI integration, `bun run test:httpapi` passed all 299 scenarios in each of coverage, authorization and Effect-handler modes over 274 routes, with no failures, skips or inventory gaps and clean process exit. This is the compatibility HttpApi route inventory; native Plan behavior has the separate real native HTTP/CLI/Desktop gates above. The separate full unit investigation remains open.

## Native foreground Task and bounded command sandbox: scoped acceptance complete

The integrated first-party backend passed 23 tests / 284 assertions across twelve files and all 21 repository typecheck tasks. Database migration/schema checks, Client and legacy SDK generation, and candidate generated consistency passed. Focused HTTP coverage passed nine scenarios over 274 inventoried routes without missing, extra or skipped scenarios.

Task CLI and rebuilt Desktop each passed five checks / fifteen provider calls. Production browser and actual Desktop windows each passed six checks / eight calls across en/zh/zht. App and terminal adapters each passed six tests / 32 assertions; live native mini/fullscreen narrow PTYs each passed three checks / eight calls. Native terminal panel acceptance does not establish complete native-only CLI bootstrap. The installed reference separately passed five comparisons / three child calls / 29 total requests.

Command sandbox CLI and rebuilt Desktop each passed seven checks / four provider calls. The isolated installed comparison made four provider calls and retained its documented fully isolated read-only startup limitation. The [sandbox contract](native-command-sandbox.md) covers macOS native Bash and descendants; creation controls and whole-agent enforcement remain open. The [Task contract](native-task.md) covers foreground execution; background/nested execution and active steering remain open. No complete parity or aggregate gate completion is claimed.

## Whole-unit diagnostic checkpoint remains red

A coherent isolated snapshot of the managed-child and sandbox UI integration ran the complete unit command with private cause capture: 4,106 passes, 19 skips, one todo, two failures, 53 snapshots and 13,989 assertions across 376 files; five of six Turbo tasks succeeded, with clean process exit reporting failure. It excludes the later toast and compatibility Plan repairs. The original MCP reload failure did not recur, so its cause remains unknown. The two failures were an ordinary V2 completion timeout (investigating) and a stale Task rejection-message assertion. The exact assertion correction is now integrated and passed two focused tests / 43 assertions; this does not turn the earlier aggregate green. See [MCP investigation](testing/test-stability/mcp-native-reload-full-suite.md) and [Task fixture](testing/test-fixtures/task-managed-rejection-message.md).

## OAuth and Workflow effort aggregate: one failure under investigation

The full unit gate exited 1: 4,072 passed, 19 existing skips, one todo, one
failure, 53 snapshots and 13,569 assertions across 359 files. Five of six Turbo
tasks succeeded in 15m52.26s. Native stdio MCP reload returned a generic plugin
load failure. The unchanged focused test then passed one test / eleven
assertions; this is not a repair. The aggregate remains unverified. See
[BUG084](testing/test-stability/mcp-native-reload-full-suite.md).

## Workflow/Goal input and execution ownership: scoped acceptance passed

Private Created-bound authority now rejects unrelated native and compatibility child input before mutation, preserves ordinary Session-ID reuse after deletion, and prevents metadata edits from granting authority. The live combined suite passed 12 tests / 217 assertions, all 21 typecheck tasks and migration consistency. CLI and rebuilt Desktop each passed four Workflow checks / two provider calls, and ten Goal summary checks / 80 calls. The isolated installed summary comparison separately passed two checks / 24 total requests.

A further deterministic check confirmed that public resume could start a role-bound child before the owning operation called its trusted child capability. Owner cancellation still joined it; no duplicated execution or escaped cancellation was observed. BUG-20261015-091 is now repaired; the live ownership/lifecycle gate passed 39 tests / 272 assertions and all 21 typechecks. CLI/rebuilt Desktop each passed Task five checks / 15 calls, Workflow four / two, and Goal summary ten / 80. See [input ownership](native-managed-child-admission.md), [Workflow admission](testing/permissions/workflow-managed-child-admission.md) and [Goal admission](testing/permissions/goal-managed-child-admission.md).

## Workflow Rhai effort: scoped acceptance complete

Native Workflow calls now select reasoning effort through declared native model
variant payloads, preserve other body/header settings, and persist the selected
variant on the child. Unknown, unavailable, ambiguous or conflicting selections
fail before child/model work. Apexo retains model and Session authority.

Live focused validation passed 14 tests / 70 assertions and all 21 typecheck
tasks. CLI and rebuilt Desktop each passed six checks / seven provider turns,
including real Responses, chat-completions and Anthropic requests, budget resume
and process restart. Isolated installed Grok passed six comparisons / five child
requests (16 total including auxiliary work in this run). Its unadvertised-effort
and unsupported-model behavior differs explicitly from Apexo's validation. No
public API or App/TUI controls changed; no generation or composer benchmark is
needed for this slice. See [the contract](native-workflow-effort.md).

The whole-unit gate for OAuth plus effort failed once as recorded above; investigation and a successful corrected aggregate remain pending. Task/Subagent and command sandboxing now have the newer integrated checkpoint above; they are not delivered by this older effort checkpoint. No commit, push or merge was performed.

## Native MCP OAuth: scoped acceptance complete

The reviewed forty-file implementation now runs inside Apexo's native runtime.
Explicit authentication, cancellation, private credential persistence and refresh
preserve saved connection choices and existing healthy transports. No Grok
runtime is embedded. Local callback placement and external-provider limits remain
explicit in [the feature contract](native-mcp-oauth-feature.md).

Live validation passed 29 tests / 142 assertions, eleven checks / three provider
requests in each CLI and rebuilt Desktop backend, nine checks in each production
browser and actual native window across en/zh/zht, five in each native terminal
size, and four in each compatibility terminal mode. All six localized native
screenshots and both native terminal captures were inspected. Installed Grok's
configured-client and dynamic-registration profiles each passed five checks with
zero provider requests in fresh isolated runs.

Both client generators, isolated-index generated consistency, all 21 typecheck
tasks and App/Desktop builds passed. Seven focused MCP HTTP scenarios passed over
269 routes with no inventory gaps. The full HTTP gate passed all 290 scenarios
in each coverage, authorization and Effect-handler mode over 269 routes, with
zero failures, skips, missing routes or extras and clean exit. The repository
unit gate failed once as recorded above; the older 4,036-test checkpoint below predates OAuth.
One native-window fixture document-URL error was fixed and verified in both UI
modes; [the bug record](testing/test-fixtures/mcp-oauth-native-document.md) separates
it from product defects. No commit, push or merge was performed.

Task/Subagent and native command sandboxing have the newer integrated checkpoint above.
Workflow effort has its own scoped acceptance recorded above.

## Persistent Hook choices and preceding Workflow changes: shared gates passed

The reviewed 56-file draft is integrated into Apexo. Saved global disables and
per-Session effective choices remain distinct; toggles preserve active dispatch,
registry generation, existing receipts, permissions and lifecycle ownership.
Other captured Sessions adopt saved choices only on explicit reload. Corrupt
storage remains visible and never silently enables handlers.

Live checks passed 45 implementation tests / 225 assertions across thirteen
files, plus two actual terminal-component list-growth tests / ten assertions.
CLI and rebuilt Desktop each passed six scenarios / ten provider requests.
Production browser and actual native window each passed eleven checks across
en/zh/zht; mini and fullscreen each passed nine. Native screenshots and both
terminal captures were inspected. Installed Grok separately passed ten checks
with eight requests using the now-reproducible repository comparison script; its runtime remains reference-only.

Client/legacy SDK generation, isolated-index generated reproducibility, all
21 typecheck tasks and App/Desktop builds passed. The seven focused HTTP
scenarios passed with zero missing or extra routes; the inventory now covers
267 routes. Apexo typechecking passed again after adding the renderer regression.
The complete HTTP gate passed all 288 scenarios in each coverage, authorization
and Effect-handler mode over 267 routes, with zero failures, skips, missing
routes or extras and clean exit. The complete unit gate passed 4,036 tests, 19 existing skips, one todo, zero
failures, 53 snapshots and 13,394 assertions across 354 files. All six Turbo
tasks and process exit succeeded in 14m53.582s; the package test process took
884.89s. This aggregate includes Hook preferences plus the preceding Workflow
correction, Git authority and terminal-layout changes. Earlier 4,017-test counts
below are historical. See
[the feature contract](native-hook-preferences.md).

MCP OAuth now has scoped integrated acceptance above; native Task/Subagent remains an isolated implementation draft.
Native command sandboxing is being developed as a separate, explicitly bounded
scope; whole-agent OS enforcement remains open. No commit, push or merge was
performed for this checkpoint.

## Workflow host permission acceptance and repair

Template and Git host operations passed six CLI and six rebuilt Desktop checks
with zero provider calls. A real permission regression was found and repaired:
flattening Session grants after configured agent rules exposed a denied file in
Git evidence. The host now uses the existing native permission authority; the
regression preserves the configured denial after a broad Session grant. The
native HTTP regression and existing Workflow E2E passed two tests / 24 assertions.
Core and Apexo typechecks and Desktop build passed.

Installed Grok 1.0.52 passed three host-operation comparisons with one ancillary
request and no Workflow child. The pinned source supplies an empty normal-Session
template catalog, and the installed run rejected an unknown template. Apexo's
existing local template directory is its own contract, not a demonstrated
missing reference interface. See [host operations](native-workflow-host-operations.md)
and [the authority defect](testing/permissions/workflow-git-authority.md).
The latest 4,036-test and 288-scenario HTTP checkpoints above include this repair.

## Workflow output correction: scoped acceptance complete

The reviewed 22-file slice adds one schema-correction drain in the same native
child, durable attempt claims, idempotent known-usage receipts, and explicit
lower-bound/recovery guidance. Interrupted claimed attempts cannot resume;
rejection preserves their state and creates no model work. The public recovery
reason is derived from current ownership and never persisted as authority.

The isolated draft passed 18 tests / 118 assertions and five CLI checks / nine
provider calls. Installed-reference valid-after-correction and invalid-twice
comparisons each passed two checks, with two child calls and four total requests.
These are separate evidence sets. Live verification passed 29 focused tests /
194 assertions across eleven files. CLI and rebuilt Desktop each passed five
checks / nine provider calls, including cancellation and real process restart.
Production browser and actual native window each passed sixteen checks across
English, Simplified Chinese and Traditional Chinese. Mini and fullscreen
terminals each passed fourteen checks. All three App locales show the known
120-token lower bound and new-run guidance, with Resume hidden; terminal guidance
and the disabled Resume shortcut also passed. The separate Source-line overlap was reproduced in the real renderer and fixed. Two component tests / ten assertions, both terminal layouts, final Apexo/TUI typechecks and Desktop build passed; rebuilt Desktop schema acceptance passed five checks / nine calls again. See [the layout defect](testing/ui/workflow-terminal-fixed-rows.md).

Live Client/legacy SDK generation, candidate generated-code reproducibility,
all twenty-one typecheck tasks and App/Desktop builds passed after integration;
the real Git index was unchanged. The complete 4,017-test
checkpoint below predates this new slice; the newer 4,036-test checkpoint above includes it. See
[the correction contract](native-workflow-schema-correction.md).

Persistent Hook choices and OAuth now have scoped integrated acceptance recorded above.

## MCP saved preferences, Workflow child models and compaction hooks: scoped acceptance complete

Native MCP saved choices passed 24 tests / 201 assertions, eleven CLI and eleven
rebuilt Desktop scenarios with nine provider requests per backend, sixteen checks
in each of the production browser and actual native window across en/zh/zht,
nine checks in each native terminal size, and four in each compatibility terminal
layout. Storage-error cases retain healthy tools and clear the inline error after
exact-byte repair. Existing resource-tool acceptance passed eleven scenarios /
twenty provider calls again on each backend. See [saved preferences](native-mcp-preferences-feature.md).

Workflow child model selection passed sixteen tests / one hundred assertions,
five CLI and five rebuilt Desktop checks with five provider turns each, and an
installed-reference comparison. Explicit models/variants participate in durable
identity; unavailable selections create no child/provider work, and model
preflight runs outside mutation leases. See [child models](native-workflow-models.md).

Native PreCompact/PostCompact observers passed 61 tests / 199 assertions with
one existing skip, five CLI and five rebuilt Desktop checks with three provider
calls per backend, and five installed-reference checks with five calls. The same
captured registry surrounds summary execution; cancellation joins hook child
cleanup. The installed empty-compaction behavior differs explicitly from Apexo's
existing no-op. See [compaction hooks](native-compaction-hooks.md).

Final Client/legacy SDK generation, candidate generated-code reproducibility,
App/Desktop builds and all twenty-one typecheck tasks passed. The MCP action-type
and optional-wire-field defects are corrected; the wire-contract regression test
passes one test / four assertions. The final production composer measurement was
123 ms median / 157 ms p95, compared with 132.5 / 181 ms immediately before this
batch, with no Long Task entries. These small host measurements do not establish
a causal speedup.

The final HTTP gate passed all 286 scenarios in each of coverage, authorization
and Effect-handler modes, covering 265 routes, with zero failures, skips, missing
routes or extras and successful process exit. It includes the final optional-field
correction and Hook integration. The complete unit gate passed on the same frozen
production source: 4,017 passes, 19 skips, one todo, zero failures, 53 snapshots and 13,249 assertions
across 348 files. All six Turbo tasks and process shutdown succeeded; the unit
process took 875.90 seconds. This includes both repairs for the preceding
deletion-related failures. The loaded-host compaction timing failure remains an
explicit investigation despite the unchanged isolated pass and green full gate.

The subsequent batch addresses Workflow schema correction, MCP OAuth and persistent
Hook choices, with its current status above. Automatic MCP catalog relisting was removed from the migration
requirements after the [reference audit](native-mcp-notification-reference-audit.md)
showed that the pinned and installed references do not implement it. No foreign
runtime is a product dependency.

## Native Session deletion and durable ownership: accepted by the current local gates

The admission fence and cancel-and-join lifecycle are now integrated with native
and compatibility execution, background jobs, side questions, Memory and
Scheduler ownership. Focused live verification passed 58 tests/259 assertions;
all 21 typecheck tasks and generated-code reproducibility passed. CLI and rebuilt
Desktop native deletion each passed seven scenarios/three provider requests.
Historical Memory conflict acceptance passed four checks on each backend, with
zero extraction for ambiguous history and one successful fresh-Session extraction.
Mini and fullscreen terminals each passed three guidance/retry/preservation checks.
Browser and actual Desktop windows passed localized deletion and historical-Memory
message acceptance. Scheduler ownership passed six checks on each backend, with
only the two valid scheduled provider executions.

The complete HTTP gate passed all 285 scenarios in each of three modes, with
zero failures, skips, missing routes or extras and successful process exit.
The first unit gate reported 3,997 passes and two deletion-related failures. Both repairs passed focused checks and the subsequent current aggregate gate above passed 4,017 tests with zero failures. Composer confirmation measured 132.5 ms median / 181 ms p95 versus 131 / 148 ms before, with differing host load. Unknown historical Memory ownership stays an explicit conflict with
preserved data; physical provider socket closure remains unverified. See
[the native deletion contract and evidence](native-session-deletion.md).

## Native MCP resources: scoped acceptance complete

The canonical resource-list, template-list and resource-read tools now run in
Apexo native Sessions. Live real-server tests passed eight tests/59 assertions;
existing MCP/registry regression passed 29 tests/127 assertions. CLI and rebuilt
Desktop backend each passed eleven scenarios/20 provider calls, including
permission-denied zero-read cases, multi-block content, provider continuation,
connection failures and recovery. Installed Grok 1.0.52 passed six checks/three
calls for its resource-read extension; it did not advertise the canonical tools.
Live Core and Apexo typechecks passed. All owned processes were reaped. See [resource evidence](native-mcp-resources-feature.md).

No App picker or new visual attachment-rendering acceptance is claimed. The
current complete local gates above include this resource slice and the subsequent
Session deletion/Scheduler/Memory integration. Earlier checkpoints below remain
historical evidence.

## LSP recovery policy and historical Goal cleanup: scoped acceptance complete

Both features are integrated into Apexo, and the complete local gates passed on
this frozen source. The unit gate passed 3951 tests, with 19 skips, one todo, zero
failures, 53 snapshots and 12862 assertions across 330 files; all six Turbo tasks
and process exit succeeded. The unit process took 804.46 seconds. Subsequent
typechecking passed all 21 tasks. HTTP coverage, authorization and Effect-handler
modes each passed all 283 scenarios with zero failures, skips, missing routes or
extras, and successful process exit. Committed CI and platform acceptance remain.
The prior unexplained processor retry-status symptom remains unresolved; this
passing run does not establish a causal fix.

| Capability | Apexo CLI / rebuilt Desktop backend | Production browser / actual native window | Installed Grok 1.0.52 reference |
| --- | --- | --- | --- |
| Native LSP restart/shutdown policy | Nine scenarios/two provider requests each; twelve focused integration tests/129 assertions and final policy tests six/49 | Seven checks each across en/zh/zht, including automatic recovery, exhausted budget and child reaping | Eight checks/three requests; the graceful shutdown deadline is source-backed only because installed Session close bypasses that handshake |
| Historical terminal Goal cleanup recovery | Four checks/zero provider requests each, including real startup maintenance and restart; final cleanup tests fourteen/96, broader focused regression one hundred/658 | No App source change or new interaction; existing report views remain applicable | Four checks/22 requests verify terminal scratch removal and retained reports; Apexo-specific historical migration uses explicitly synthetic persisted fixtures |

Core and Apexo scoped typechecks, final Desktop build, Client/SDK generation and
candidate generated-output consistency passed. The generated check used an
isolated Git index and left the real index unchanged. Automatic LSP recovery
screenshots were inspected and all traced fixture children were reaped.

Historical Goal recovery requires independently persisted ownership evidence for
the same Goal lifetime. Unknown ownership remains fail-closed. It preserves report
hashes, public state and transcript; it does not resume completed model work or
apply retention retroactively. See [LSP policy](native-lsp-feature.md) and
[historical Goal recovery](native-goal-legacy-reports.md) for exact boundaries.

Three GPT-6 Astra agents are preparing and reviewing the next independent slices
outside the live checkout: Session deletion with all independent background
owners, and native MCP resource catalog/read tools. These drafts are not accepted
product behavior. The deletion audit includes delayed callbacks, side questions
and durable Memory jobs when a deleted Session ID is reused.

## Native reconnect, Goal plan progress, LSP and project bootstrap

Scoped acceptance and complete local repository gates passed on the final
coordinated source. The next section retains the preceding historical checkpoint.

| Capability | Apexo CLI / rebuilt Desktop backend | Production browser / actual native window | Installed Grok 1.0.52 reference |
| --- | --- | --- | --- |
| Native MCP automatic stdio reconnect | Nine checks/nine provider requests each | Twelve checks each across en/zh/zht, including real child failure/recovery without a management POST and successful project bootstrap | Six checks/four requests; bounded reconnect exhaustion observed; catalog notifications did not trigger relisting |
| Immutable Goal plan progress | Three scenarios/33 provider requests each; 180 focused/lifecycle tests with one existing skip and 1,104 assertions | Fifteen checks each across en/zh/zht, original-plan/report hashes preserved; actual mini/fullscreen ten checks each and compact/expanded native action panels nine each | Four checks/14 requests, original baseline and advisory changes preserved |
| Native LSP and Plugins activation | Twelve scenarios/14 provider requests each against real clangd; Plugins regression thirteen scenarios/three requests each; 16 focused tests/147 assertions | Six checks each across en/zh/zht, passive reads and child-loss status invalidation | All six LSP operations/13 requests, with the release's explicit LSP feature flag |
| Native project bootstrap | Four checks/zero provider requests each, including restart persistence; three Core/HTTP tests/28 assertions | Included in the final Goal and MCP checks: both project reads succeed and no workspace reload error appears | Apexo architecture repair; no claim of an equivalent Grok project API |

The LSP screenshots predate the project-bootstrap repair and retain the old
unrelated toast; final Goal/MCP screenshots independently verify the repair.
Final native Chinese Goal progress and MCP status screenshots were visually
inspected. All feature orchestration remains Apexo-owned.

App and final Desktop builds passed. All 21 repository typecheck tasks passed.
The complete HTTP gate passed 283 scenarios in each of coverage, authorization
and Effect-handler modes, with zero failures, skips, missing routes or extras
and successful process exit. Client generated outputs match the candidate in an isolated Git index, leaving
the real index unchanged. Committed CI and cross-platform acceptance remain.
The first complete unit run had 3934 passes, 19 skips, one todo and one failure
in the Session processor retry-status test. Its root cause is unresolved:
focused, whole-file and twenty repeated runs passed without a causal fix.
Failure-only diagnostics were added without weakening assertions. The final
complete run passed 3939 tests, with 19 skips, one todo, zero failures, 53 snapshots
and 12794 assertions across 329 files; all six Turbo tasks passed and the process
exited successfully. The unit process took 764.94 seconds; no speedup is claimed.
This passing rerun does not resolve the prior unexplained symptom. See
[BUG-20261014-277](testing/runtime/processor-retry-status-unexplained-stop.md).

The isolated composer sample on the same fixed packaged compatibility backend
changed from median 114 ms / p95 125 ms to 111.5/117 ms after this App change.
Both discard the first two of ten samples. This small sample shows no material
observed regression; it establishes neither a causal speedup nor model latency.

At that checkpoint, native Session deletion, LSP restart/shutdown policy and
historical Goal cleanup were drafts. The newer section above supersedes their
status; this section retains historical test evidence.

## MCP controls, Goal role preflight and remaining Plugins translations

Scoped acceptance and the complete local repository gates passed.
Runtime MCP connect/disconnect/retry passed nine CLI and nine rebuilt Desktop
checks with nine provider requests per backend. The installed reference passed
five checks/four requests and confirmed that its toggles persist across restarts;
Apexo currently labels its controls as runtime-only. Production browser and actual
native window each passed ten native manager checks across en/zh/zht. Compact and
expanded native terminal panels passed seven each; actual compatibility mini and
fullscreen passed four each. OAuth, persistent preferences and other MCP gaps remain.

Native Goal now selects a configured model/agent pair atomically and checks real
model/tool capabilities before creating a child. The six-file focused gate passed
104 tests/713 assertions; CLI and rebuilt Desktop each passed six end-to-end
scenarios/84 provider requests. Three installed-reference scenarios passed with
19 requests each. Reference planning intentionally retains the parent model;
Apexo honors its configured planner pair through native child Sessions. This
adaptation is explicit in [the role-selection contract](native-goal-role-selection.md).

Plugins activation copy now covers the remaining 54 locales (594 values), with
static audit and App types passed. Production browser and actual native window
each passed 62 checks. Punjabi direction matches the Gurmukhi Plugins dictionary;
pre-existing mixed-script general-settings copy remains outside this slice.
See [locale review](plugins-activation-localization-review.md) and
[MCP UI acceptance](mcp-management-acceptance.md) for exact coverage and limits.

The isolated production composer sample changed from 112 ms median / 120 ms p95
to 114/123 ms after the App change. Both samples used the same packaged
compatibility backend and measured reload to the first visible composer frame,
discarding the first two of ten samples. This small local sample does not measure
provider latency or establish a causal performance change.

The complete unit gate passed 3920 tests with 19 skips, one todo, zero failures,
53 snapshots and 12584 assertions across 325 files; all six Turbo tasks passed.
The unit process took 713.64 seconds. Subsequent serialized typechecking passed
all 21 tasks. The complete HTTP gate passed all 280 scenarios in each of coverage,
authorization and Effect-handler modes, with zero failures, skips, missing routes
or extras and successful process shutdown. Client generation is consistent
against the proposed outputs in an isolated index; committed CI and cross-platform
acceptance remain required. The following section retains the preceding checkpoint.

## Goal summary, native MCP and Plugins locale integration

The current batch implements once-only native Goal closing summaries, native MCP tool consumption, and complete Plugins dictionaries for fo/dv/tk/am/dz with RTL identifier isolation. Goal CLI and rebuilt Desktop passed ten scenarios/80 provider requests each, and the installed reference passed two comparisons. Production browser and actual native window each passed eleven Goal summary checks; both native terminal panel sizes passed seven, and compatibility mini/fullscreen passed eight each.

Native MCP CLI and rebuilt Desktop each passed eight checks/seven provider requests, with three installed-reference comparisons/four requests. The five localized storefronts passed thirteen browser and thirteen actual native-window checks; both native Plugins terminal sizes passed six. MCP manager controls, OAuth, resources and native management UI remain outside this completed slice.

The final complete unit gate passed 3906 tests with 19 skips, one todo, zero failures, 53 snapshots and 12477 assertions across 324 files; all six Turbo tasks passed. The unit process took 709.02 seconds; no causal speedup claim is made. The subsequent serialized typecheck passed all 21 tasks. Final rebuilt Desktop summary and MCP checks also passed after the native/legacy MCP identity correction.

The final identity-corrected HTTP gate passed all 277 scenarios in each of coverage, authorization and Effect-handler modes, with zero failures, skips, missing routes or extras and successful process shutdown. Client generation was verified against the proposed outputs in an isolated index; the ordinary committed CI gate and cross-platform acceptance remain open. See [Goal summary](native-goal-summary.md), [native MCP](native-mcp-runtime.md) and [locale review](plugins-localization-review.md) for evidence limits.


## Native strategy and Plugins checkpoint

The common App/Desktop build passed with native Goal strategy, native Plugins activation and the CORS fix. Strategy passed six CLI and six packaged-Desktop scenarios/71 provider requests each, two installed-reference comparisons/37 requests, 68 state/files tests/455 assertions, seven native/report regressions/99 assertions and 42 configuration flag tests/172 assertions.

Native Plugins passed 13 CLI and 13 packaged-Desktop scenarios/three requests each, ten installed-reference lifecycle comparisons, ten runtime/guard/compatibility tests/47 assertions, eight native-browser and eight actual macOS window checks, and six checks in each native terminal-panel size. Compatibility mini/fullscreen passed eight each and production browser passed 24. The native windows included both Chinese locales and failure recovery. The narrow native terminal harness does not establish native-only terminal startup. Native MCP/LSP consumers remain unimplemented and are reported explicitly; installation is separate from activation.

All 21 repository typecheck tasks passed. Client regeneration is consistent against an isolated index containing the proposed generated files. The complete HTTP gate passed all 276 scenarios in each of coverage, authorization and Effect-handler modes, with zero failures, skips, missing routes or extras; prior whole-unit results below remain historical. The next batch targets a once-only Goal closing summary, native MCP and five unfinished Plugins locale bodies. All feature execution remains Apexo-owned.

## Native context and checkpoint follow-up

- Workflow `await_user` persists a null receipt and paused state atomically, stops evaluation before later work, and resumes from the receipt only on explicit resume. Live ownership prevents early resume during teardown. Nineteen focused tests/84 assertions, five first-party Rust tests, CLI/Desktop four scenarios/one provider call each, and official three comparisons/two calls passed.
- Hooks deduplication passed 26 related tests/135 assertions, CLI/Desktop four scenarios each and 20 official comparisons. Installed 1.0.52 retains duplicates whose environment/timeout differ; the pinned source and Apexo use raw event/content/matcher identity excluding those settings.
- Native Memory automatic context passed 88 focused/related tests/190 assertions, Core/Apexo typechecks, CLI/Desktop seven scenarios/twelve provider calls each, and five official context comparisons. Native context uses durable withdrawal/replacement updates; prior baseline text is replaced at compaction, not silently erased. See [native context details](memory-native-context-plan.md).
- The isolated Workflow composer measurement was 110.5 ms median / 120 ms p95 against the immediately preceding 110/118 ms baseline. No meaningful observed regression; no causal speedup claim.
- Native-only Goal protocol/model/agent bootstrap fixes passed seven production-browser checks and seven actual native macOS window checks.
- Native Feedback management now uses Apexo Core storage through native Protocol/Server routes. Three native-only tests/38 assertions, CLI eight scenarios/six provider requests, twelve native-browser actions, twelve compatibility-browser actions, and three fresh official comparisons/ten requests passed. The rebuilt Desktop backend passed the same eight scenarios/six provider requests; the actual native macOS window passed twelve checks.
- Native wait passed four CLI/Desktop scenarios with one provider request per runtime. Manual compaction passed five CLI/Desktop scenarios/four requests each, 16 native integration tests/159 assertions and three installed-reference comparisons. Hook snapshot management passed nine CLI/Desktop scenarios each, 35 focused tests/105 assertions, and 22 installed comparisons. The native Hook window passed eight checks, including both Chinese locales; both terminal modes passed seven checks each.
- Fixed a shared Location-map lifetime defect that aborted later project requests before provider execution. The dedicated sequential-project HTTP regression, six provider HTTP scenarios and Apexo typecheck passed. The complete HTTP gate subsequently passed 271 scenarios in each mode. Native windows exposed a fixture connection-registration omission and a real CORS preflight gap; the CORS fix passed seven focused tests/26 assertions and Server typecheck, and actual native windows subsequently passed Goal seven, Feedback twelve and Hooks eight checks. The complete HTTP checkpoint predates that CORS addition.

The full 3835-pass unit, 21-task type and 263-case HTTP gates below apply to the preceding frozen checkpoint. Subsequent native context, deduplication and control changes require fresh complete gates before release.

## First-party Workflow, side questions, and Hook checkpoint

All feature execution remains Apexo-owned. No vendored Grok orchestration package remains. The generic Rhai interpreter only evaluates bounded scripts and exchanges host calls; native child Sessions, permissions, quotas, journals, interruption and recovery stay in Core.

- Native Workflow: dedicated native hosts, source discovery/validation and parent association passed five compatibility-bridge checks on CLI and rebuilt Desktop. Lifecycle/ownership passed six scenarios/12 provider calls on both. Latest guarded interruption and paused-run cancellation passed 14 focused tests/61 assertions and CLI seven scenarios/12 calls; mini and fullscreen managers passed ten actions each. Latest packaged Desktop passed the same seven lifecycle scenarios/12 calls and five bridge checks/two calls. Production browser and native Electron each passed 11 actions. The native test wrapper needed its real Desktop application path so interpreter discovery matched a normal launch; this fixture correction is BUG122. Official comparison remains two checks/two provider calls, with native HTTP one test/nine assertions.
- Independent side questions: CLI and Desktop six backend cases each, native V2 one test/13 assertions, mini eight actions, fullscreen nine actions, official three comparisons including images, and final production browser/native Electron nine actions each. Final isolated composer median 110 ms/p95 118 ms versus 113.5/124 ms shows no observed regression. A concurrent sample is retained as non-comparable.
- Hooks: lifecycle eight CLI/Desktop cases, Stop five cases on each of the V1 and V2 runners per backend, plus alias/permission/notification/cancellation six cases on each runner per backend. Environment expansion passed 18 focused tests/52 assertions, CLI/Desktop four cases each and 15 official comparisons. HTTPS/address/CA changes passed 21 focused tests/107 assertions, CLI five cases and 18 official comparisons; latest rebuilt Desktop passed the same five cases; the expanded related suite passed 107 tests/256 assertions. Installed Grok 1.0.52 allows cleartext loopback HTTP, unlike the pinned source and Apexo's HTTPS-only behavior.
- Shared gates: all 263 scenarios passed in each of coverage, authorization and Effect-handler modes, with zero skips, missing routes or extras. The cold-Location model race was reproduced with valid configuration and fixed at service publication; seven native regression tests/104 assertions and Core/Apexo typechecks passed. Latest whole-repository typecheck passed all 21 tasks on the frozen source. Migration generation is consistent. Client generation passed against an isolated index containing the proposed outputs; the ordinary committed CI gate is still required. The frozen-source complete unit rerun passed 3835 tests, with 19 skips, one todo, zero failures and 11990 assertions across 308 files; all six Turbo tasks passed. The unit process took 1171.15 seconds. This supersedes the earlier 3814-pass/three-failure checkpoint; skips, todo and cross-platform requirements remain open. No full-suite speedup is claimed.
- Distribution: CLI builds stage the first-party interpreter beside the executable; Desktop places it outside the application archive and supplies its absolute path. Local macOS arm64 launch/evaluation passed. The eight-target release matrix is configured and syntax-checked, but remote Windows/Linux/macOS matrix execution has not been claimed.

## Current product boundary and checkpoint

The user clarified that this task ports missing capabilities into Apexo, using Apexo's own Sessions, permissions, tools, storage, CLI and Desktop. Grok Build is a comparison reference. Embedding its runtime, vendoring its orchestration engine, or building a Desktop adapter for official sessions is not a deliverable. The attempted upstream Workflow engine package was removed; its 62 upstream/adapter tests are withdrawn as Apexo implementation evidence.

The current complete scope is maintained in [the feature gap document](grok-build-feature-gap.md). Historical records below retain their original checkpoints and must not override this boundary or the newer feature status.

Latest verified checkpoint: feedback backend CLI/Desktop eight scenarios each, native V2 two tests/19 assertions, official three cases; native Electron and production browser feedback 12 actions each, mini/fullscreen 11 actions each. Profile selection and exact effective CLI/Desktop contracts passed. Native Goal CLI/Desktop five scenarios/37 provider calls each and official three comparisons passed. Hooks now has eight local CLI/Desktop lifecycle scenarios, with precise official boundaries in its feature document. Full HTTP API coverage/auth/effect each passed 247 cases; prior whole-repository typecheck passed 21 tasks. This is not a final full-suite gate for subsequent Workflow, side-question and Stop-hook work.

The final isolated feedback composer benchmark was 113.5 ms median and 124 ms p95 against 126.5/140 ms before the change; no regression was observed in this measurement. The failed concurrent sample remains documented. First-party Workflow, `/btw`, and durable Stop-hook continuation are now in progress.

目标：实现 `grok-build-feature-gap.md` 的完整内容；每项完成后分别验证 CLI、Desktop、官方 Grok Build。未验证、官方版本差异及跨平台缺口不得记为完成。

起点：`grok-agent-roadmap` / `3ac6623`。官方源码基线 `2bdd1d6`，已安装官方 CLI 1.0.52。用户后续已将 Marketplace 纳入范围，产品名称改为 Plugins；以下状态表与末尾分项记录反映当前进展，历史段落中的暂缓描述不再适用。

| 项目                                                            | 实现状态   | CLI  | Desktop      | 官方 Grok Build |
| --------------------------------------------------------------- | ---------- | ---- | ------------ | --------------- |
| 后台 Shell 完成/失败通知及会话唤醒                              | 已实现     | 通过 | 打包后端通过 | 通过            |
| Monitor 逐行事件、唤醒、限流及超量停止                          | 已实现 | stdout/stderr 通过 | stdout/stderr 打包后端通过 | stdout/stderr 通过 |
| 前台 Shell 执行中转后台                                        | 已实现，指定场景通过 | 服务 6 场景、按键组件通过；完整终端待验 | 打包后端 6 场景、生产浏览器 3 操作通过；原生窗口待验 | 显式转后台、单次完成通知及 Unicode 输出通过 |
| Shell defaults, host wait settings, lifetime and task-output caps | Wait settings implemented; broader lifetime/contracts remain | Nine host-setting scenarios passed | Nine packaged-backend scenarios passed | Three installed-runtime cases and 19 pinned-source tests passed |
| Scheduler 调度相位、任务上限、入口及持久恢复                    | 已实现，macOS 验收通过 | 行为及真实重启通过 | 打包后端行为及真实重启通过 | 相位/间隔/自动回传及真实重启通过 |
| Memory 全局/仓库作用域与跨 worktree 共享                        | 已实现，指定 macOS 场景通过 | 13 场景通过 | 打包后端 13 场景通过 | Memory V2 列表及 7 次读取通过；存储源码 94 项通过 |
| Memory 全文检索、按行读取、持久索引及 watcher | 已实现，指定 macOS 场景通过 | 29 场景通过 | 打包后端 29 场景通过 | V2 文件工具检索对照通过；Memory 源码 477 项通过 |
| Memory 自动会话元数据检查点 | 已实现，指定场景通过；触发时机差异单列 | 12 场景通过 | 打包后端 12 场景通过 | legacy hooks 源码 15 项通过；安装版 V2 文件工具回归通过 |
| Memory 压缩前/阈值/空闲自动 flush | 已实现，指定场景通过；版本和阈值差异单列 | 14 场景通过 | 打包后端 14 场景通过 | legacy 策略 19 项、窗口 4 项源码测试；安装版 V2 barrier 通过 |
| Memory 模型 dream、自动整理门槛及并发/取消保护 | 已实现，指定场景通过；legacy/V2 边界单列 | 20 场景通过 | 生产打包后端 20 场景通过 | 相关源码 83 项；安装版 V2 提取观察并整理成主题通过 |
| Memory 首次及压缩后相关检索注入 | 已实现，指定场景通过 | 20 场景通过 | 最终打包后端 20 场景通过 | 安装版 V2 五项上下文对照；源码 16 项通过 |
| Memory CLI 清理、缓存/索引刷新及旧自动任务作废 | 已实现，指定 macOS 场景通过 | 非 Git 19、Git 21 场景通过 | 外部 CLI 清理作用于最终打包后端：非 Git 19、Git 21 场景通过；尚无 GUI 清理入口 | 安装版 9 项检查；存储源码 5 项通过 |
| Memory V2 observations/topics, legacy ranking and optional vectors | V2 capture/Dream/management and legacy ranking implemented within documented scope; native Context Source, complete recovery and semantic/vector retrieval remain | Capture/context/Dream evidence below; five ranking calls passed | Packaged capture/context/Dream and native management evidence below; five ranking calls passed | Source and installed V2 evidence below; 46 legacy search/MMR tests passed |
| Memory 分组浏览、过滤、预览及单项删除 | 已实现，上一阶段指定场景通过 | API 20、mini/fullscreen PTY 各 8 场景 | 打包后端 API 20、生产浏览器 9 场景；原生窗口待验 | 安装版管理 8 项对照通过 |
| Memory 会话启停及进程/配置优先级 | 已实现，指定 macOS 场景通过 | API/模型请求 23 场景；mini/fullscreen PTY 各 12 场景 | 最终打包后端 22、生产浏览器 15 场景；原生窗口待验 | 安装版 11 项启停对照，另有 7 次文件读取 |
| Memory 保存前审阅与确认 | 已实现，指定 macOS 场景通过 | API 11、mini/fullscreen PTY 各 10 项 | 打包后端 11、生产浏览器 11 项；原生窗口待验 | 改写接口 4、终端审阅 5 项 |
| Memory 专用 flush/dream 进度、取消及结果 | 已实现，状态仅进程内保存 | API 24、生产浏览器 12、mini/fullscreen PTY 各 10 项 | 打包后端 24、生产浏览器 12 项；原生窗口待验 | 安装版结果与通知 7 项；存储模型仍有差异 |
| Goal lifecycle, budgets, execution and independent verification | Compatibility and native V2 execution, reports, atomic cleanup and retention implemented; strategy/harness roles and final acceptance remain | 11 storage/crash, seven lifecycle and two retention checks passed | Same packaged-backend coverage passed; previous native report checks passed with unresolved performance investigation | Three execution/workspace checks and five source terminal-transition tests passed |
| Workflow / Deep Research | First-party Apexo implementation in progress     | 待验 | 待验         | 待验            |
| 操作系统级 sandbox                                              | 待实现     | 待验 | 待验         | 待验            |
| Host Hooks configuration, execution and lifecycle | Command/HTTP discovery, decisions and lifecycle observers implemented; Stop/native/management remain | Eight current scenarios passed | Eight current scenarios passed | Installed comparison passed; exact scope in Hooks document |
| Image editing and shared media commands | Implemented within the documented protocol scope | Latest seven-scenario run passed | Latest rebuilt seven-scenario run passed | Four installed-tool comparisons and eight pager command tests passed; ACP does not advertise pager commands |
| S3/ZDR video storage | Explicit S3 PUT/GET configuration implemented; team policy requires auth claims unavailable in the current transport | Latest signing/upload/read fixtures passed | Latest rebuilt fixtures passed | Pinned-source contracts compared; official transient signing fallback is not reachable with the static signer; production acceptance remains |
| 统一后台任务面板及运行状态                                      | 已实现，指定场景通过 | mini/全屏真实 PTY；四类型 API/浏览器通过 | V2 生产浏览器接打包后端四类型通过；原生窗口待验 | Shell 列表、隔离、客户端取消及进程退出通过；完整界面待验 |
| 任务 ID 上限、规范化、宽松解析及 host 等待上限                   | 已实现，指定场景通过 | 21 场景通过 | 打包后端 21 场景通过 | 安装版 get_task_output 13 场景；源码工具类型 107 项、任务输出 91 项通过 |
| `/btw` 独立旁路问答与结果面板                                  | 待实现     | 待验 | 待验         | 官方命令文档已核对 |
| Local feedback drafts and review | Native/compatibility backends and App/TUI review implemented | Eight backend cases and both terminal modes passed | Eight backend cases, 12 native and 12 browser actions passed | Three installed draft cases and ten pinned source tests passed |
| Plugins 商城发现、下载、安装、更新及生命周期 | 已实现，完整 Hooks/策略和部分翻译另列 | API/命令 15、生产浏览器 24、mini/fullscreen PTY 各 8 项 | 打包后端 13、生产浏览器 24、原生窗口 8 项 | 安装生命周期 10 项；真实推荐源读取及下载通过 |
| Desktop tool-profile selection | Persisted next-launch preference and active profile implemented | CLI manifest/provider contract comparison passed | Preference tests and native settings/relaunch acceptance passed | Tool-contract reference only; official runtime integration is outside scope |
| V2 runtime 工具迁移及生命周期一致性                             | 待实现     | 待验 | 待验         | 待验            |
| 会话/dashboard、usage/trace、slash 命令、企业配置逐项验收       | 待审计补齐 | 待验 | 待验         | 待验            |
| Windows/Linux、完整 Desktop E2E、官方完整 CLI/TUI 源码构建      | 待验收     | 待验 | 待验         | 局部工具源码测试通过；完整 CLI/TUI 构建待验 |

## 验收规则

- 使用真实会话和工具实现，模型/上游 fixture 只能证明协议和本地执行，另列真实官方/媒体调用证据。
- Desktop 打包后端测试与完整窗口交互测试分别记录，不能互相代替。
- 保留原功能差距文档中的边界：官方不支持的跨进程 Workflow 续跑和不可用的 app-builder stub 不伪装成现有官方功能。
- 完成每项后在此记录命令、产物路径、实际断言和剩余限制；最终逐条复核全清单，再执行 CI 同款检查。

## 执行记录

- 2026-10-13：核对当前分支与完整差距清单；开始实现后台 Shell 结果送达父会话，覆盖后台启动、有限等待超时和前台完成不重复通知。

### 后台 Shell 通知

- 实现：`Tool.Context.watchBackground` 接入共享会话执行层；立即后台和有限等待超时均监听完成，前台完成不重复通知；结果带截断输出及退出码，非零退出标为失败，取消不触发完成通知。
- 集成测试：`bun test test/session/prompt.test.ts --test-name-pattern 'background shell wakes'`，3 通过，覆盖真正空闲后的成功/失败唤醒。adapter 专项共 19 通过，包含前台/后台通知选择。`bun typecheck` 通过。
- CLI：`bun script/grok-parity.mjs cli`，22 步通过，断言 provider 请求确实收到 Shell 通知。证据目录 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-cli-XUv4Pk`。
- Desktop：重新构建后通过同一 22 步，另运行文件闸门控制的空闲唤醒场景，断言只有一个自动续轮。证据目录 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-desktop-FXjjo3`，含 `background-history.json`。这是 Electron 打包后端验证，完整窗口 E2E 仍在总清单中。
- 官方：`bun script/grok-background-official.mjs`，1 个后台 Shell 调用，不使用等待/输出查询；收到 `task_completed`、以 `task-completed-` 开头的自动轮次和 `OFFICIAL_BACKGROUND_OBSERVED`。证据目录 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-background-official-TkK05g`。
- 官方测试修正：自动续轮走 ACP `_x.ai/session_notification`，任务完成走 `_x.ai/task_completed`；通知只保证退出状态，不附 stdout。脚本按实际协议断言，且只保存必要事件字段，排除无关私有配置。

### Monitor 与最新工作区复核

- 已实现 stdout 分行、部分行缓存、Unicode 截断、200ms 合批、令牌桶限流及持续超量停止；空闲会话收到事件后自动续轮。停止会话暂停通知，真实用户消息恢复；取消 Monitor 不产生完成唤醒。
- 最新会话专项 4 通过，包含后台 Shell 成功/失败和 Monitor 运行中唤醒、停止/恢复；Shell、Monitor、扩展工具专项 40 通过。日志 `/tmp/apexo-monitor-stdout.log`、`/tmp/apexo-monitor-final-tools.log`。Apexo `bun typecheck` 通过，日志 `/tmp/apexo-monitor-current-typecheck.log`。
- CLI 最新受限场景 22 步通过，证据目录 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-cli-5GBiIS`。
- Desktop 最新生产构建通过；受限场景 22 步及独立 Shell/Monitor 空闲唤醒均通过，证据目录 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-desktop-HE2QtX`。仍是打包后端，不能代替窗口 E2E。
- 官方 Monitor 通过：`bun script/grok-background-official.mjs monitor`，只调用一次 Monitor，stdout 事件自动触发后续回复，证据目录 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-background-official-b1rNkM`。
- **未完成项**：官方实际合并 stdout/stderr 后产生事件，我们最新实现只观察 stdout；当前测试甚至断言 stderr 不通知，需同步修正实现和断言，并增加三端 stderr 场景。证据：官方 `20-background-tasks.md` 的 Monitor 说明、`computer/local/terminal.rs` 的合并输出，以及本地 `shell.ts` 的 `ctx.onStdout` 分支。
- **新增缺项**：官方前台 Shell 支持执行中转后台；本地 `session.background` 仅对 Subagent 启用，需单独实施和验收。

### Monitor stderr 修正验收

- 复核问题已修正：共享 Shell 使用合并输出流 `onOutput`，stdout/stderr 均产生 Monitor 事件；完整行、最终部分行、限流、过载中止及会话停止/恢复规则统一处理。
- 真正 stderr 子进程的会话专项 4 通过；Shell/Monitor/扩展专项 40 通过；Apexo typecheck 通过。日志 `/tmp/apexo-monitor-merged-session.log`、`/tmp/apexo-monitor-merged-tools.log`、`/tmp/apexo-monitor-merged-typecheck.log`。
- CLI 22 步受限回归通过（Monitor 只输出 stderr）：`/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-cli-otdTay`。
- Desktop 重新生产构建后，同一回归及 Shell/stdout Monitor/stderr Monitor 三个独立空闲唤醒场景通过：`/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-desktop-FY7JUt`。
- 官方 `bun script/grok-background-official.mjs monitor-stderr` 通过：只有一次 Monitor 调用，stderr 事件自动唤醒，没有额外轮询；`/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-background-official-eifqtG`。前述 stdout 场景证据仍有效。

### Scheduler 行为与入口（持久化仍待实施）

- 新增共享 Core 调度引擎，按 workspace 的 registry 维护一份实例，所有模型轮次复用；计时器由 BackgroundJob 生命周期管理。
- 修改提示词不重置下次触发、创建时间和七天过期时间；修改间隔从创建/上次触发锚点计算。缩短到已过去的时间时，从当前时间再等待一次新间隔；更新不会取消正在执行的旧一轮。`fire_immediately`/`durable` 是创建选项，修改时忽略。
- 并发创建时原子检查每个会话最多 50 个活动任务；取消释放名额，其他会话仍有独立额度。单轮失败回传后继续后续周期，取消不会自动重启。
- 每轮子任务的成功/失败结果自动送达父会话，并可唤醒空闲父会话；停止会话后遵守已有通知抑制规则。
- 共享 `/loop` 入口负责解释间隔与自包含提示词；缺参数时先询问；正常创建 `fire_immediately=true` 的重复调度。短正数间隔自动提升至 60 秒，零值拒绝；大于七天的间隔会在生命周期结束时过期，不偷偷触发。时间戳限制为 JavaScript Date 可表示范围。
- Core 引擎 TestClock 覆盖保持相位、正在运行时修改、同时创建 51 个任务、跨会话越权、取消释放、已完成任务不可修改、单轮失败后恢复。工具测试覆盖最终期限、间隔提升和超过期限过期。
- 本批完整受影响回归：135 通过、1 既有跳过、0 失败，日志 `/tmp/apexo-background-scheduler-regression.log`。随后间隔边界改动的 Scheduler/扩展回归 20 通过，日志 `/tmp/apexo-scheduler-interval-tests.log`。Apexo 和 Core 最终 typecheck 均通过。
- CLI：最终 26 步受限场景通过，含 `1s` 自动提升、提示词更新不改变下次时间、间隔更新保持锚点、每轮结果回传和 `loop` 命令注册。证据目录 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-cli-zSxhhN`。
- Desktop：最终生产构建的同一 26 步通过，另覆盖 Shell/stdout Monitor/stderr Monitor/Scheduler 四个空闲唤醒场景；Scheduler 场景实际走共享 `/loop` command endpoint。证据目录 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-desktop-aaeVQG`。窗口 E2E 仍待补齐。
- 官方相位：`bun script/grok-scheduler-official.mjs` 执行创建、列表、改提示词、列表、改间隔、列表、删除、列表共 8 次调用；从真实 `SchedulerList` 输出验证相位和创建锚点，最后列表为空。证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-scheduler-official-jJC5kg`；可用同脚本 `--verify <updates.json>` 离线复核。
- 官方最小间隔：同脚本 `--short`，4 次调用确认 `1s` 被提升为 60 秒且测试任务已删除。证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-scheduler-official-7B7cEd`。
- 官方自动回传：`bun script/grok-background-official.mjs scheduler` 真实等待一分钟后收到子任务结果、自动唤醒，随后删除任务；断言只有创建/删除两次工具调用。证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-background-official-K1sJRh`。首次无显式删除方案被审批拒绝，已改为正常及异常路径都执行清理后通过。
- 官方 50 任务限制的源码与本地并发测试已核对；本轮没有在官方客户端实际创建 51 个任务，不能把这一边界称为官方实测。完整交互 TUI `/loop` 尚需后续窗口/终端 E2E；当前验证的是注册和共享 command endpoint。

### Scheduler 持久化与恢复实施过程

- 当前未提交代码已新增 `scheduler-store.ts`，保存 schedule 和 Session/模型恢复信息，并接入会话/工作区初始化。具有存储和可恢复上下文时开始接受 `durable=true`；因此旧基线中的“始终拒绝 durable”已不适用于当前工作区。
- 已编写进程归属锁、原子写入、触发前落盘、取消删除和恢复时重建权限的逻辑；这些代码仍在验证，不能仅凭存在实现文件宣布完成。
- 最新 Scheduler/BackgroundJob 相关测试 18 通过、4 失败（`/tmp/apexo-durable-core-tests.log`）。4 个持久化测试因缺少 `effect/process/ChildProcessSpawner` 服务失败；这是测试依赖问题，既不能解释成已证实的 4 个业务缺陷，也不能跳过后宣称恢复正确。另有接入与既有行为回归 31 通过（`/tmp/apexo-durable-wiring-tests.log`）。
- 持久写入、删除、到期及每次触发的状态需要一致；恢复必须避免重复触发或复活已删除任务，并保留原过期时间。
- CLI 与 Desktop 均需进程关闭/重启后的真实恢复测试；官方按安装版本核对可恢复范围。完整 feature 清单继续有效，未完成项目不缩减。
- 本次用户询问剩余差距时，已按当前源码和上述日志更新状态；此前 26 步三端通过记录不覆盖这些持久恢复改动。

### Scheduler 持久化与恢复验收完成（macOS）

- 已修正持久化测试的进程服务依赖和临时目录参数。7 项持久化专项通过：创建/修改/删除后重开、执行中断不重放、过期/孤立任务清理、并发进程互斥、写入失败、普通非 durable 计划恢复、损坏文件保留，以及真实锁持有进程崩溃后的回收。活进程即使心跳过期也不会被抢占。
- 恢复时重新读取当前会话和 agent 权限，使用保存的模型信息构造执行上下文。触发前记录执行已开始；崩溃中断的一轮不会自动重放，未来周期继续。关闭实例保留计划；显式取消先持久删除，再停止执行。损坏文件和锁冲突会通过 `scheduler_list` 报告，不能伪装成空列表。
- 新增取消中断回归，先复现删除等待期间调用方中断后任务仍显示 `running`，再将持久删除及状态取消作为不可中断操作修复。最后 Scheduler/BackgroundJob 专项 25 通过；受影响完整回归 **115 通过、1 既有跳过、0 失败**，日志 `/tmp/apexo-durable-cancel-regression.log`、`/tmp/apexo-durable-regression.log`。Apexo/Core typecheck 通过。
- CLI：`bun script/grok-scheduler-restart.mjs cli`，使用真实 CLI `serve` 进程和隔离本地模型 fixture。创建任务后 SIGKILL，第二个进程恢复并实际等待一分钟触发，验证执行/父会话唤醒各一次；删除后第三个进程确认没有复活。最终证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-scheduler-restart-cli-ixJnk2`。
- Desktop：重新生产构建后运行 `bun script/grok-scheduler-restart.mjs desktop`，直接启动 Electron 二进制内的打包后端，完成相同三进程断言。最终证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-scheduler-restart-desktop-8L2uKI`。测试曾只杀启动器而留下后端，现已修正并清理遗留进程；不能将那次锁拒绝接管判作产品故障。仍不代表完整窗口 E2E。
- 官方：`bun script/grok-scheduler-restart-official.mjs`，Grok CLI 1.0.52 经 Apexo ACP 代理创建 `durable=true` 计划，退出后通过 `loadSession` 恢复，确认 ID/创建时间/下次触发时间未变，实际收到定时子任务结果；删除后第三个进程再次加载会话，列表为空。6 次实时工具完成事件、0 失败，正常与异常路径均有显式清理。证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-scheduler-restart-official-qyR1W0`。首轮回复标记跨 ACP 文本片段导致误判，聚合片段后重新完整跑通。
- 26 步受限权限工具回归再次通过：CLI `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-cli-PxrbEE`；Desktop `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-grok-parity-desktop-BJCfY2`，另含 Shell、stdout/stderr Monitor、Scheduler 四个独立空闲唤醒。这组运行早于最后取消原子性修复，该修复后另外重跑了上述 115 项回归及两端三进程测试。
- HTTP API `bun run test:httpapi` 的 coverage/auth/effect 各 **204 通过、0 失败、0 跳过、0 缺项**，日志 `/tmp/apexo-durable-httpapi.log`。本批未改变公开 Protocol/HttpApi 契约，无须重生成 Client。
- 范围限制：本机 macOS、CLI 服务入口、Electron 打包后端、已安装官方二进制；Windows/Linux、完整 CLI/Desktop 交互和官方 Rust 源码构建仍在总清单中。恢复需要应用重新打开该工作区；应用关闭时不会由独立系统守护进程执行任务。不声称透明恢复崩溃中断的模型请求。

### 前台 Shell 转后台实施中与最新差距复核

- 当前未提交实现：前台 Shell 纳入 BackgroundJob；显式 `session.background` 或真实用户新消息可以保留原命令并转后台；父会话中断只停止尚未转后台的命令；CLI `Ctrl+B` 和提示已接入。Desktop 可见入口未实现，本功能三端运行验收未完成。
- 已有测试日志复核：adapter **21 通过、0 失败**（`/tmp/apexo-shell-promotion-adapter.log`）；真实 Shell 的显式转后台/消息触发两个会话场景 **2 通过、0 失败**（`/tmp/apexo-shell-promotion-session.log`）；CLI footer/状态归约 **38 通过、5 既有跳过、0 失败**（`/tmp/apexo-shell-promotion-tui.log`）。Apexo typecheck 退出码 0。不能把这些专项记作完整 CLI/Desktop/官方 E2E。
- 本次发现三个仍需修正的源码差异：省略 `block_until_ms` 尚无官方新版默认 30 秒转后台；后台 Shell 仍使用共享 Shell 默认约 2 分钟生存期限，而官方后台默认上限为 10 小时；`get_task_output` 正数等待缺少官方默认 1 小时的上限。具体代码依据与版本边界已加入差距文档。尚未运行长时间三端验证。
- 2026-10-13 再次只读查询官方 `main`，仍为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`。本轮状态比较包含当前未提交代码，未重新执行全仓和三端回归，也不表示已发布。

### Shell 等待期限与转后台最新进展

- 已设置 `block_until_ms` 省略时默认 30 秒、Grok Shell 执行上限 10 小时、任务输出等待上限 1 小时。adapter **24 通过**（`/tmp/apexo-shell-lifetime-adapter.log`）；真实短超时相关 **3 通过**（`/tmp/apexo-shell-lifetime-real.log`）。测试时钟覆盖等待预算，真实子进程验证后台执行超出普通 Shell 的 100ms 测试超时；没有实际运行满 10 小时，也没有完成官方配置覆盖。
- CLI：`bun script/grok-shell-parity.mjs cli`，**6 场景通过**：显式转后台、新消息转后台、默认约 30 秒转后台、立即后台、有限等待后后台、停止前台。保留原 PID/工具调用 ID，命令只执行一次，完成只唤醒一次。证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-EKxddE`。
- Desktop：重新构建的 Electron 打包后端通过相同 **6 场景**；默认等待实测约 29974ms。证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-desktop-QTj4Jb`。这项不是完整窗口 E2E，后续输入框改动还需进入最终 Desktop 构建验收。
- 官方：`bun script/grok-shell-official.mjs`，通过 ACP `_x.ai/terminal/background` 将运行中的命令转后台；原 PID 保留，1 次工具调用、1 次完成通知，完成后自动回复。证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-official-iztYsw`。只覆盖安装版 1.0.52 的显式转后台，不扩展为新版 30 秒默认值或全部 6 场景通过。
- Desktop legacy/V2 输入框均已有“在后台运行”按钮及 `Ctrl+B` 代码，生产 App 构建通过。最新完整生产浏览器测试等待按钮出现超时（`/tmp/apexo-shell-ui-after.log`）；仍需定位事件接入或界面问题，**不记为通过**。此前单次按钮点击通过不足以替代稳定的按钮、快捷键和新消息全场景验收。
- 新增文案使用 `Run in background` / `在后台运行`。语料核对：[VS Code 简体中文语料](https://raw.githubusercontent.com/microsoft/vscode-loc/main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json)、[Mozilla 支持文档](https://support.mozilla.org/zh-CN/kb/Firefox%20%E5%B7%B2%E7%BB%8F%E5%9C%A8%E8%BF%90%E8%A1%8C%EF%BC%8C%E4%BD%86%E6%B2%A1%E6%9C%89%E5%93%8D%E5%BA%94)、[Apple 支持文档](https://support.apple.com/zh-cn/125671)。其他语言沿用现有英文回退，不声称已全部翻译。
- 最新 Shell/CLI 相关回归 **99 通过、5 既有跳过、1 失败**（`/tmp/apexo-shell-current-regression.log`）。失败项 `captures stderr in output` 返回 `(no output)`；单独重跑 1 通过（`/tmp/apexo-shell-stderr-check.log`），原因仍待修复。疑似进程退出与输出流排空顺序，不将推测写成已确认根因。之后还有 CLI attach 状态恢复代码变动，最终受影响套件需要重跑。
- 本次差距询问只复核了当前源码、现有日志和官方 `main` 版本，没有重新执行完整三端或全仓测试；未提交工作区不等于已发布版本。

### Shell 输出修复及生产界面验收完成（指定 macOS 场景）

- 修复正常退出丢输出：真实子进程配合有延迟的输出订阅者可稳定得到 `(no output)`；原因是 `exitCode` 完成时作用域关闭，输出消费 fiber 还未排空。现在正常退出后等待消费 fiber 完成，再关闭作用域。失败前日志 `/tmp/apexo-shell-drain-before.log`。
- 修复 Unicode 交错乱码：以文件闸门同步 stdout 半个 emoji、stderr 文本、stdout 剩余字节，旧代码稳定输出 `prefix�stderr_msg��`。现在分别解码两路 UTF-8 后再合并文本，Monitor 和会话输出共用该文本流。失败前日志 `/tmp/apexo-shell-unicode-before.log`；测试没有用任意等待猜测子进程准备时机。
- 最终 Shell/adapter/Monitor/扩展/CLI 状态与组件回归 **122 通过、5 既有跳过、0 失败**，日志 `/tmp/apexo-shell-final-unit.log`。中间一次媒体 fixture 因 sandbox 不允许监听本机端口而失败，改用允许本地端口的执行环境后全套通过。较早依赖回归 **112 通过、1 既有跳过**（`/tmp/apexo-shell-dependent-regression.log`）覆盖 Scheduler、持久化、BackgroundJob、会话唤醒；末尾 Unicode 改动之后又跑了上述 122 项和两端完整工具链。
- 最终 CLI 六场景全部通过：`/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-zgCrOG`。最终 Desktop 重新构建的六场景全部通过：`/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-desktop-YDx0RB`。增加断言父会话完成通知中的真实 stdout/stderr 含完整 emoji/中文且无替换字符。默认转后台分别约 29987ms、29992ms。
- 官方安装版通过同样的显式转后台、原 PID 不变、1 次工具调用和 1 次完成通知，并从真实工具输出核验 stdout emoji 与 stderr 中文。证据 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-official-htcxcD`，日志 `/tmp/apexo-shell-unicode-official.log`。该版本的验证范围仍不包括源码新版默认 30 秒契约。
- 新增可重复脚本 `bun script/grok-shell-ui.mjs cli|desktop`，使用生产 App renderer 及隔离真实后端，验证按钮、`Ctrl+B`、跟进消息“Send now”、原 PID 存活和完成唤醒。CLI 后端证据 `.../apexo-shell-cli-dAOGFA`；最新 Desktop 后端证据 `.../apexo-shell-desktop-CS4tJk`（完整父目录与上述证据相同），含每个操作前后截图及会话 JSON。已查看截图，按钮位于发送控件旁，未遮挡输入框。可通过 `CHROMIUM_PATH` 指定已安装浏览器，默认使用 Playwright 配置的 Chromium。
- UI 测试早期问题来自 fixture：连续重载和代理响应收尾使初始化/事件等待不可靠；跟进草稿还需选择“Send now”才会真正发送。保留独立基准和操作场景，换成正确关闭上游响应的 HTTP 代理，等待会话/agent 初始化并设置等待期限后通过。没有绕过界面直接调用转后台来代替按钮断言。当前测试的是 V2 生产浏览器界面，原生 Electron 窗口、legacy 输入框完整交互仍未冒充通过。
- 页面性能参考：原始修改前中位数 135.97ms / P95 271.36ms；最终空闲环境中位数 136.14ms / P95 188.83ms（`/tmp/apexo-shell-ui-before.json`、`/tmp/apexo-shell-ui-final-idle.json`）。期间修正了测试代理，因此这组前后数值不是严格可比的性能回归证明，也不代表 Desktop 整体启动性能。与重负载检查并行的测量曾升至 341.36ms / P95 1150.31ms，已保留记录而未作为最终空闲值。
- 最终 26 步受限权限工具链：CLI `.../apexo-grok-parity-cli-7ku4cZ`；Desktop `.../apexo-grok-parity-desktop-5eM1TA`，另含 Shell、stdout/stderr Monitor、Scheduler 四种空闲唤醒。Desktop 脚本须使用 `ELECTRON_RUN_AS_NODE=1 ../desktop/node_modules/.bin/electron script/grok-parity.mjs desktop restricted`；误用 Bun 会因 `node:sqlite` 不支持而在启动前失败，已改用正确运行时完整通过。
- Apexo、App、session-ui typecheck 通过，最新 Desktop 生产构建通过。HTTP API coverage/auth/effect 各 **204 通过、0 失败、0 跳过、0 缺项**（`/tmp/apexo-shell-httpapi.log`）。按要求执行 legacy SDK 生成脚本，仅产生转后台接口描述的 3 行更新；Client `check:generated` 通过。上述 HTTP API 检查早于最后内部 Unicode 修复，API 契约未再次变化；最后修复后 Apexo typecheck 重新通过。

继续项：统一任务面板、Memory 作用域/检索/界面及其他完整差距清单；Shell 官方 host 配置覆盖、10 小时长时边界及原生/跨平台完整验收仍保留。完整目标未完成，当前改动尚未提交或发布。

### 本次剩余差距复核（只读审计及文档更新）

- 官方 `main` 再次确认仍为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`。比较包含当前未提交改动；本次没有重新跑全套三端测试，沿用并核对上述已有验收日志。
- 补充此前漏列的反馈草稿：官方已注册 `send_feedback`，保存/更新本地会话草稿；`/feedback` 提供草稿审阅和提交。Apexo 当前只有 GitHub issue 外链，没有等价草稿工具和界面。它属于低优先级产品功能差距。
- 补充后台查询参数差异：官方共享上限为每次 20 个任务 ID，且规范化空白、去重；`get_task_output` 还接受字符串/数字 ID 的宽松输入。本地目前只校验非空字符串数组或兼容单个字符串 `task_id`，没有以上限额和规范化。正常任务生命周期已验证，不代表这些输入边界已等价。
- 差距文档顶部新增两项，并修正“Shell 最终改动后未重跑 26 步”的过时表述。完整实现目标仍未完成，Marketplace 继续暂缓。

### 统一任务管理入口完成（指定 macOS 场景）

当前工作区将 Shell、Monitor、Scheduler、Subagent 汇总到当前会话的任务入口，持续显示运行计数，查看实时输出，并独立停止指定任务。任务列表不需要模型调用；父会话空闲时仍刷新。服务端按父会话归属过滤，跨会话读取/取消返回 404；列表仅输出明确选取的展示字段，不暴露恢复上下文、模型配置或凭据。Scheduler 的 UI 停止复用持久取消路径。

- 共享接口：新增 `experimental.task.list/get/cancel` 和 Schema 中的摘要/详情类型，重新生成 legacy SDK 及 Client；未手改生成目录。新增端点认证、覆盖及 Effect 场景。
- CLI mini：`/tasks` 和命令面板入口，方向键选择、`c` 停止、Esc 返回。默认全屏 TUI 同样有 `/tasks`、持续计数、输出及 Ctrl+X 停止。两者使用同一后端任务 API。
- App/Desktop：legacy/V2 输入框都有任务按钮；V2 生产浏览器完成四类任务全流程。新增英文和简体中文文案，其他语言沿用既有英文回退。任务刷新保持行身份和选择状态，会话切换时取消旧请求，避免旧会话响应覆盖当前状态。
- 实际测试发现并修复了 `/tasks` 未进入 mini 自动补全、全屏停止键绑定字段错误和首次任务输出未加载；列表刷新时保持选择及焦点，避免每次轮询重建行。

本轮运行证据（路径父目录均为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`）：

| 端/场景 | 命令（从 `packages/apexo` 执行） | 结果与证据目录 |
| --- | --- | --- |
| CLI mini 实际终端 | `bun script/grok-tasks-tui.mjs` | 计数、`/tasks`、输出、取消、状态刷新通过；`apexo-shell-cli-zrHB3Q` |
| CLI 默认全屏实际终端 | `bun script/grok-tasks-tui.mjs --fullscreen` | 同类交互通过；`apexo-shell-cli-k0yxcW` |
| CLI 后端 + V2 生产浏览器 | `bun script/grok-shell-ui.mjs cli --tasks` | 四类型创建、列表、计数、实时输出、逐项停止、进程退出、会话隔离通过；`apexo-shell-cli-a5k3W4` |
| 最新 Desktop 打包后端 + V2 生产浏览器 | `bun script/grok-shell-ui.mjs desktop --tasks` | 相同四类型场景通过；`apexo-shell-desktop-O3Pz6W` |
| 官方 Grok 1.0.52 | `bun script/grok-shell-official.mjs --tasks` | Shell 转后台后的任务列表、跨会话隔离、客户端取消、真实 PID 退出通过；`apexo-shell-official-L2O9vg` |
| CLI 完整工具回归 | `bun script/grok-parity.mjs cli restricted` | 26 步及工具结果回传通过；`apexo-grok-parity-cli-FSaDrs` |
| Desktop 完整工具回归 | `ELECTRON_RUN_AS_NODE=1 ../desktop/node_modules/.bin/electron script/grok-parity.mjs desktop restricted` | 26 步及四类空闲唤醒通过；`apexo-grok-parity-desktop-CfOZ6C` |

浏览器脚本本次指定本机 Chromium 的 `CHROMIUM_PATH`，使用生产 renderer 和隔离后端；查看过任务面板截图，输出中的中文/emoji 正常。真实终端测试使用 Bun Terminal 的 PTY，不把组件渲染单测替代终端交互。上述官方专项通过 ACP 客户端操作，只证明所列 Shell 行为；其他官方任务类型和原生 TUI 的完整任务管理界面仍需逐项补验。Desktop 原生 Electron 窗口、legacy 输入框完整操作和 Windows/Linux 也仍未完成验收。

检查记录：

- 受影响的任务 API、CLI 组件/运行时、后台注册表及 Scheduler 持久化回归：**50 通过、5 既有跳过、0 失败、223 个断言**；`/tmp/apexo-task-final-tests.log`。
- HTTP API coverage/auth/effect：每组 **207 通过、0 失败、0 跳过、0 缺项**；`/tmp/apexo-task-httpapi.log`。
- 全仓 typecheck **21/21**；全屏 TUI 最后修改后再次 typecheck 通过；App、Apexo 检查、Client 生成检查和最终 Desktop 生产构建通过。日志分别为 `/tmp/apexo-task-all-typecheck.log`、`/tmp/apexo-task-tui-final-types.log`、`/tmp/apexo-task-final-app-types.log`、`/tmp/apexo-task-final-apexo-types.log`、`/tmp/apexo-task-generated.log`、`/tmp/apexo-task-desktop-final-build.log`。
- 页面性能样本：生产 renderer 空会话重载到输入框可见，修改前中位数 **136.18ms / P95 186.71ms**，修改后 **128.59ms / P95 275.80ms**。每轮 10 次，剔除前 2 次预热。中位数下降但尾部延迟升高，小样本不足以判定稳定回归或无回归，也不代表 Desktop 整体启动性能。原始记录保留在 `/tmp/apexo-task-ui-before.log`、`/tmp/apexo-task-ui-after.log`，后续性能验收仍需关注尾部。

最新差距复核再次确认官方 `main` 为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`。差距文档顶部已移除“统一任务面板未实现”的过时判断。Memory、Goal、Workflow、图片编辑、Sandbox/Hooks、任务参数兼容、Desktop profile 和反馈草稿仍有确认缺项；完整功能目标没有完成，当前改动尚未提交或发布。

### 任务查询参数与 host 等待配置

本轮先用真实 BackgroundJob 写出回归，修复前新增 7 项全部失败（`/tmp/apexo-task-contract-before.log`）。当前实现完成：

- `get_task_output` 接受 `task_id` 别名、单个字符串/数字及混合数组；空值变成空列表，拒绝布尔值、对象和嵌套数组。去空白、去空字符串、稳定去重后检查 20 个 ID 上限；同时传两种键明确报错。权限检查使用解析后的 ID，仍不暴露其他会话的输出。
- 模型看到的 schema 保持规范字符串数组，公布 1–20 个 ID 和实际等待上限；宽松输入仅由接收端兼容，不向模型宣传多种互相混淆的参数形式。
- 纠正此前文档误写：官方旧 `wait_tasks` 不规范化 ID，也不去重，按原始列表检查 20 个上限。`wait_all` 的零超时使用默认 30 秒；`wait_any` 等待运行中的任务后返回所有请求任务的快照，缺失 ID 不会抢先结束等待。Apexo 保留既有省略 mode 时按 wait_all 执行的兼容输入，但公布的 schema 要求显式 mode。
- `GROK_MAX_WAIT_BLOCK_MS` 接入 RuntimeFlags 和 canonical registry，同一数值用于工具说明、schema maximum 和实际等待。未配置/无效配置默认 3,600,000ms；零值允许立即返回。JavaScript 内部最多保留安全整数精度，超出 u64 的输入回退默认。Shell 的 `default_block_until_ms` / `max_block_until_ms` 等配置尚未在本轮实现。
- host 提高等待上限后可能超过平台有符号 32 位定时器范围；BackgroundJob 现分段等待，防止 Effect live clock 将长超时变成永不超时。回归记录每次实际请求的 sleep 时长，并用 TestClock 验证完整截止时间；这不是实际连续运行 25 天的验证。首次新增测试误用了 Effect 4 不存在的 `TestClock.sleeps`，已改为记录后转交真实 TestClock，最终测试与类型检查均通过。

验证：

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Apexo 参数、等待时钟、adapter/后台、RuntimeFlags 与 Scheduler 持久化 | 最后改动后 91 通过、0 失败、295 个断言 | `/tmp/apexo-task-contract-final-unit.log` |
| CLI 实际工具调用 | 最后改动后 21 场景通过；20/21 边界、去重、别名、非法输入、会话隔离、80ms host cap、Shell 存活及取消 | `apexo-shell-cli-fUe5qW` |
| 最新 Desktop 打包后端实际工具调用 | 最后改动后相同 21 场景通过 | `apexo-shell-desktop-5SrGch` |
| 官方 Grok 1.0.52 实际工具调用 | 13 个 get_task_output 边界通过，包括原始标量/数字输入、去重后限额、空输入、重复键、非法形状及 80ms cap | `apexo-task-contract-official-19jZyS` |
| 官方源码 xai-tool-types | `cargo test -p xai-tool-types --lib --locked`：107 通过、0 失败 | `/tmp/apexo-task-contract-official-source.log` |
| 官方源码 xai-grok-tools 任务输出 | `cargo test -p xai-grok-tools --lib task_output --locked`：91 通过、0 失败，包含旧 wait_tasks | `/tmp/apexo-task-contract-official-tools.log` |
| 两端工具回归 | 最后改动后 CLI/Desktop 各 26 步通过；Desktop 另有四种空闲唤醒 | `apexo-grok-parity-cli-EDI6oR`、`apexo-grok-parity-desktop-sSrvSz` |
| 类型与构建 | 最后改动后全仓 typecheck 21/21、Desktop 生产构建通过 | `/tmp/apexo-task-contract-final-typecheck.log`、`/tmp/apexo-task-contract-final-desktop-build.log` |

证据目录的完整父目录为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`。本轮没有修改公共 HTTP API/Protocol 或生成代码。

可重复命令：从 `packages/apexo` 执行 `bun script/grok-task-contract.mjs cli`、`bun script/grok-task-contract.mjs desktop`、`bun script/grok-task-contract-official.mjs`。Desktop 先从其 package 执行 `bun run build`。官方脚本使用临时 `GROK_HOME` 和官方支持的自定义模型端点，固定模型返回的工具参数，实际运行安装的 Grok 及其 Shell；不把本地实现模拟为官方 runtime，也不改用户全局配置。输出只保留测试工具事件，不记录 setup/config 通知。

官方测试中保留的边界：在线模型曾把单数别名改写为标准数组，因此那次不算别名通过；改用固定响应后实际原始输入已通过。安装版对全部 ID 不存在使用聚合 `TaskNotFound`，源码基线则有 `MultiResult`，两者不能声称输出结构一致。安装版当前没有向此模型公布旧 wait 工具；其行为由源码核对、本地时钟回归及已完成的官方 `xai-grok-tools` 定向源码测试覆盖。首次源码构建缺少 DotSlash/protoc，在 `/tmp/apexo-grok-tools-runtime` 安装官方构建前置工具后重跑，最终 91 项通过；这仍不是整个官方 CLI/TUI 构建。

当前剩余实现仍包括完整 Memory、Goal、Workflow、Shell 配置、图片编辑、Sandbox/Hooks、Desktop profile、独立旁路问答和反馈草稿；Marketplace 暂缓。完整目标没有完成。

### 最新差距复核补充

- 只读查询官方 `main` 仍为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`。再次检查本地 Memory 存储/查询、工具与命令注册、媒体及 Desktop 设置入口，确认顶部剩余清单依然成立。
- 新增确认 `/btw` 独立旁路问答：官方支持主任务继续运行时独立回答、独立面板展示，不将问答写入主轮次。本地只有普通追问提醒、会话 fork 和 Subagent，未提供相同命令和独立 UI 流程；记录为待实现，没有宣称已做三端交互验收。
- 所有状态包含工作区未提交改动；未提交、推送或合并本轮变化。Marketplace 继续按此前要求暂缓，完整功能和完整三端验收目标仍未完成。

### Memory 全局/仓库作用域与旧笔记迁移

本轮将作用域接入共享工具和 Instruction 上下文：

- `memory` 增加 `scope=global|workspace`，默认 workspace。global 用于跨项目偏好；workspace 复用已有 Project ID，同 origin 的 HTTPS/SSH clone、worktree 和子目录指向同一份笔记。非 Git 目录不把 `global` Project ID 当成共享仓库，继续按目录隔离。
- 旧绝对目录散列的笔记首次访问时合并到仓库文件；目标文件锁覆盖合并、原子替换及迁移标记，保留旧文件。每个旧来源只导入一次；用户后来删掉新文件中的笔记，不会在下一次读取时重新导入。并发保存和迁移保留所有笔记。
- 全局偏好与仓库知识分别标注来源并加载到 Grok profile 的提示上下文；每个作用域最多注入 8,000 字符，并明确为需复核的历史上下文。`/memory` 模板读取两种作用域；`/remember`、`/flush` 提示按内容选择作用域。
- 工具读写继续执行对应 read/edit 权限检查，并在结果中返回实际作用域和文件路径。实际调用验证拒绝全局 edit 后文件没有变化。

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Memory 存储、真实 Git 身份、Instruction 和命令回归 | 34 通过、1 既有 todo、0 失败、131 个断言 | `/tmp/apexo-memory-scopes-unit.log` |
| 工具注册、Session 工具与 CLI 清单回归 | 33 通过、0 失败、73 个断言 | `/tmp/apexo-memory-scopes-registry-tests.log` |
| CLI 实际调用 | 13 场景：clone/worktree 共享、迁移、全局偏好、上下文注入、仓库/非 Git 隔离、权限拒绝、非法 scope、删除后不复活 | `apexo-shell-cli-d5NAIw` |
| Desktop 最新打包后端 | 相同 13 场景通过 | `apexo-shell-desktop-GQKvsh` |
| 官方 Grok 1.0.52 | Memory V2 列表及 7 次 read_file 读取通过：同 origin 的 clone/worktree 共享、无关仓库列表隔离、全局偏好跨项目读取 | `apexo-memory-official-ZZoqSy` |
| 官方存储源码 | `cargo test -p xai-grok-memory --lib storage --locked`：94 通过、0 失败 | `/tmp/apexo-memory-scopes-official-source.log` |
| 两端既有工具回归 | CLI/Desktop 各 26 步通过；Desktop 另有 Shell、stdout/stderr Monitor、Scheduler 四类空闲唤醒 | `apexo-grok-parity-cli-sI8IED`、`apexo-grok-parity-desktop-lQeJAQ` |
| 类型与构建 | 全仓 typecheck 21/21、Desktop 生产构建通过 | `/tmp/apexo-memory-scopes-all-types.log`、`/tmp/apexo-memory-scopes-desktop-build.log` |

以上证据目录位于 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`（官方日志使用其 `/private/var/` 真实路径）。可重复命令：在 `packages/apexo` 执行 `bun script/grok-memory-scopes.mjs cli`、`bun script/grok-memory-scopes.mjs desktop` 和 `bun script/grok-memory-scopes-official.mjs`。Desktop 先构建。未修改公共 HTTP API/Protocol 或生成代码。

验收过程中修正了测试夹具的 ChildProcessSpawner 依赖和 macOS `/var` 别名造成的旧笔记路径散列不一致。已有媒体回归需要本地端口，改用已授权环境重跑后通过。官方实测不能在临时工作区启用 Memory，脚本因此创建运行后删除的隔离 Git 仓库，配置和记忆仍放在临时 `GROK_HOME`，不改用户全局配置。

官方安装版实际启用了 Memory V2，并将预置的旧全局笔记迁移成 topic。脚本改为读取官方列表返回的真实文件，未覆盖生成的 MEMORY.md 索引；安装版未向此模型公布 memory_get，故使用 read_file 完成 7 次读取，不宣称 memory_get 契约已验收。Apexo 复用自身 Project 身份和 Markdown 布局，不宣称与官方磁盘格式逐字兼容；不同远程主机继续按现有 Project 规则隔离。

下一项是全文检索/索引和 memory_search/memory_get。Memory 观察与会话记录、自动 flush/LLM dream、watcher、管理界面/删除/启停/保存审阅及可选向量仍未完成；Goal、Workflow、媒体编辑、Sandbox/Hooks、其他差距和完整三端验收也继续保留。Marketplace 仍暂缓，完整目标未完成。

### 当前检索开发状态与剩余差距复核

2026-10-13，按用户要求再次比较当前工作区与官方 Grok Build。只读查询官方 `main` 仍为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`。

- `packages/core/src/memory-search.ts` 已新增全文索引、搜索、按行读取和文件监听代码，工具表也已接入 `memory_search` / `memory_get`。这些是开发中代码，尚未完成验收，不能按工具名称已注册就认定功能完成。
- 当前快照重新执行 `packages/core` 的 `bun typecheck`，仍有 4 个错误：SQLite 配置字段、Effect watcher 包装及函数错误映射不符合当前类型/API。日志 `/tmp/apexo-gap-audit-memory-types.log`。
- 当前快照重新执行 `packages/apexo` 的 `bun test test/tool/memory-search.test.ts`，结果 0 通过、4 失败，均停在测试夹具缺少 `ChildProcessSpawner` 服务。它说明测试尚未跑到检索断言，不能推断 4 项检索行为已经分别验证失败，也不能视作通过。日志 `/tmp/apexo-gap-audit-memory-tests.log`。
- 新检索尚未完成 CLI、Desktop 和官方 Grok 三端实际调用验证。此前 Memory 作用域及工具回归通过的证据仍有效，但只对应当时的代码版本。
- 对照官方 Memory 指南，当前检索还没有来源权重配置、会话时间衰减、MMR 结果去重排序及可选向量混合检索。检索以外的自动记录、自动 flush、LLM dream 与管理界面仍有缺项。
- 其他确认缺项继续为 Goal、Workflow/Deep Research、Shell 宿主配置、Desktop profile 切换、图片编辑与媒体命令、S3/ZDR、OS sandbox、官方格式 Hooks、`/btw` 及反馈草稿。Marketplace 暂缓；完整原生窗口与跨平台验证单列，不混作功能缺失。

本次完成的是状态审计与文档更新，没有提交、推送、发布或声称全量三端验收通过。完整实施目标保持未完成，下一步先修复并验收正在开发的检索功能。

### Memory 全文索引、检索、按行读取与文件监听

已修复上一节记录的开发错误，并完成以下实现：

- `memory_search` / `memory_get` 接入 CLI/Desktop 共用工具层、canonical 清单和 read 权限映射。默认检索 6 条、最低分 0.7；FTS5 BM25 候选按官方全文评分归一化方式排序，返回来源、路径、行范围及片段。中文使用 Unicode 分词；查询词按字面值转义后以 OR 组合，不把用户文本直接作为 FTS 表达式。
- 仓库 SQLite 索引落盘，覆盖当前仓库与全局的 Markdown、topics、sessions、observations 文件。支持重开后复用索引；查询更新外部编辑、原子替换、新增及删除。当前支持读取已有会话/观察文件，自动生成这些文件仍待实现。
- watcher 与 SQLite 资源跟随 Instance 生命周期清理；文件元数据校验作为漏事件或 watcher 不可用时的补充。读取检查真实路径与文件身份，拒绝符号链接、目录穿越和其他仓库路径。权限检查在读取源文件/使用缓存前进行，同时检查 macOS `/var` 别名和 `/private/var` 真实路径；禁止 read 的 Session 不向模型公布两个工具。
- `memory_get` 支持 1-based 行号，`from=0` 按第 1 行兼容，`lines=0` 返回空范围，保留文件末尾换行对应的空行。大于 4 MiB 的笔记也能搜索并按行读取，没有将临时实现中的 4 MiB/100 条限制保留下来。索引分块去掉开头空行时保持不重叠的正确行范围。

本轮修复包括：SQLite 配置字段和 Effect API 用法、测试夹具的进程服务依赖、测试变量重名、macOS 路径别名断言、权限别名覆盖，以及分块去除空行后的行范围重叠。全部使用实际文件、SQLite 与实例生命周期测试；没有用模拟搜索器替代索引实现。

| 验证范围 | 结果 | 证据 |
| --- | --- | --- |
| Memory、工具适配、上下文及 CLI 清单受影响回归 | 69 通过、1 既有 todo、0 失败、230 个断言 | `/tmp/apexo-memory-search-tests.log` |
| CLI 实际调用 | 29 场景通过：搜索、中文、行范围、参数边界、全局/仓库隔离、具体文件拒绝、路径别名拒绝、禁用工具清单、编辑/删除、符号链接及大文件 | `apexo-shell-cli-uiGrmd` |
| 最新 Desktop 打包后端 | 相同 29 场景通过，实际使用 Electron Node SQLite | `apexo-shell-desktop-ssEh99` |
| 官方 Grok 1.0.52 | 保留 7 次作用域读取，并新增 6 次检索/按行读取/编辑/删除对照；使用安装版实际公布的 grep/read_file | `apexo-memory-official-iHl6B7` |
| 官方 Memory 源码 | `cargo test -p xai-grok-memory --lib --locked`：477 通过、0 失败 | `/tmp/apexo-memory-search-official-source.log` |
| 官方工具行号格式 | `cargo test -p xai-grok-tools --lib implementations::memory --locked`：9 通过、0 失败；当前筛选命中 memory_get 格式测试 | `/tmp/apexo-memory-search-official-tools.log` |
| 既有工具链回归 | CLI/Desktop 各 26 步通过；Desktop 另有 Shell、stdout/stderr Monitor、Scheduler 四类空闲唤醒 | `apexo-grok-parity-cli-A01bXS`、`apexo-grok-parity-desktop-kZ25oT` |
| 类型与构建 | 全仓 typecheck 21/21；最终 Desktop 生产构建通过 | `/tmp/apexo-memory-search-all-types.log`、`/tmp/apexo-memory-search-desktop-build.log` |

证据目录父路径为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`（官方日志使用 `/private/var/` 真实路径）。可重复命令：从 `packages/apexo` 执行 `bun script/grok-memory-search.mjs cli`、`bun script/grok-memory-search.mjs desktop`、`bun script/grok-memory-scopes-official.mjs --search`；Desktop 先构建。

验证边界：官方安装版仍使用 Memory V2，没有公布旧 memory_search/memory_get，不能把普通文件工具的场景对照或 9 项格式测试描述为完整旧工具调用契约等价。Apexo 的来源权重、会话时间衰减、访问频次、MMR、可选向量及完整 Memory 生命周期/管理仍需继续实现。Desktop 验证对象是生产打包后端，不能代替原生窗口完整交互或跨平台测试。完整目标继续进行，Marketplace 暂缓；本轮未提交、推送或发布。

### 2026-10-13 当前差距复核及自动记录未完成状态

用户要求重新比较未实现项。本次只读核对官方远端 `refs/heads/main`，仍为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`；复核当前工作区实现、官方 Memory/slash/Hooks/Sandbox 文档与工具注册源码、上一轮遗留日志，更新差距文档及上方状态表。本次没有新增运行三端测试，不把以前的通过结果作为当前所有增量的证明。

- 已新增 `MemorySession` 元数据摘要与原子存储、`SessionMemory` 会话服务及配置结构，接入普通执行和直接 Shell 执行的结束检查点；尚未实现模型观察提取、自动 flush 或 LLM dream。
- `/tmp/apexo-memory-session-unit.log`：元数据/文件专项 4 通过、0 失败；`/tmp/apexo-memory-session-tests.log`：包含会话与上下文的 3 文件回归 85 通过、1 既有跳过、1 既有 todo、0 失败；Apexo 类型检查通过。
- `/tmp/apexo-memory-session-cli.log`：实际 CLI 执行在 `save_on_end=false` 场景失败，仍生成会话日志，需定位配置生效链或测试设置并修复。该场景之前的记录更新、跨会话检索、短对话、禁止编辑、子会话跳过断言已执行通过；整个脚本未通过。证据目录 `apexo-shell-cli-idGKp9`。后续 `memory.enabled=false` 场景没有运行到，Desktop 同项未验收。
- `/tmp/apexo-memory-session-official-source.log`：`cargo test -p xai-grok-shell --lib session::memory::hooks --locked` 在编译测试目标时失败，位置 `session/acp_session_tests/tool_layer_images_bridge_tests.rs:15`，提示缺少 `base64::Engine` trait 导入；Memory hooks 测试尚未实际执行，不记录为通过。
- 自动记录当前设计是每次会话执行结束的持久检查点；官方 legacy 在会话关闭时保存元数据。触发时机存在明确差异。官方 V2 每轮观察属于另一条流程，不能以此检查点代替其验收。
- 新增确认的 Memory 细项：首次/压缩后按相关性检索注入、CLI `memory clear`、官方启停配置及会话开关语义仍未实现；现有笔记上下文加载、命令模板和文本去重不等价于这些行为。管理界面和高级检索排序继续待实现。

优先修复自动记录开关并完成三端验证，再继续 Memory 生命周期与管理、Goal；Desktop profile 入口及图片编辑随后。Workflow、Sandbox/Hooks、旁路问答及反馈草稿仍在差距清单中，Marketplace 按此前要求暂缓。完整目标保持进行中。

### Memory 会话元数据检查点及配置更新修复验收

上一节的开关失败现已定位并修复。`Config.update` 写入 `config.json`，但配置加载器只发现 `apexo.json(c)` 等约定名称，导致更新成功响应后实际配置没有改变。现在优先修改已有的 `apexo.jsonc`，否则修改 `apexo.json`；JSONC 注释、其他配置和兼容字段保留。增加 HTTP PATCH→实例释放→GET 的实际重载断言，以及 JSONC 优先级/嵌套字段保留断言；更新原先只检查错误输出文件名的测试，未放宽配置内容断言。

自动记录现在包含消息计数、UTC 时间和前五个真实用户主题，每条至多 100 个 Unicode 字符；跳过不足三条真实请求、不足 50 UTF-8 字节、synthetic/ignored/auto-continue、子会话及禁止编辑的场景。权限同时检查配置路径与 macOS 真实路径；同一天同一会话原子更新同一文件，较旧检查点不能覆盖较新记录。普通运行及直接 Shell 结束时执行，用户取消也会保存已经符合门槛的记录；不复制 assistant 内容、工具参数或工具输出。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 配置服务、配置 HTTP API、元数据存储 | 115 通过、0 失败、215 个断言 | `/tmp/apexo-memory-session-config-tests.log` |
| 最终 Session/Instruction/Memory 集成 | 91 通过、1 既有跳过、1 既有 todo、0 失败、435 个断言 | `/tmp/apexo-memory-session-final-tests.log` |
| CLI 自动记录 | 12 场景通过，包括更新、跨会话检索、取消、权限别名、关闭、重新开启 | `apexo-shell-cli-ZajkKX`；`/tmp/apexo-memory-session-cli.log` |
| Desktop 自动记录 | 最新生产 Electron 后端同样 12 场景通过 | `apexo-shell-desktop-UV9rK0`；`/tmp/apexo-memory-session-desktop.log` |
| CLI/Desktop 检索回归 | 各 29 场景通过 | `apexo-shell-cli-7QVfuC`、`apexo-shell-desktop-or1jZX`；`/tmp/apexo-memory-session-search-{cli,desktop}.log` |
| CLI/Desktop 既有工具链 | 各 26 步通过；Desktop 另有四类空闲唤醒 | `apexo-grok-parity-cli-Vopiro`、`apexo-grok-parity-desktop-2a4PEA`；`/tmp/apexo-memory-session-regression-{cli,desktop}.log` |
| 官方 legacy session-end hooks | 原有 15 项源码测试通过，覆盖门槛、关闭开关、真实主题、自动继续过滤和 Unicode 截断 | `/tmp/apexo-memory-session-official-source-repaired.log` |
| 官方安装版 V2 | 7 次作用域读取、6 次检索/修改/删除对照通过 | `apexo-memory-official-MXp4a1`；`/tmp/apexo-memory-session-official-runtime.log` |
| 公共 API 与类型 | HTTP API coverage/auth/effect 各 207 通过、无失败/跳过/缺项；全仓 typecheck 21/21；Client 生成检查通过 | `/tmp/apexo-memory-session-httpapi.log`、`/tmp/apexo-memory-session-all-types.log`、`/tmp/apexo-memory-session-client-check.log` |
| 构建与格式 | 最新 Desktop 生产构建、受影响文件格式化、`git diff --check` 通过 | `/tmp/apexo-memory-session-desktop-build.log` |

证据目录父路径为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`，官方使用对应 `/private/var/` 真实路径。自动记录命令从 `packages/apexo` 执行 `bun script/grok-memory-session.mjs cli` / `desktop`，后者由 fixture 启动实际 Electron Node runtime。旧 26 步脚本仍要求从 `packages/desktop` 用 `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ../apexo/script/grok-parity.mjs desktop restricted` 执行；本轮一度误用 Bun，因缺少 `node:sqlite` 启动失败，改为正确运行时后通过，未修改产品 SQLite 实现来绕过检查。

官方源码基线未变；临时副本仅对 `tool_layer_images_bridge_tests.rs` 增加 `use base64::Engine;`，解除无关测试目标的编译错误，没有修改 Memory hooks、测试输入或断言。安装版仍为 Memory V2，不能声称直接运行了相同旧 hooks。Apexo 选择在每次执行结束持久化检查点；官方 legacy 在会话关闭时保存，触发时机差异仍保留。完整原生窗口、跨平台、模型观察、自动 flush/dream 及管理界面继续待完成。完整目标保持进行中；本轮没有提交、推送或合并。

### Memory 自动 flush 验收与最新剩余差距复核

2026-10-13：复核当前代码及上一轮完成的运行日志，补记自动 flush 验收。重新只读查询官方 `refs/heads/main`，仍为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`；安装版为 1.0.52。本次比较没有重新执行三端或全仓测试，仅更新文档，以下是已存在的实际运行证据。

当前 Grok profile 在压缩前、接近压缩阈值及空闲时独立调用模型提取新增知识，禁止工具调用，不插入主会话轮次。新请求取消尚未完成的空闲提取；检查真实/别名路径读写权限；跨进程文件锁和原子写入保护保存。相同快照或压缩周期不重复提取，跳过 NO_REPLY、空结果和无 Markdown 标题的内容；默认每次保存至多 8000 个 Unicode 字符，可覆盖模型、长度、阈值余量和空闲时长。现有去重是相同文本去重，不是向量语义去重。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| CLI 自动 flush | 14 场景通过，9 次提取模型调用 | `apexo-shell-cli-9mMGB3`；`/tmp/apexo-memory-flush-cli.log` |
| Desktop 自动 flush | 生产 Electron 打包后端相同 14 场景通过 | `apexo-shell-desktop-xeq6Dy`；`/tmp/apexo-memory-flush-desktop.log` |
| CLI/Desktop 既有工具链 | 各 26 步通过；Desktop 另有四类空闲唤醒 | `apexo-grok-parity-cli-iLDlLg`、`apexo-grok-parity-desktop-l0Bsup`；`/tmp/apexo-memory-flush-regression-{cli,desktop}.log` |
| 本地 Session/Compaction/Instruction/Memory | 143 通过、2 既有跳过、1 既有 todo、0 失败，570 个断言 | `/tmp/apexo-memory-flush-tests.log` |
| 官方 legacy flush 策略 | 19 项源码测试通过 | `/tmp/apexo-memory-flush-official-policy.log` |
| 官方 legacy 历史窗口 | 4 项源码测试通过；沿用上述临时副本的一行编译修复 | `/tmp/apexo-memory-flush-official-window.log` |
| 官方安装版 V2 | 7 次读取、6 次检索对照；两个会话的 flush barrier 返回 flushed，分别 through_turn=6/1 | `apexo-memory-official-n2T3dW`；`/tmp/apexo-memory-flush-official-runtime.log` |
| 类型、公共 API 与生成 | 全仓 typecheck 21/21；HTTP API 三组各 207 通过，无失败/跳过/缺项；legacy SDK/Client 生成及检查通过 | `/tmp/apexo-memory-flush-all-types.log`、`/tmp/apexo-memory-flush-httpapi.log`、`/tmp/apexo-memory-flush-client-check.log` |
| Desktop 构建 | 生产构建通过 | `/tmp/apexo-memory-flush-desktop-build.log` |

证据目录父路径为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`，官方使用对应 `/private/var/` 路径。专项命令从 `packages/apexo` 执行：`bun script/grok-memory-flush.mjs cli`、`bun script/grok-memory-flush.mjs desktop`、`bun script/grok-memory-scopes-official.mjs --search --flush`。14 个场景包括空闲保存不增加主轮次、增量、文本去重、NO_REPLY、无效格式、跨会话检索、关闭空闲/全部 flush、权限拒绝、新请求取消、阈值、模型覆盖、Unicode 上限和压缩周期。

边界：本地及官方运行脚本使用可控模型端点验证执行和协议，不能证明真实模型提取质量。官方安装版的 V2 flush 是观察持久化屏障，本次返回 NOOP 提取结果；不是运行 legacy 空闲/压缩前摘要，也不证明 Apexo 已有 V2 观察链。官方 19 项策略测试中包括其语义去重测试，不能据此标记本地实现了语义去重。本地阈值沿用 Apexo 的压缩边界；空闲场景使用 1 秒配置，没有实际等待默认 300 秒。Desktop 是打包后端，未替代原生窗口 E2E。

剩余确认缺项：Memory V2 每轮观察、LLM dream/自动整理门槛、首次及压缩后相关检索注入、管理/审阅/清理入口、官方启停语义、高级排序/可选向量；Goal；Workflow/Deep Research；Shell 宿主配置；图片编辑/媒体命令/S3-ZDR；Sandbox/官方 Hooks；Desktop profile 切换；旁路问答与反馈草稿。Marketplace 仍暂缓。独立 V2 runtime 迁移和官方后端适配作为架构选项单列，完整原生窗口/跨平台及尚未逐项审计的功能作为验收缺口单列。完整目标未完成，当前工作区改动尚未提交或发布。

### Memory 模型 dream、自动整理及迟订阅 Shell 输出修复

2026-10-13：上一节的模型 dream/自动整理门槛已实施。`memory` 的 dream 操作进入独立模型调用，不再调用原先的文本去重函数。输入包含已有长期记忆和其他会话记录，输出按主题写入仓库 `MEMORY.md`，不覆盖全局偏好。自动检查在主会话执行结束后及实例周期任务中进行；默认至少 5 个不同会话、间隔 24 小时、周期 1 小时。`check_interval_secs=0` 关闭周期检查，手动操作绕过自动时间/数量门槛。模型调用限时 30 分钟，文件租约带心跳并将过期窗口限制在模型期限之外。

保存和清理规则：跳过当前会话及子会话；同时检查读/写权限与真实路径；对长期记忆做版本校验，用户并发修改时返回 conflict，不覆盖。日志清理要求已送入模型、版本未变化且至少 5 分钟未修改；近期日志、输入上限外的日志和变化后的日志保留。持久 journal 记录实际处理的文件版本，避免仅靠截止时间漏掉输入上限外的记录；模型未看到的旧记忆尾部也保留。NO_REPLY/无效 Markdown 不改写长期记忆、不删日志。全文索引在后续查询时移除清理的日志并载入新主题。

实际发现并修复两项问题：

- 手动 dream 最初未接入工具 AbortSignal，停止主会话后仍持有整理锁。真实 CLI 回归先得到 busy，失败日志 `/tmp/apexo-memory-dream-cancel-before.log`；现取消信号与模型调用竞速，作用域关闭时释放租约，后续整理立即可用，取消的结果不落盘。
- 整体回归出现快速 Shell 返回 `(no output)`，导致完成通知缺少原始输出。新增真实子进程测试等待 close 后才订阅，稳定复现空字符串（`/tmp/apexo-memory-dream-output-before.log`）。根因是 Node/Bun 会排空尚未读取的子进程 stdio；现在启动时同步接入两个 PassThrough，保留背压，并随作用域释放。迟订阅的中文/emoji 与两路各 1MiB 输出均通过，原有 Shell 测试也通过。此前仅等待已启动的消费 fiber 排空没有覆盖“消费者还没订阅”的窗口。

最终证据（均包含上述修复，另行注明的检查除外）：

| 验证 | 结果 | 日志/证据目录 |
| --- | --- | --- |
| CLI dream | 20 场景通过，10 次独立模型调用 | `/tmp/apexo-memory-dream-verified-cli.log`；`apexo-shell-cli-eouQgD` |
| Desktop dream | 生产 Electron 打包后端相同 20 场景通过 | `/tmp/apexo-memory-dream-verified-desktop.log`；`apexo-shell-desktop-MRTeph` |
| CLI/Desktop 自动 flush | 各 14 场景通过 | `/tmp/apexo-memory-dream-verified-flush-{cli,desktop}.log`；`apexo-shell-cli-OX1dkB`、`apexo-shell-desktop-eFO8GH` |
| CLI/Desktop 既有工具链 | 各 26 步通过；Desktop 另有四类空闲唤醒 | `/tmp/apexo-memory-dream-verified-regression-{cli,desktop}.log`；`apexo-grok-parity-cli-nQtYi1`、`apexo-grok-parity-desktop-9EQYzC` |
| Memory/Shell/Session/Compaction/Instruction | 198 通过、2 既有跳过、1 既有 todo、0 失败，762 个断言 | `/tmp/apexo-memory-dream-verified-tests.log` |
| Shell 输出专项 | 29 通过、0 失败，包含迟订阅与大输出 | `/tmp/apexo-memory-dream-verified-shell-tests.log` |
| 官方 Memory 相关源码 | `cargo test -p xai-grok-memory --lib dream --locked`：83 通过，包含 legacy、锁及 V2 相关测试；不等同本地已实现全部 V2 能力 | `/tmp/apexo-memory-dream-official-policy.log` |
| 官方安装版 Memory V2 | 7 次读取、6 次检索及 flush 通过；空 dream 返回 no_work；实际提取 1 条观察，再由无工具的模型 dream 写入 1 个主题，返回 completed | `/tmp/apexo-memory-dream-official-runtime.log`；`apexo-memory-official-lerdOG` |
| 官方 Shell | 显式转后台、原 PID、单次完成通知、Unicode stdout/stderr 对照通过 | `/tmp/apexo-memory-dream-shell-official.log`；`apexo-shell-official-owJd5x` |
| 类型、生成、构建 | 全仓 typecheck 21/21，最终 Desktop 构建通过；legacy SDK、Client 生成检查及根目录配置 schema 生成通过 | `/tmp/apexo-memory-dream-verified-types.log`、`/tmp/apexo-memory-dream-verified-build.log`、`/tmp/apexo-memory-dream-client-check.log`、`/tmp/apexo-memory-dream-schemas.log` |
| HTTP API | coverage/auth/effect 各 207 通过、无失败/跳过/缺项；此项早于最后内部取消及输出修复，公共契约未再次变化 | `/tmp/apexo-memory-dream-httpapi.log` |

证据目录父路径为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`，官方 Memory 使用对应 `/private/var/` 路径。专项命令从 `packages/apexo` 执行：`bun script/grok-memory-dream.mjs cli` / `desktop`；官方为 `bun script/grok-memory-scopes-official.mjs --search --flush --dream`。模型和媒体端点使用隔离 fixture，验证真实执行、存储、取消和协议，不证明真实模型整理质量。

20 场景包括合并旧记忆、当前会话排除、旧日志清理、索引移除、跨会话主题检索、近期日志保留、NO_REPLY、无效回复、互斥租约、并发修改、取消释放租约、不同会话计数、自动整理、时间门槛、关闭自动整理、禁止读取、真实路径禁止写入、Subagent 跳过、无新消息的周期整理、关闭 Memory。测试索引路径最初直接比较 `/var` 与 `/private/var`，已统一为真实路径后通过，没有放宽文件身份断言。

保留失败记录：与生产构建并行时，一项 Shell 会话测试超过既有 5 秒期限（`/tmp/apexo-memory-dream-final-tests.log`）；构建结束后同套件 169 通过（`/tmp/apexo-memory-dream-final-idle-tests.log`），最后输出修复后扩展到上述 198 项通过，未提高测试超时。工具链空输出失败 `/tmp/apexo-memory-dream-final-regression-cli.log` 由新增迟订阅测试解释并修复。

差异与剩余工作：当前 dream 是 legacy 风格的单份长期记忆；官方安装版为 V2 观察和主题事务链，不能宣称协议及存储等价。新建空会话尚未发出首条请求时不会运行本地自动整理，专用 flush/dream 状态界面也未实现。每轮观察、主题事务/恢复、相关检索自动注入、Memory 管理/审阅/启停语义和高级排序继续待完成。Goal、Workflow、媒体编辑、Sandbox/Hooks、Shell 宿主配置、Desktop profile 及其他差距继续保留；Marketplace 暂缓。原生 Desktop 窗口、跨平台及全量功能验收仍未完成；未提交、推送或合并，完整目标保持进行中。


### Memory 首次/压缩后相关检索注入

2026-10-13：新增共享 `SessionMemoryContext`，替换每轮直接加载固定 MEMORY.md 的入口。首次按最近真实用户问题检索，最多 6 条，默认最低评分 0.9；短问题和问候使用项目约定查询。压缩成功后按压缩前真实问题检索最多 3 条，最低评分 0；排除 synthetic、ignored 和自动续轮文本。每段保留 500 个 Unicode 字符，带来源、文件、行号及历史上下文提示，并保护 Markdown 围栏。

非空结果存入独立 `session_memory_context` 表，以 Session/压缩周期为键；普通续聊和实例重载复用原前缀，删除 Session 通过外键级联清理。空尝试只在当前实例去重，重载后可再次检索。每轮检查当前 agent/session 的真实路径和别名读取权限；禁止或需要询问时不自动读取，不弹审批。索引与手动检索共用实例级服务和 watcher。新增配置 `memory.initial_injection.enabled/min_score`；关闭首次注入不关闭压缩恢复，关闭 Memory 则关闭两者。

旧目录笔记在首次召回前执行一次性迁移，保留原文件和迁移标记。自动路径要求允许读取源/目标并写入目标/标记；验证目录链和源文件，拒绝符号链接，使用 O_NOFOLLOW 读取并复核身份和修改信息。权限拒绝不迁移，已删除的旧笔记不因再次打开项目复活。先前作用域测试依赖每轮加载所有笔记，现改为检查真正发给模型的 system 内容，并分别按相关查询验证全局/仓库召回；关闭该专项无关的自动日志，避免日志排名干扰。

实际测试修正：压缩后第一条用户消息可能只是“继续”，检索查询应来自压缩前，已按 summary ID 截止历史。官方 `/compact` 的摘要请求仍可携带工具定义，fixture 需按真实摘要提示识别；官方压缩后新记忆也可能位于历史提醒，不能只捕获旧 system 前缀。没有通过移除压缩刷新断言让测试通过。

已完成证据（均为隔离本地模型端点，验证执行与协议，不证明真实模型回答质量）：

| 检查 | 结果 | 日志 / 证据目录 |
| --- | --- | --- |
| CLI 相关记忆注入 | 最终 20 场景通过 | `/tmp/apexo-memory-context-final-cli.log`；`apexo-shell-cli-6Wh8o1` |
| Desktop 相关记忆注入 | 最终生产 Electron 打包后端 20 场景通过 | `/tmp/apexo-memory-context-final-desktop.log`；`apexo-shell-desktop-DHiXXT` |
| CLI/Desktop 旧笔记与作用域 | 各 14 次调用通过，含首轮工具调用前的旧笔记召回 | `/tmp/apexo-memory-context-scopes-cli.log`、`/tmp/apexo-memory-context-final-scopes-desktop.log`；`apexo-shell-cli-9k8OXo`、`apexo-shell-desktop-0aPOST` |
| CLI/Desktop 既有工具链 | 各 26 步通过；Desktop 另有四类空闲唤醒 | `/tmp/apexo-memory-context-parity-{cli,desktop}.log`；`apexo-grok-parity-cli-MbYIVs`、`apexo-grok-parity-desktop-FBJfQK` |
| 官方安装版 V2 | 两种 manifest、前缀保持、loadSession 恢复、新会话刷新、真实压缩后刷新共五项通过；7 次文件读取通过 | `/tmp/apexo-memory-context-official.log`；`apexo-memory-official-VFWBvf/memory-scopes.json` |
| 官方源码 | memory_context 相关 16 项通过 | `/tmp/apexo-memory-context-official-source.log` |
| 迁移/权限专项 | 9 通过、0 失败 | `/tmp/apexo-memory-context-migration-unit.log` |
| 构建与类型 | 最终 Desktop 构建通过；全仓 typecheck 21/21 | `/tmp/apexo-memory-context-final-build.log`、`/tmp/apexo-memory-context-final-types.log` |
| 生成与数据库 | legacy SDK、Client check:generated、静态 schema、数据库 migration --check 通过 | `/tmp/apexo-memory-context-sdk.log`、`/tmp/apexo-memory-context-client.log`、`/tmp/apexo-memory-context-schemas.log`、`/tmp/apexo-memory-context-migration-check.log` |
| HTTP API | coverage/auth/effect 各 207 通过，无失败/跳过/缺项 | `/tmp/apexo-memory-context-httpapi.log` |

证据目录父路径为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`，官方使用对应 `/private/var/` 路径。官方命令为 `bun script/grok-memory-scopes-official.mjs --context`；源码 `cargo test -p xai-grok-shell --lib memory_context --locked` 使用同一临时官方副本，仅保留此前补齐测试编译所需的 `base64::Engine` 导入。16 项包含官方陈旧提示测试，不代表本地已实现陈旧提示或全部 V2 行为。

最终综合回归 **209 通过、2 既有跳过、1 既有 todo、0 失败，845 个断言**，同一 11 文件套件耗时 86.03 秒，日志 `/tmp/apexo-memory-context-final-idle-unit.log`。此前与其他检查并行时，取消断言耗时 398ms，超过既有 250ms 限制；另有 afterEach 清理超过 5 秒。失败日志 `/tmp/apexo-memory-context-final-unit.log`（208 通过、2 失败）保留。所有其他检查结束后重跑通过，未放宽断言或超时；本轮未据此修改取消实现，也不将这次空闲通过解释为任意负载下的延迟保证。

剩余范围：V2 每轮观察/多主题事务及恢复、Memory 管理/审阅/启停配置语义、来源权重/衰减/访问频次/陈旧提示/向量等仍未实现；Goal、Workflow、媒体编辑、Sandbox/Hooks 等完整目标仍在进行。Marketplace 继续暂缓。本项测试使用 CLI 服务入口和生产 Desktop 打包后端，不代替原生窗口、跨平台或整个项目的最终验收；尚未提交、推送或合并。

### Memory CLI 清理、运行中缓存与自动任务保护

2026-10-13：新增 `apexo memory clear`，默认清理当前工作区；支持互斥的 `--workspace`、`--global`、`--all`，以及 `--yes/-y`。未指定 yes 时先显示实际删除路径，只有 y/yes 才执行；空输入、EOF 和否定回答取消。`--all` 指当前项目加全局，保留其他项目。Git 项目同时清理当前目录的旧版笔记目录；保留在其他 clone 中的旧版备份不再自动迁回已清理的项目。清理记忆不删除原始会话历史。

共享存储增加清理版本和进行中标记；清理与实际落盘互斥，不在模型请求期间持有存储锁。清理中断后读取/写入关闭，重新执行 clear 可完成清理。拒绝被符号链接重定向的作用域或控制目录；目录内链接仅删除链接本身。自动检查点、flush 和 dream 保存前校验读取时的版本，避免清理前启动的提取结果重新写回。会话上下文按清理版本换周期，CLI 删除相关持久快照；索引切换至新的数据库文件，防止仍持有旧文件的进程把旧 WAL 用到新索引。索引创建前也验证上级目录。

实际复现并修复旧 idle 定时器问题：即使模型提取尚未开始，清理前已排队的空闲任务也可能在清理后再次总结旧会话。旧 Desktop 包在新增场景中出现 2 次提取而预期为 1（`/tmp/apexo-memory-clear-idle-repro.log`）。现定时任务保留排队时的清理版本，版本变化后跳过；新的用户消息仍可重新保存。测试包含正常 idle 保存的正向对照，再跨过配置的 5 秒时限检查旧任务未执行，随后验证清理后的新轮次确实保存。

| 验证 | 结果 | 日志 / 证据目录 |
| --- | --- | --- |
| CLI 清理，非 Git | 最终 19 场景通过 | `/tmp/apexo-memory-clear-verified-cli.log`；`apexo-shell-cli-x5pmwf` |
| Desktop 清理，非 Git | 最终打包后端 19 场景通过 | `/tmp/apexo-memory-clear-verified-desktop.log`；`apexo-shell-desktop-FyRKIN` |
| CLI 清理，Git 项目 | 最终 21 场景通过，含旧目录清理和防止迁回 | `/tmp/apexo-memory-clear-verified-git-cli.log`；`apexo-shell-cli-C9JgiJ` |
| Desktop 清理，Git 项目 | 最终打包后端相同 21 场景通过 | `/tmp/apexo-memory-clear-verified-git-desktop.log`；`apexo-shell-desktop-OHJQ5g` |
| CLI/Desktop 自动 flush | 最后定时器修复后各 14 场景通过 | `/tmp/apexo-memory-clear-verified-flush-{cli,desktop}.log`；`apexo-shell-cli-DPMJTE`、`apexo-shell-desktop-WR2Lhc` |
| CLI/Desktop 上下文与 dream | 本轮各 20 场景通过；早于最后的 idle 定时器和索引创建前校验修正 | `/tmp/apexo-memory-clear-context-{cli,desktop}.log`、`/tmp/apexo-memory-clear-dream-{cli,desktop}.log` |
| CLI/Desktop 既有工具链 | 本轮各 26 步通过，Desktop 另有四类空闲唤醒；早于最后上述两项内部修正 | `/tmp/apexo-memory-clear-parity-{cli,desktop}.log`；`apexo-grok-parity-cli-0ybDkJ`、`apexo-grok-parity-desktop-W773Tm` |
| 官方安装版 1.0.52 | 原有 7 次读取通过；退出 ACP 后执行真实 clear 命令，8 次调用覆盖 9 项检查：取消、默认否、EOF、互斥作用域、全局、默认工作区、all、保留其他项目、空清理 | `/tmp/apexo-memory-clear-official.log`；`apexo-memory-official-u17urO/memory-scopes.json` 的 `cli-clear` 记录 |
| 官方存储源码 | `cargo test -p xai-grok-memory --lib clear_ --locked`：5 通过 | `/tmp/apexo-memory-clear-official-source.log` |
| 构建、类型 | 最终生产 Desktop 构建通过；全仓 typecheck 21/21 | `/tmp/apexo-memory-clear-verified-build.log`、`/tmp/apexo-memory-clear-verified-types.log` |
| 最终受影响综合回归 | 216 通过、2 既有跳过、1 既有 todo、0 失败；881 个断言、12 文件、62.02 秒 | `/tmp/apexo-memory-clear-final-unsandboxed-unit.log` |

运行命令从 `packages/apexo` 执行 `bun script/grok-memory-clear.mjs cli` / `desktop`，加 `--git` 覆盖 Git 项目；脚本实际启动 CLI 清理子进程，对运行中的 CLI 服务或生产 Electron 后端检查后续模型请求、检索和保存。官方为 `bun script/grok-memory-scopes-official.mjs --clear`；安装版按其实际 V2 存储模式清理，不能据此标记本地具备 Memory V2。证据目录父路径为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`，官方使用对应 `/private/var/` 路径。

失败记录：idle 场景初版 fixture 把关闭 flush 的环境配置设为最高优先级，导致正向对照超时，`/tmp/apexo-memory-clear-idle-before.log` 和 `idle-cli.log` 保留；改为通过配置 API 设置后才得到上述真实旧包复现。综合套件第一次未申请本地端口权限，fixture 监听端口失败，得到 173 通过、43 失败，日志 `/tmp/apexo-memory-clear-final-unit.log` 保留；未调整断言，在允许端口的环境原样重跑后，最终得到上表的 216 通过、0 失败。

边界：Desktop 是运行中的打包后端响应外部 CLI 清理，没有新增 GUI 清理按钮；官方专项没有验证它的运行中缓存或 idle 定时器行为。全部运行使用隔离 HOME、临时文件和可控模型端点。清理标记为防止旧数据恢复而保留；未宣称加密擦除或清除会话历史。此阶段浏览、逐条删除、会话启停、保存审阅与官方启停优先级仍待实现；后续浏览和逐条删除的进展见下一节。完整 Memory V2、Goal、Workflow 和其余差距继续推进。Marketplace 仍暂缓；原生窗口、跨平台和最终全仓验收未完成。没有提交、推送或合并。

### Memory 管理增量：修复前的验收记录

2026-10-13 差距复核：本节记录当前未提交代码和已存在的执行证据，不将开发中功能标为完整验收。官方 `main` 经本次 `git ls-remote` 确认为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`，本机安装版为 `grok 1.0.52 (0920c8169e27)`。本次复核更新文档，没有新增运行这些专项。

已接入共享 `MemoryCatalog`、`MemoryFiles` 和 `MemoryManagement`，提供当前 Session 的列表、预览、单项删除 API。列表区分全局、工作区和会话，按文件名与内容过滤；预览保留原始字节哈希，删除要求读写权限及预览版本一致。CLI mini/fullscreen TUI、App legacy/V2 均有管理入口，SDK 已生成。清理版本机制扩展到单项删除，防止旧上下文或已启动的自动任务恢复删除前的内容。

| 已有证据 | 结果及范围 | 日志 |
| --- | --- | --- |
| CLI / Desktop 打包后端 API | 各 17 场景通过；CLI 记录早于大文件错误码调整，两者均早于最后迁移增量 | `/tmp/apexo-memory-browser-api-cli.log`、`/tmp/apexo-memory-browser-api-desktop.log` |
| 生产浏览器连接 CLI / Desktop 后端 | 各 8 场景通过：打开、分组、Unicode 预览、过滤、取消删除、拒绝过期预览、刷新后删除、保留其他笔记；早于最后 slash 去重 | `/tmp/apexo-memory-browser-ui-cli-final.log`、`/tmp/apexo-memory-browser-ui-desktop.log` |
| CLI mini PTY 最新专项 | 8 场景通过，包含退出预览和取消删除 | `/tmp/apexo-memory-browser-mini-escape.log` |
| CLI fullscreen PTY 最新专项 | **未通过**，退出预览后在 `memory filter` 步骤超时；此前 7 场景通过不足以覆盖新交互 | `/tmp/apexo-memory-browser-fullscreen-escape.log`、`/tmp/apexo-memory-browser-fullscreen-pass.log` |
| 官方安装版 | 浏览管理 8 项通过，另有既有读取检查；为实际 V2 协议 | `/tmp/apexo-memory-browser-official-final.log` |
| 官方源码 | `v2_maintenance::tests` 21 通过；不代表本地已实现全部 V2 状态机 | `/tmp/apexo-memory-browser-official-source-final.log` |
| 受影响单测 | 222 通过、2 既有跳过、1 既有 todo、0 失败；早于最后迁移测试增量 | `/tmp/apexo-memory-browser-unit.log` |
| footer / experimental API 单测 | 30 通过、5 既有跳过、0 失败 | `/tmp/apexo-memory-browser-client-unit.log` |
| HTTP API | coverage/auth/effect 各 210 通过、无失败/跳过/缺项 | `/tmp/apexo-memory-browser-httpapi.log` |
| 类型检查 | 全仓检查因 TUI input 不支持布局属性失败；修正后 TUI 包检查通过，最终全仓检查仍待跑 | `/tmp/apexo-memory-browser-all-types.log`、`/tmp/apexo-memory-browser-tui-types-final.log` |

待收尾：定位并修复全屏 TUI 新交互失败；重新验证最后迁移逻辑；最终 App/Desktop 构建、原生命令与服务端模板去重验证、三端回归及全仓类型检查；前端性能复测。原生 Desktop 窗口、legacy 输入框完整交互和跨平台仍单列，不能用 V2 浏览器连接打包后端替代。当前没有新的提交、推送或合并。

版本边界：本地 API 使用 SHA-256，官方 forget 使用 BLAKE3，比较的是用户行为而非相同 wire contract。本地仍是 legacy 风格存储，没有官方 V2 生成索引及其完整墓碑/恢复协议。单项删除不等于清除历史聊天或安全擦除全部缓存。会话启停、保存审阅、配置优先级、专用 flush/dream 状态、V2 观察与事务、高级检索、Goal、Workflow、媒体编辑等仍是明确功能差距；Marketplace 暂缓。

### Memory 浏览、预览和单项删除：指定三端场景验收完成

2026-10-13：修复上节遗留的真实终端交互问题。全屏 `DialogProvider` 会在 Memory 自己处理 Escape 前关闭整个弹窗，使下一次 `/database` 输入落入聊天输入框。Memory 现在通过共享 keymap 的优先绑定处理 Escape：依次结束过滤、取消删除确认、退出预览，最后才关闭面板；删除请求执行期间保留面板。mini 和 fullscreen 复用这套处理，均通过原失败步骤，没有移除断言。

最后的旧笔记迁移增量也已验证：首次浏览会迁移允许读写的旧笔记，删除后再次浏览不会重新导入。CLI/Desktop 新增实际模型请求检查，证实预览的笔记能进入当前上下文，删除后立即从当前会话的缓存上下文消失，实例释放并重新加载后也不会从持久快照或索引返回。该检查验证的是记忆注入，不声称删除原始聊天历史。

最终证据如下；均为 macOS 隔离 HOME、临时文件和可控模型端点，验证实际执行及协议，不证明真实模型质量：

| 检查 | 结果 | 日志 / 证据目录 |
| --- | --- | --- |
| CLI Memory 管理 API | 20 场景通过，含权限、作用域、预览版本校验、大文件限制、删除后缓存和重载保护 | `/tmp/apexo-memory-browser-verified-api-cli.log`；`apexo-shell-cli-46JXmm` |
| Desktop Memory 管理 API | 最终 Electron 打包后端相同 20 场景通过 | `/tmp/apexo-memory-browser-verified-api-desktop.log`；`apexo-shell-desktop-4zSD1I` |
| CLI mini 真实 PTY | 8 场景通过，含退出预览、取消确认、外部编辑冲突和单项删除 | `/tmp/apexo-memory-browser-verified-mini.log`；`apexo-shell-cli-ErE0YH` |
| CLI fullscreen 真实 PTY | 原失败步骤修复后相同 8 场景通过 | `/tmp/apexo-memory-browser-fullscreen-keymap.log`；`apexo-shell-cli-MjrdDO` |
| 生产 App 连接 CLI / Desktop | 各 9 场景通过，最后一项验证 `/memory` 打开原生面板而不调用模型；两端截图已保存，已查看 Desktop 预览截图 | `/tmp/apexo-memory-browser-verified-ui-{cli,desktop}.log`；`apexo-shell-cli-RfvH1R`、`apexo-shell-desktop-0yfDjE` |
| 官方安装版 1.0.52 | 重新运行管理 8 项对照通过，另有 7 次既有读取 | `/tmp/apexo-memory-browser-verified-official.log`；`apexo-memory-official-hzf8Q9` |
| 最新迁移专项 | 7 通过、0 失败、42 个断言 | `/tmp/apexo-memory-browser-migration-unit.log` |
| 最终 Memory/Shell/Session/Compaction/Instruction | 223 通过、2 既有跳过、1 既有 todo、0 失败；923 个断言，13 文件，69.23 秒 | `/tmp/apexo-memory-browser-verified-unit.log` |
| 最终 footer / experimental API | 30 通过、5 既有跳过、0 失败，154 个断言 | `/tmp/apexo-memory-browser-verified-client-unit.log` |
| 最终类型和生成 | 全仓 typecheck 21/21（6 缓存）；Client `check:generated` 通过 | `/tmp/apexo-memory-browser-verified-types.log`、`/tmp/apexo-memory-browser-verified-client.log` |
| 最终生产构建 | App 与 Desktop 均通过，Desktop 包含当前共享后端 | `/tmp/apexo-memory-browser-verified-app-build.log`、`/tmp/apexo-memory-browser-verified-desktop-build.log` |

证据目录父路径为 `/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`，官方使用对应 `/private/var/` 路径。专项从 `packages/apexo` 执行：`bun script/grok-memory-browser.mjs cli` / `desktop`、`bun script/grok-memory-browser-tui.mjs`（另加 `--fullscreen`）、`bun script/grok-memory-browser-ui.mjs cli` / `desktop`。官方执行 `bun script/grok-memory-scopes-official.mjs --browse`，本次使用临时工具 PATH，并将 `BLAKE3_MODULE` 指向现有 `node_modules/.bun/@noble+hashes@2.2.0/node_modules/@noble/hashes/blake3.js`。没有为对照新增运行时依赖。

性能按改动前同一生产空会话基准、同一系统 Chrome 测量，10 次 reload、丢弃前 2 次。改动前 median/p95 为 **149.93/192.30ms**，最终为 **136.35/202.02ms**；中位数降低、尾部样本略高，不能从这一次小样本判断提速或稳定的尾部退化。日志 `/tmp/apexo-memory-browser-ui-baseline.log`、`/tmp/apexo-memory-browser-verified-benchmark.log`，最终目录 `apexo-shell-cli-r0OmuC`。新增管理面板仅在打开时加载笔记，不在关闭状态轮询内容。

上一节保留的 21 项官方源码检查和 HTTP API 三组各 210 项检查早于最后内部迁移/界面修正，公共契约未再次变化。类型错误已通过移除 input 不支持的布局属性、改用外层 box 修复；旧失败日志保留。新界面英文/简体中文词条沿用此前 Firefox zh-CN、Nextcloud zh-CN 与 Microsoft 中文写作规范的核对，不修改已有英文文案。

本项完成的是列明的实际 API、PTY 和生产浏览器对照。App legacy 输入框已有接入和类型检查，完整 legacy 交互、原生 Desktop 窗口及 Windows/Linux 仍待最终验收。Memory 会话启停、保存审阅、官方开关优先级、整理状态、Memory V2、高级排序及 Goal/Workflow 等完整目标继续进行；Marketplace 暂缓。没有提交、推送或合并。

### 当前差距复核：Memory 启停已有实现增量，尚未验收

2026-10-13：按用户要求重新比较当前工作区和官方 Grok Build。只读查询官方 `main` 仍为 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`，本机 `grok --version` 为 `1.0.52 (0920c8169e27)`；未改变原有功能范围，Marketplace 继续暂缓。

已检查新增的 `SessionMemoryMode`、会话状态表、工具清单过滤、自动记忆任务保护、status/toggle HTTP API、App 按钮和 CLI `t` 键入口。代码已包含默认关闭、会话覆盖、进程强制关闭、运行中延迟开启，以及关闭后旧任务取消/禁止旧版本写回。它们应标记为实现中，不能继续写成完全没有代码；也不能以这些接线代替三端验收。

本次从 `packages/apexo` 运行 `bun test test/tool/memory-mode.test.ts test/tool/memory-context.test.ts test/tool/registry.test.ts`，使用 Bun 1.3.14，结果 **27 通过、2 失败、79 个断言、4.63 秒**。状态专项 9 项全部通过；Desktop 工具清单测试未显式开启 Memory 却仍预期 `memory`，上下文测试同样未开启却预期笔记注入。两处测试准备仍假定旧的默认开启行为，需修正并核验开启/关闭两套契约，当前未修改断言或将失败忽略。日志 `/tmp/apexo-gap-current-memory-audit.log`。

复核已有 `/tmp/apexo-memory-mode-types-all.log`：全仓 typecheck 21/21 通过。静态 `schemas/config.json` 的 Memory 描述仍写默认开启，与当前 `ConfigMemory` 不一致，待按生成流程同步。Memory 启停的 CLI、打包 Desktop、生产 UI/PTY 和官方专项均尚未完成，上一节 Memory 浏览管理的通过结果不能代表这个新增量。

本次更新差距文档和总表，明确剩余 Goal、Workflow、Memory V2/高级排序/保存审阅/整理状态、图片编辑与快捷命令、Shell 配置兼容、Desktop profile 设置、OS sandbox、官方 Hooks、`/btw` 与反馈草稿。未重新运行完整三端套件，未提交、推送或合并。

### Memory 会话启停：指定三端场景完成

2026-10-13：完成共享 `SessionMemoryMode`、持久会话覆盖、HTTP status/toggle、CLI mini/fullscreen `t` 键及 App 控件。开关只作用于当前会话，不修改默认配置；新会话读取进程/配置默认值。默认关闭，进程强制关闭优先，随后为会话覆盖、显式环境变量、配置、默认值。`GROK_MEMORY` 支持官方数字及 true/false、yes/no、on/off、enabled/disabled 拼写，忽略大小写及首尾空白；CLI `--no-memory` 已实测。旧开发期 pending 状态通过后续迁移取消，不会在升级后意外启用。

最初依照指南实现了忙碌时排队启用，但官方 1.0.52 实测返回拒绝；源码 `acp_session_impl/memory_control.rs` 同样要求当前轮次结束后重试。另实测官方 `[memory] enabled = false`、`GROK_MEMORY=1` 时仍启用，与 `xai-grok-config/src/resolved.rs` 的环境变量优先策略一致。已按实际源码/安装版修正服务和 UI，并删除自动排队路径。指南中相反或含糊的描述不能覆盖这些运行证据。

关闭会话记忆会取消正在执行的 Memory 工作，禁止旧版本提交，并从后续模型请求移除 Memory 工具及缓存注入；现有笔记保留。真实挂起自动摘要后关闭、重新开启，再释放旧摘要，CLI/Desktop 均确认旧内容未写回，新轮摘要正常保存。工具清单 API 新增 Session 参数后，进一步修复会话权限过滤，禁止读的会话不会公布检索工具，启用 Memory 也不会越过读权限。

| 检查 | 最终结果 | 日志 / 证据目录 |
| --- | --- | --- |
| CLI 启停 API 与实际模型请求 | 23 场景，包括默认关闭、工具/上下文、文件保留、会话隔离、实例重载、忙碌拒绝、配置优先级和 `--no-memory` | `/tmp/apexo-memory-mode-busy-cli.log`；`apexo-shell-cli-D6XvH6` |
| Desktop 同场景 | 最终 Electron 打包后端 22 场景，CLI 专有参数另列 | `/tmp/apexo-memory-mode-final-desktop.log`；`apexo-shell-desktop-XIZg54` |
| 官方安装版 | 11 项实际启停对照，另 7 次既有文件读取；运行的是官方 V2 存储 | `/tmp/apexo-memory-mode-official-busy.log`；`apexo-memory-official-WWutmS` |
| CLI mini / fullscreen PTY | 各 12 场景，包含默认关闭、`t` 开关、保留文件、无需模型，以及原有浏览删除 | `/tmp/apexo-memory-mode-mini-fixed.log`、`/tmp/apexo-memory-mode-fullscreen.log`；`apexo-shell-cli-Tp27gZ`、`apexo-shell-cli-WgXxTX` |
| 生产 App 接 CLI / Desktop | 各 15 场景，包含忙碌提示、按钮禁用、空闲后重试及原有管理流程；Desktop 忙碌截图已查看 | `/tmp/apexo-memory-mode-final-ui-{cli,desktop}.log`；`apexo-shell-cli-QHel1A`、`apexo-shell-desktop-KhUrLa` |
| 自动 flush | 两端各 15 场景，新增关闭/重开时拒绝旧模型结果 | `/tmp/apexo-memory-mode-flush-{cli,desktop}.log`；`apexo-shell-cli-uajCpQ`、`apexo-shell-desktop-g7NgP6` |
| 自动会话记录 | 两端各 12 场景 | `/tmp/apexo-memory-mode-session-{cli,desktop}.log`；`apexo-shell-cli-jyDpfJ`、`apexo-shell-desktop-MdN9Il` |
| 旧 CLI 清理入口 | 两端各 19 个非 Git 场景，包括取消、作用域、运行中缓存及旧 idle 定时器 | `/tmp/apexo-memory-mode-clear-{cli,desktop}.log`；`apexo-shell-cli-qD0vvY`、`apexo-shell-desktop-g2ScMb` |
| 既有工具链 | 相同受限权限配置下两端各 26 步通过；Desktop 另有 Shell、stdout/stderr Monitor、Scheduler 四类空闲唤醒 | `/tmp/apexo-memory-mode-parity-{cli,desktop}-final.log`；`apexo-grok-parity-cli-eK8a9f`、`apexo-grok-parity-desktop-bCdifs` |
| 受影响综合回归 | 318 通过、7 既有跳过、1 既有 todo、0 失败；1250 断言，18 文件，69.24 秒 | `/tmp/apexo-memory-mode-final-unit.log` |
| 公共契约与类型 | HTTP API coverage/auth/effect 各 212 通过；全仓 typecheck 21/21；Client 生成及数据库迁移检查通过 | `/tmp/apexo-memory-mode-final-{httpapi,types,client,migration}.log` |
| 生产构建 | 最终 App/Desktop 构建通过，SDK 与静态配置 schema 已生成 | `/tmp/apexo-memory-mode-final-{app,desktop}-build.log` |

运行入口为 `grok-memory-mode.mjs cli|desktop`、`grok-memory-browser-ui.mjs cli|desktop`、`grok-memory-browser-tui.mjs [--fullscreen]`；官方为 `grok-memory-scopes-official.mjs --toggle`。文件均在 `packages/apexo/script`。证据目录父路径同上一节，使用隔离 HOME、临时目录和本地可控模型端点，不代表真实模型质量或生产凭据调用。

同一生产空会话性能基准，10 次 reload 丢弃前 2 次：上一阶段 median/p95 **136.35/202.02ms**，本次 **141.68/154.37ms**，不能从单次小样本推断稳定提速或退化。日志 `/tmp/apexo-memory-browser-verified-benchmark.log`、`/tmp/apexo-memory-mode-final-benchmark.log`，本次目录 `apexo-shell-cli-dhC8jL`。

失败记录保留：初次权限隔离断言揭示工具清单未过滤会话权限，修复后通过；最初官方忙碌断言基于错误假设，已按源码和返回消息修正；PTY 对增量重绘的纯文本匹配超时，改为先核验真实 API 状态并触发完整重绘，原按键和管理断言保留。Desktop 工具链曾误用 Bun 导致 `node:sqlite` 无法加载，未执行工具步骤；正确命令应使用 Electron 自带 Node。没有把这些失败隐藏或当成最终通过。

新提示英文和中文使用新增 key，既有英文文案保持不变；简体中文“启用/禁用/等待”沿用 [Firefox zh-CN](https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/zh-CN/browser/browser/preferences/preferences.ftl) 与 [Nextcloud zh-CN](https://raw.githubusercontent.com/nextcloud/server/master/core/l10n/zh_CN.json) 的术语核对。当前接入复用现有 App legacy/V2 入口，实际浏览器只验收当前 V2 界面；原生 Desktop、legacy 完整交互、Windows/Linux 仍待验。独立 V2 SessionRunner、Memory 保存审阅/V2/高级排序，以及 Goal/Workflow 等完整目标继续推进；Marketplace 暂缓。没有提交、推送或合并。

### Plugins：推荐商城、自定义安装与三端管理

2026-10-13：用户将此前暂缓的 Marketplace 纳入范围，并要求改名 **Plugins**、处理多语言，Desktop 采用应用商城界面。本节覆盖此前的暂缓决定。具体操作与兼容边界见 [Plugins 功能文档](./plugins-feature.md)，词条和语料见 [本地化复核](./plugins-localization-review.md)。

Desktop 新增主页侧栏、设置和命令面板入口，提供卡片商城、搜索、来源筛选、发现/已安装/来源视图、详情与能力清单。推荐目录使用真实 xAI 官方源；用户也可添加自己的目录，或从 Git/本地插件目录直接安装。下载只保存快照，安装和更新需显式信任；两端共享注册表、不可变安装目录和运行时转换。支持启用、禁用、更新、卸载；更新失败保留旧版本，禁用插件更新后保持禁用。已下载内容可离线安装。应用到当前项目时检查会话与后台任务，忙碌返回 409，不终止现有任务。

新增 `apexo plugins` 命令及 `/plugins` 交互面板，mini/fullscreen 共用管理组件。加载 Skills、Commands、Agents、MCP、LSP；插件包内 command/HTTP Hooks 支持六类事件及基本拒绝/附加上下文，执行限时且清理子进程。没有声称完整 Hooks、manifest 或组织策略等同官方。原有 npm runtime plugin 机制仍独立。

| 检查 | 结果 | 日志 / 证据目录 |
| --- | --- | --- |
| CLI 共享 API 与原生命令 | 15 项，含安装状态、命名空间、更新、来源移除、运行中任务禁止重载及 `--installed --json` | `/tmp/apexo-plugins-cli.log`；`apexo-shell-cli-TJJGdH` |
| Electron 打包后端 | 对应 13 项，CLI 专有参数另列 | `/tmp/apexo-plugins-desktop.log`；`apexo-shell-desktop-ETf1gb` |
| 官方安装版 1.0.52 | 10 项来源与安装生命周期对照 | `/tmp/apexo-plugins-official.log`；`apexo-plugins-official-ZVF0TK` |
| 真实官方推荐源 | CLI / Electron 均读取 31 项并下载固定版本 Neon，未信任且未启用 | `/tmp/apexo-plugins-recommended.log`、`/tmp/apexo-plugins-recommended-desktop.log`；`apexo-shell-cli-nojsiw`、`apexo-shell-desktop-oJnIU1` |
| mini / fullscreen 真实 PTY | 各 8 项，含 `/plugins`、下载、信任、安装、启停、详情和卸载，无模型调用 | `/tmp/apexo-plugins-tui-{mini,fullscreen}.log`；`apexo-shell-cli-AoDLuE`、`apexo-shell-cli-Vtw5SW` |
| 生产 App 接 CLI / Electron | 最终两端各 24 项通过，含下载后 README 即时刷新、自行安装、更新、来源管理、10 种语言、RTL 与窄屏 | `/tmp/apexo-plugins-ui-{cli,desktop}-final.log`；`apexo-shell-cli-1g2IX0`、`apexo-shell-desktop-SCoFHL` |
| 原生 Electron 窗口 | 最终构建 8 项，覆盖 preload/IPC/sidecar、主页商城、设置商城、下载、安装、中文与真实官方推荐列表 | `/tmp/apexo-plugins-native-final.log`；`apexo-shell-cli-jgwkU6` |
| 插件存储/运行时专项 | 10 通过、43 断言，含真实命令/HTTP Hooks、超时杀子进程、失败更新、目录与信任边界 | `/tmp/apexo-plugins-unit.log` |
| HTTP API | coverage/auth/effect 各 216 通过、无失败/跳过/缺项 | `/tmp/apexo-plugins-httpapi.log` |
| 类型/生成 | 全仓 21/21 通过；Client 生成检查与 legacy SDK 生成通过；README 最后修正另通过 App 类型检查 | `/tmp/apexo-plugins-all-types-final.log`、`/tmp/apexo-plugins-generated-check.log`、`/tmp/apexo-plugins-sdk-generate.log`、`/tmp/apexo-plugins-app-types-final.log` |
| 全仓测试 | 最终 3568 通过、19 跳过、1 todo、0 失败；266 文件、51 快照、10227 断言，Turbo 4/4。首轮帮助快照未纳入 Memory 参数，已更新并补 Plugins/Memory 命令覆盖 | `/tmp/apexo-plugins-all-tests.log`、`/tmp/apexo-plugins-help-update.log`、`/tmp/apexo-plugins-all-tests-final.log` |
| App 单元测试 | 当前 `test:unit` 只收集 1 文件，2 通过、12 断言；不能作为完整 UI 验收 | `/tmp/apexo-plugins-app-unit-final.log` |
| 生产构建 | App 与 Desktop 构建通过，包含最后 README 刷新修正 | `/tmp/apexo-plugins-app-build-final.log`、`/tmp/apexo-plugins-desktop-window-build-final.log` |

证据目录父路径为 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`，日志也可能显示 `/var/` 别名。最终原生窗口中文截图 `apexo-shell-cli-jgwkU6/plugins-native-recommended-zh.png` 已视觉检查。所有测试使用隔离 HOME/注册表；原生测试单独启动自己的 Electron，不重启用户正在使用的应用。第三方推荐只验收到读取和下载，不使用用户服务凭据，也不声称 31 个第三方插件的外部服务都已验证。

新增 41 个 UI 词条；62 种语言都有本地化名称，57 种完整覆盖。`fo`、`dv`、`tk`、`am`、`dz` 正文保留英文回退，尚无可靠语料支撑的完整翻译；其余翻译仍需母语复核。第三方名称、介绍和类别属于源元数据，保留原文。

性能使用 agent-browser 配合浏览器内时钟，10 次空会话 reload、丢弃前 2 次，中位数 **152ms**、p95 **243ms**，日志 `/tmp/apexo-plugins-benchmark.log`，目录 `apexo-shell-cli-8sD48j`。前一阶段 **141.68/154.37ms** 使用 Playwright 外部时钟，测量边界不同且样本少，不据此宣称稳定提速或退化。商城延迟加载，不在关闭时下载推荐目录。该测量早于最后只影响打开状态的 README 刷新修正。

失败与修正记录保留：CLI 已安装 JSON 列表过滤、mini 的生命周期参数转发、全屏测试误匹配会话标题、浏览器来源按钮滚动和 macOS 路径规范化、原生调试端口覆盖，以及目录名 `xai-official` 被测试误写为 `xAI` 均已修正。最后补测发现 Solid store 保留对象引用导致下载后 README 不刷新，改为显式跟踪选择 ID 与快照路径，并保留“无需重新打开详情”的回归断言。

剩余边界：完整官方 Hooks/组织策略/manifest 变体、5 种语言正文与母语审校、Windows/Linux 原生窗口、ZIP 导出/远程文件取回、历史快照清理。其他章节列出的 Memory V2、Goal、Workflow 等整体差距仍未完成。当前没有提交、推送或合并。

### Memory：保存前审阅、可选改写与确认

2026-10-13：交互式 `/remember <内容>` 直接打开原文审阅，同时请求独立改写；原文始终是默认保存版本，改写失败不丢失草稿。无参数时打开编辑器；用户可以编辑、审阅、在原文和改写之间切换、取消，或明确保存到全局/工作区。App 使用按钮和选择框；CLI mini/fullscreen 使用同一审阅组件，`Ctrl+S` 从编辑进入审阅、`Tab` 切换版本、`g/w` 选择作用域、`Enter/y` 保存、`Esc` 取消。新建全屏会话的入口同时导航到创建的会话，避免留下无法继续的空会话。

新增共享 `MemoryReview` 存储和 `/experimental/session/:sessionID/memory/remember|rewrite` API。改写调用不注册工具，也不写主会话消息；保存不调用模型。手动保存允许会话自动 Memory 关闭，但不能越过进程强制关闭、会话权限和当前项目边界。保存采用范围锁、文件锁和原子替换，检查外部编辑冲突、路径别名、符号链接、非空内容和 32 KiB UTF-8 上限；已有文件超过 1 MB 时拒绝继续追加。取消审阅或改写不会保存选定文本。App legacy/V2 及 CLI 两种界面均接入，实际浏览器验收使用当前 V2 界面。

官方基线仍为安装版 `1.0.52 (0920c8169e27)` 和源码 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`。本轮除了实际 ACP 改写接口，还启动官方全屏终端，确认原文默认、可选改写、取消与选择后保存。官方安装版实际写入 `memory-v2/global/observations/_inbox`；Apexo 此阶段保存既有 `MEMORY.md`，不能将相同审阅交互扩大为相同存储协议。官方改写使用 `grok-4.6`，本地使用会话最近选择的模型或默认模型；官方无会话时可只审阅原文，本地当前入口需要先建立会话。`/flush`、`/dream` 专用状态以及 V2 观察和整理事务仍继续推进。非交互 `apexo run` 的模型命令不提供此审阅界面。

| 检查 | 最终结果 | 日志 / 证据目录 |
| --- | --- | --- |
| CLI 实际 API | 11 项，包含无主轮次/工具、原文默认全局、工作区隔离、自动记忆关闭时手动保存、并发、空值/UTF-8 上限、权限和取消 | `/tmp/apexo-memory-review-cli.log`；`apexo-shell-cli-aFp649` |
| 最终 Electron 打包后端 | 相同 11 项通过 | `/tmp/apexo-memory-review-desktop-final.log`；`apexo-shell-desktop-XMQr23` |
| CLI mini / fullscreen 真实 PTY | 各 10 项通过；编辑、预览、取消、原文/改写确认及作用域隔离 | `/tmp/apexo-memory-review-tui-{mini,fullscreen}-final.log`；`apexo-shell-cli-PYx5lp`、`apexo-shell-cli-ujBKrB` |
| 生产 App 接 CLI / Electron | 各 11 项通过，包含中文文案；Desktop 中文截图已查看 | `/tmp/apexo-memory-review-ui-{cli,desktop}.log`；`apexo-shell-cli-JHwNzZ`、`apexo-shell-desktop-p66zSW` |
| 官方实际接口及终端 | 改写接口 4 项、终端 5 项，另 7 次原有读取对照；确认取消未写入 V2、默认保存原文以及保存选定改写 | `/tmp/apexo-memory-review-official-tui.log`；`apexo-memory-official-GYpvj8` |
| 存储及相关回归 | 初始存储/目录 10 通过、55 断言；最终相关 49 通过、5 既有跳过、0 失败、241 断言 | `/tmp/apexo-memory-review-unit.log`、`/tmp/apexo-memory-review-regression.log` |
| 类型与公共契约 | 全仓 typecheck 21/21；HTTP API coverage/auth/effect 各 218 通过；Client 生成检查及 legacy SDK 生成通过 | `/tmp/apexo-memory-review-all-types.log`、`/tmp/apexo-memory-review-httpapi.log`、`/tmp/apexo-memory-review-generated-check.log`、`/tmp/apexo-memory-review-sdk.log` |
| 最终生产构建 | App、Desktop 通过 | `/tmp/apexo-memory-review-{app,desktop}-build-final.log` |

证据目录父路径为 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`；均使用隔离配置、存储及本地可控模型端点。测试只验证协议和交互，不评判真实模型改写质量，不代表 Windows/Linux 或本项原生 Electron 窗口已验收。Plugins 上一节的原生窗口结果仅属于 Plugins。

同一 agent-browser 生产空会话基准，10 次 reload 丢弃前 2 次：修改前 median/p95 **138.5/220ms**，修改后 **123/132ms**。日志 `/tmp/apexo-memory-review-baseline.log` 和 `/tmp/apexo-memory-review-benchmark-final.log`，目录 `apexo-shell-cli-1OUJyJ`、`apexo-shell-cli-iAmeLB`。样本少，仅能说明本次未观察到退化，不能推断稳定提速。

保留失败原因：初次浏览器使用不受支持的文本选择器，中文断言读取了正文而非标题；PTY 差量重绘会省略未变化字符，改用可观测的就绪提示；全屏空参数命令先经过补全，脚本明确输入带空格的命令；官方终端测试先等待会话建立，并将存储检查扩展到实际 `memory-v2` 目录。原始功能断言没有移除，最终均通过。

本项新增 App 英文及简体中文词条，其他语言使用现有英文回退。简体中文“预览/保存/编辑/原始/取消”沿用 [Firefox 简体中文语料](https://github.com/mozilla-l10n/firefox-l10n/tree/main/zh-CN) 和 [VS Code 简体中文语料](https://github.com/microsoft/vscode-loc/tree/main/i18n/vscode-language-pack-zh-hans) 核对；“记忆笔记/改写”属于本产品上下文，仍需母语审阅。此覆盖不能与上一节 Plugins 的 57 种完整翻译混为一谈。当前没有提交、推送或合并，整体目标尚未完成。

### Memory：手动提取与整理的进度、取消和结果

2026-10-13：交互式 `/flush` 和 `/dream` 打开独立操作面板，显示正在提取/整理，以及完成、无需处理、Memory 关闭、忙碌、权限拒绝、冲突、取消、失败或超时结果。成功时显示实际保存路径及返回的记录数/字符数。关闭面板不取消任务，从 `/memory` 的操作入口重新打开可查看同一任务；显式取消会中断任务，取消后可重试。mini/fullscreen 共享终端组件，App legacy/V2 共用操作入口。命令不加入主会话消息，不占用主模型轮次。

新增共享 `MemoryWork` 契约及 `SessionMemoryWork` 服务，通过 `GET/POST /experimental/session/:sessionID/memory/operation` 查询/启动，`POST .../operation/cancel` 按操作 ID 取消。同会话相同类型的并发启动返回同一操作，另一类型返回冲突；按会话和项目隔离，删除会话会取消在途操作。操作状态属于当前实例内的进程状态，服务重启后不恢复；自动 flush/dream 不计入这个手动操作记录。关闭面板只取消客户端请求和轮询，已启动服务端任务继续执行。

手动启动可以越过自动 flush/dream 的开关和时间/数量门槛，仍遵守 Memory 会话开关、进程配置、读取/写入权限和前台忙碌约束。已有保存记录允许在当前会话无历史消息时手动 dream。模型输出无效 Markdown 或被截断时返回失败并保留旧笔记；`NO_REPLY` 单独记为无需处理。取消保护覆盖模型仍在执行时的迟到结果，已经原子提交的文件不会因随后取消而回滚。现阶段仍使用 legacy 风格的记忆文件和整理流程，不等同于官方 Memory V2。

| 检查 | 最终结果 | 日志 / 证据目录 |
| --- | --- | --- |
| CLI 实际 API | 24 项，包括空历史、禁用、同类加入/异类冲突、会话隔离、取消重试、权限、无主轮次、无效/截断输出及删会话取消 | `/tmp/apexo-memory-work-cli-final.log`；`apexo-shell-cli-9jKhSC` |
| Electron 打包后端 | 相同 24 项通过 | `/tmp/apexo-memory-work-desktop-final.log`；`apexo-shell-desktop-1yFKVC` |
| CLI mini / fullscreen 真实 PTY | 各 10 项通过，校验完整终端画面、关闭继续、重新打开、取消、重试、落盘及无主轮次 | `/tmp/apexo-memory-work-{mini,fullscreen}-final.log`；`apexo-shell-cli-yLRVut`、`apexo-shell-cli-HrWa0C` |
| 生产 App 接 CLI / Electron | 各 12 项通过，含中文、关闭重开、取消、保存和禁用结果 | `/tmp/apexo-memory-work-ui-{cli,desktop}.log`；`apexo-shell-cli-haH66C`、`apexo-shell-desktop-kvPpWw` |
| 官方安装版实际接口及事件 | 7 项操作对照通过，含关闭结果、flush 结果、dream 无工作/完成计数及两类 started/completed 通知；另有 7 次读取回归 | `/tmp/apexo-memory-work-official.log`；`apexo-memory-official-exs7Rv` |
| 既有自动流程回归 | CLI 自动 flush 15 项、Desktop 自动 dream 20 项通过 | `/tmp/apexo-memory-work-flush-cli.log`、`/tmp/apexo-memory-work-dream-desktop.log`；`apexo-shell-cli-uFyQdS`、`apexo-shell-desktop-SlFM0a` |
| 契约及相关单元/集成测试 | 使用仓库 `bun run test`：59 通过、5 既有跳过、0 失败，7 文件、274 断言 | `/tmp/apexo-memory-work-unit-ci.log` |
| 类型与公共契约 | 全仓 typecheck 21/21；HTTP API coverage/auth/effect 各 221 通过；Client 生成检查及 legacy SDK 生成通过 | `/tmp/apexo-memory-work-all-types.log`、`/tmp/apexo-memory-work-httpapi.log`、`/tmp/apexo-memory-work-generated-check.log`、`/tmp/apexo-memory-work-sdk.log` |
| 生产构建 | App、最终 Desktop 均通过；最终 Desktop 包含全屏 `/memory` 拦截修正 | `/tmp/apexo-memory-work-app-build.log`、`/tmp/apexo-memory-work-desktop-build-final.log` |

证据目录父路径为 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`。Desktop 生产浏览器中文截图 `apexo-shell-desktop-kvPpWw/memory-work-zh.png` 已视觉检查。本项使用打包 Desktop 后端和生产 App 浏览器，没有新增原生 Electron 窗口、legacy 输入框完整交互或 Windows/Linux 验收；官方本轮是实际接口及通知验证，不是官方终端操作验证。此前 Plugins 的原生窗口验收不适用于本项。

官方基线仍为 `1.0.52 (0920c8169e27)` 与源码 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`。官方 V2 flush 是等待观察入队/持久化的 barrier，可能无新增内容也返回 `flushed`；本地 flush 提取 legacy 增量知识，无新增历史返回 `no_work`。官方 dream 实测处理 1 条观察并影响 1 个主题，本地显示的是处理记录和写入字符数量；不能把这些结果单位或存储协议称为完全一致。V2 观察队列、主题事务、重启恢复与高级检索仍未完成。

保留发现及修复：全屏直接提交带空格的 `/memory` 原先落入模型命令，现按 trim 后的内置命令拦截，并保留“不新增主消息”的 PTY 断言；无效 dream 输出原先被记为无需处理，现返回失败；被截断的 flush/dream 输出不再提交。旧自动 dream 测试尝试在 Memory 关闭后调用已隐藏的模型工具，改为通过实际操作 API 验证禁用结果、无模型请求及文件不变。

终端差量重绘曾让去 ANSI 后的字符串断言误报，新增固定版本的测试依赖 `@xterm/headless@5.5.0`，由完整终端缓冲区检查界面，并同时保存 ANSI 和最终文字画面。测试曾以直接 `bun test` 错用默认 5 秒超时，出现 read-only/worktree 场景超时；单文件原超时重跑 5 项通过，最终统一使用仓库已有 `bun run test` 的 30 秒 CI 配置通过，未改变测试超时配置或删除断言。

本项新增 19 个英文及简体中文词条，其他语言使用现有英文回退；CLI 沿用英文界面。简体中文“提取/整理/权限/超时”等词与前述 Firefox/VS Code 语料核对。Plugins 的多语言覆盖仍单独统计。未提交、推送或合并；整体目标继续保持未完成。

同一 agent-browser 生产空会话基准，10 次 reload 丢弃前 2 次：修改前 median/p95 **121.5/130ms**，修改后 **117.5/147ms**。日志 `/tmp/apexo-memory-work-baseline.log` 和 `/tmp/apexo-memory-work-benchmark-final.log`，目录 `apexo-shell-cli-VkYBq7`、`apexo-shell-cli-S3W9Gn`。中位数略降、p95 略升，样本不足以推断稳定变化。

### Memory V2：捕获存储与持久提交基础（整项实施中）

2026-10-13：新增 Core 的 `MemoryV2` 和 `MemoryCapture`。完整 V2 完成条件单列在 [实施契约](./memory-v2-feature.md)，包括模式配置、每轮采集、worker、flush barrier、多主题整理、管理/上下文、维护和高级检索。本阶段没有把生产 Memory 切换到新模块；现有产品入口继续使用 legacy。V2 整项仍未完成。

已实现固定 transcript 的幂等 admission、冲突范围拒绝、独立进程租约、过期重领与旧 owner/token/attempt 隔离、可重试/永久失败、严格观察 JSON 解析、不可变 Markdown、持久发布日志、中英文 FTS、manifest 和连续 requested/captured/indexed 游标。数据库与文件之间通过持久提交日志恢复；进程在文件发布前或 manifest 收敛前退出，重开继续已有提交而不重新提取。已有内容被删除、编辑、改成过大文件或符号链接时保留用户改动并排除索引，不复活旧结果。隐藏观察不进入 manifest/FTS，显式提升覆盖已提交和运行中的任务。

Apexo 使用 `~/.grok/memory-v2/apexo/` 独立命名空间，避免自己的状态表或生成 manifest 覆盖已安装 Grok 客户端；全局/项目作用域、Project ID 共享及非 Git 目录隔离已有测试。当前索引与队列共用 SQLite，提交摘要采用 SHA-256，与官方 SQLite/路径格式不互换。目录和数据库替换、路径链接、UTF-8 上限、文件原子发布均已验证。当前保留量有显式上限，保留期清理与网络文件系统策略仍须补齐后再完成生产集成。

| 检查 | 最终结果与范围 | 日志 / 证据目录 |
| --- | --- | --- |
| 捕获存储专项 | 15 通过、0 失败、92 断言；实际 SQLite 与文件，未 mock 存储 | `/tmp/apexo-memory-v2-capture-tests.log` |
| 捕获 + 既有检索/会话回归 | 29 通过、0 失败、175 断言，3 文件；包含最后有界读取修改 | `/tmp/apexo-memory-v2-regression.log` |
| Bun CLI 运行时进程 | 10 项通过；真实 SIGKILL、持久租约、进程竞争、两处提交中断、索引恢复、保留已有笔记、删除不复活 | `/tmp/apexo-memory-v2-process-cli-final.log`；`apexo-memory-capture-cli-8VLSsM` |
| Electron 运行时进程 | 同样 10 项；Electron 42.3.3 / Node 24.15.0 / SQLite 3.51.3 | `/tmp/apexo-memory-v2-process-desktop-final.log`；`apexo-memory-capture-desktop-CsyR0t` |
| 官方固定源码 | `cargo test -p xai-grok-memory --lib v2_capture --locked`：41 通过、0 失败 | `/tmp/apexo-memory-v2-official-capture.log` |
| 官方安装版 barrier | 两次实际 V2 flush 返回 `flushed`，另 7 次已有读取对照 | `/tmp/apexo-memory-v2-official-installed.log`；`apexo-memory-official-VypDOM` |
| 官方安装版观察与整理 | 实际提取并持久化 1 条观察，随后整理影响 1 个主题；无工作分支及另 7 次读取对照通过 | `/tmp/apexo-memory-v2-official-installed-capture.log`；`apexo-memory-official-GVEmxK` |
| 官方数据库核对 | 7 个 capture job 均 completed/attempt=1，7 个 outcome、1 个观察；4 个会话的 requested/captured/indexed 分别同为 2/2/2/1 | `/tmp/apexo-memory-v2-official-state.json` |
| 类型与格式 | Core、Apexo 类型检查及 `git diff --check` 通过 | `/tmp/apexo-memory-v2-core-types-final.log`、`/tmp/apexo-memory-v2-apexo-types.log` |

证据目录父路径为 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`。Bun/Electron 测试直接运行同一 Core 存储模块，Electron 采用 `ELECTRON_RUN_AS_NODE`，只强制终止测试创建的进程。这些结果不包含尚未接入的 Apexo V2 会话、CLI 交互、Desktop 窗口或 API。官方源码的 41 项用于核对行为要求，不代替本地对应实现测试。

测试中修正了缺失测试 fixture 进程服务、Effect Result 字段读取错误，以及 inbox 整体暂时不可读时错误排除全部既有笔记的问题。最后一项已在两种运行时加入“恢复后原有笔记仍可检索”的断言。实际文件读取额外限制分配与读取字节数，避免只在读取前检查文件大小。

后续直接接入 Session 的 durable transcript、每轮 admission 与 worker；再将 V2 flush barrier、配置/会话开关、观察浏览和 Context Source 连通，完成多主题 Dream、维护与高级检索。此处未提交、推送或合并，完整目标保持进行中。

### Memory V2：生产会话捕获、后台提取与 flush 屏障（整项仍在实施）

2026-10-13：在前一阶段存储基础上接入 `SessionMemoryBackend`、`MemoryTranscript` 和 `SessionMemoryCapture`。新会话通过 `memory_v2.enabled` 显式选择 V2；数据库迁移将已有会话固定为 legacy。模式与 rollout 持久固定，当前配置只能收紧阶段；捕获与文件写入开关、进程/会话关闭及权限均限制在途提交。

合格轮次先入持久队列，再由独立 worker 发出无工具、JSON schema 的模型请求。固定来源按持久消息 ID 去重；文本有 UTF-8 上限，排除推理、图片字节、系统上下文和生成摘要；synthetic、子会话、命令和记忆关闭期间的轮次不进入观察。关闭期间保存消息边界，重新开启不会追溯提取。提取最多三次；过期 owner/attempt 不能提交，关闭记忆或项目会释放 lease。重新开启或打开会话恢复已入队提取，不启动主对话的历史模型执行。

V2 `/flush` 冻结 requested 目标，等待索引完成；重复等待不发起 legacy 摘要，后续用户输入不会扩大当前目标。操作取消只取消等待，后台捕获继续；可重新等待并查看已处理数量。空结果推进游标；永久失败返回 failed。V2 暂不接入 legacy dream、上下文、旧 memory 工具及管理写入，防止静默混用存储。V2 多主题整理、浏览/保存/删除/清理、上下文与维护将继续实现，完整契约没有缩减。

| 检查 | 结果与实际范围 | 日志 / 证据目录 |
| --- | --- | --- |
| CLI 真实会话 | 最终 16 项：独立后台请求、入队先于提取、JSON schema/零工具、索引屏障、无新增主消息、重复 flush、no-op、三次失败、子会话/synthetic 排除、禁用取消与自动恢复、禁用期间排除、权限拒绝、冻结目标、重开恢复 | `/tmp/apexo-memory-v2-session-cli-release.log`；`apexo-shell-cli-JvOr5Q` |
| 最终 Electron 后端 | 同样 16 项；最后仅来源字段精简后重新构建并重跑 | `/tmp/apexo-memory-v2-session-desktop-release.log`；`apexo-shell-desktop-ojWqei` |
| record_only | CLI / Desktop 各 17 项；额外确认观察落盘而 FTS/manifest 不曝光；此轮早于最后来源字段精简，后者另有专项与 active 复验 | `/tmp/apexo-memory-v2-record-cli-final.log`、`/tmp/apexo-memory-v2-record-desktop.log`；`apexo-shell-cli-jnZG69`、`apexo-shell-desktop-7MPxii` |
| 生产浏览器接 CLI / Desktop | 各 6 项：`/flush`、关闭重开同一屏障、取消等待再加入、真实保存与计数、不增加主轮次/提取请求、中文完成结果 | `/tmp/apexo-memory-v2-ui-cli.log`、`/tmp/apexo-memory-v2-ui-desktop.log`；`apexo-shell-cli-bqCfDR`、`apexo-shell-desktop-sVPfxH` |
| mini / fullscreen 真正终端 | 各 5 项：等待、关闭重开、取消再等待、完成数量、无额外主轮次与模型请求；使用 xterm 合成可见画面断言 | `/tmp/apexo-memory-v2-tui-mini.log`、`/tmp/apexo-memory-v2-tui-fullscreen.log`；`apexo-shell-cli-48sbKY`、`apexo-shell-cli-M2ZdEQ` |
| 官方安装版 1.0.52 | V2 两次 flush，含 through_turn=1，另 7 次读取；独立场景实际捕获 1 条观察并由 Dream 写入 1 个主题 | `/tmp/apexo-memory-v2-official-flush-final.log`、`/tmp/apexo-memory-v2-integration-official.log`；`apexo-memory-official-2jSLzf`、`apexo-memory-official-4gVSgB` |
| 捕获/模式/来源/LLM 适配专项 | 最终 44 通过、204 断言、0 失败；包括实际跨句柄幂等 admission、模式固定与 kill switch、UTF-8/来源字段过滤、native JSON schema 转交 | `/tmp/apexo-memory-v2-unit-release.log` |
| 受影响会话及 legacy 记忆 | 116 通过、1 既有跳过、0 失败；prompt、中断、旧上下文、dream、会话保存及操作契约。另一次工具/指令联合专项 74 通过、1 todo、0 失败 | `/tmp/apexo-memory-v2-session-regression.log`、`/tmp/apexo-memory-v2-integration-unit-final.log` |
| HTTP API | coverage/auth/effect 各 221 通过，无失败/跳过/缺项 | `/tmp/apexo-memory-v2-httpapi.log` |
| 类型、生成与迁移 | 全仓 21/21；最后来源字段精简后 Apexo 类型再验通过；Client 生成检查、legacy SDK/静态配置 schema 生成和迁移检查通过 | `/tmp/apexo-memory-v2-all-types-final.log`、`/tmp/apexo-memory-v2-types-release.log`、`/tmp/apexo-memory-v2-client-check.log`、`/tmp/apexo-memory-v2-sdk-generate.log`、`/tmp/apexo-memory-v2-config-schema.log`、`/tmp/apexo-memory-v2-migration-check.log` |
| 最终 Desktop 构建 | 含全部生产链路和来源字段精简，构建成功 | `/tmp/apexo-memory-v2-desktop-build-release.log` |

证据目录父路径为 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`。中文生产浏览器截图 `apexo-shell-desktop-sVPfxH/memory-capture-ui-zh.png` 已视觉核查。本地模型是可控端点，不代表真实模型记忆质量；官方安装版验证其真实协议与持久结果。此项没有新增原生 Electron 窗口或 Windows/Linux 验收，也没有重跑全仓单元测试来替代最终整体 CI。

性能用同一生产 App 与 agent-browser 计时，10 次 reload 去掉前 2 次。保留的改动前 Desktop 包基线 median/p95 **112/116ms**；最终包 **112.5/125ms**。基线采集时源码已编辑，但被测 Desktop 包仍是此前未包含本项的构建；两个包都使用相同前端。日志 `/tmp/apexo-memory-v2-baseline-ui.log`、`/tmp/apexo-memory-v2-final-ui-benchmark.log`，目录 `apexo-shell-desktop-0f5pYG`、`apexo-shell-desktop-9YT8Co`。这是小样本的会话打开测量，不用于断言稳定性能变化或模型提取延迟。

修正记录：首轮提取因观察时间误传毫秒被拒绝，已改为 Unix 秒；测试 fixture 的临时目录类型和状态 API 路径已修正。全仓类型首轮发现测试使用了错误的 Config.Info 导出，修正后 21/21 通过。额外补上禁用期间消息排除边界，避免重新开启时追溯提取；固定来源最后精简为必要身份、模型及有界 transcript。

下一阶段继续 V2 浏览/手动观察/删除与 clear generation、manifest/Context Source、多主题 Dream 和维护。独立 V2 SessionRunner 迁移、强杀后的生产恢复、超时/全部失败分类、完整原生窗口及跨平台继续保留为缺口。没有提交、推送或合并，完整目标仍在进行。

### Memory V2：多主题 Dream 存储事务（生产接入未完成）

2026-10-14：新增 Core `MemoryConsolidation`，与已有捕获和笔记管理共用 SQLite 及跨进程作用域锁。已实现不可变认领输入、有限租约和 token fencing、create/update/delete/rename/merge/split、严格 JSON/证据/预算校验、确定计划持久化、观察归档与索引收敛。发生失败时保留可恢复计划；改动过的输入或主题不被旧计划覆盖。后来到达的观察留给下一次整理，不被重放吞掉。

shadow 只验证隐藏捕获的计划并记录评估哈希，不发布主题或归档。清理删除 Dream 输入与计划，使旧租约失效；普通删除取消推理阶段的认领，持久提交阶段则返回 busy。新增预期哈希及发布前文件身份检查，创建使用不可覆盖的原子发布，减少与外部编辑冲突。完成回执不保留观察或主题正文。

| 检查 | 本轮最终结果 | 证据 |
| --- | --- | --- |
| Dream / 捕获 / 管理联合专项 | 32 通过、0 失败、224 断言，3 个文件；覆盖全部六种操作、冲突/证据/预算、shadow、权限、删除、清理和持久重放 | `/tmp/apexo-memory-v2-dream-unit-final.log` |
| Bun CLI 独立进程 | 8 项通过；真实 SIGKILL、活跃租约不被跳过、过期抢占、两个进程竞争、计划/归档后恢复、真实 SQLite 归档提交失败、清理与幂等 | `/tmp/apexo-memory-v2-dream-process-cli-final.log`；`apexo-memory-dream-cli-8UMdZF/evidence.json` |
| Electron Node/SQLite 独立进程 | 同样 8 项通过；现场编译当前 Core，使用 Electron 实际运行时和 SQLite | `/tmp/apexo-memory-v2-dream-process-desktop-final.log`；`apexo-memory-dream-desktop-zRptsH/evidence.json` |
| 官方固定源码 | `cargo test -p xai-grok-memory --lib v2_consolidation --locked`：31 通过、0 失败 | `/tmp/apexo-memory-v2-dream-official-unit.log` |
| 官方安装版 1.0.52 | 无工作返回 no_work；实际提取 1 条观察、单次无工具模型整理，影响 1 个主题；另 7 次读取通过 | `/tmp/apexo-memory-v2-dream-official-installed.log`；`apexo-memory-official-rL8PpV` |
| 类型与格式 | Core 类型检查通过；最终 Apexo 类型检查通过；新文件格式与 `git diff --check` 通过 | `/tmp/apexo-memory-v2-dream-core-types.log`、`/tmp/apexo-memory-v2-dream-types-final.log` |

证据目录父路径为 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`。故障脚本只终止自己创建的 worker；SQLite 触发器刻意拒绝归档行提交后，确认主题和归档文件已写入，再强杀进程、移除故障并恢复。

本轮没有改动 Session/时间线代码，不新增会话性能基线。没有修改公开 HttpApi，也没有执行完整全仓测试。**当前 V2 `/dream` 仍返回 disabled**：下一步必须连接无工具模型整理、手动/自动触发、门槛和各 kill switch、取消与进度结果，再跑 CLI 命令、Desktop 后端/原生窗口及官方完整对照。上述存储测试不等于这项完整功能已交付。未提交、推送或合并；完整目标继续进行。


## 2026-10-14：Memory V2 Dream 生产模型、自动触发与三端界面

本阶段把上一节的存储事务接入 `SessionMemoryV2Dream`。手动 `/dream` 已可执行；自动整理沿用官方 20 条观察或 24 小时年龄门槛，只整理 workspace。模型请求无工具、有严格 JSON schema，结果经验证后保存为持久计划再发布。运行期间新到观察在下一次整理处理；同实例队列合并唤醒，跨进程 lease 保持排他。

捕获完成、项目手动保存、会话打开/重新启用和周期检查均可唤醒。补齐捕获关闭时已有观察仍能恢复 Dream 的边界。捕获观察按 SQLite 提交时间计龄，兼容旧库自动增加可空字段，旧记录保留并回退文件时间；手动观察按文件时间计龄。没有增加主会话消息，也没有改变默认 legacy 存储选择。

新增 `memory_v2.manual_dream_enabled/automatic_dream_enabled/dream_model`。active 发布并归档，shadow 只验证隐藏捕获并去重，不写主题或归档；record_only/off 不整理。提交前重新校验模式 revision、kill switch、权限、阶段和输入。取消、禁用释放 lease。返回 `topics` 和 `shadow` 状态，App 与两种 TUI 显示主题/观察计数；App 新文案覆盖英文、简体中文，其他语言回退。Public Schema 已生成 Client 与 legacy SDK，静态配置 schema 同步。

### 运行与证据

下列命令使用 Bun 1.3.14。除全仓 Turbo 外从对应 package 执行；脚本默认从 `packages/apexo` 执行。隔离的本地模型服务提供确定性计划，验证真实执行与存储，不代表真实模型质量或在线 xAI 服务可用性。

| 范围 | 最终结果 | 命令与日志 |
| --- | --- | --- |
| CLI 生产会话 | 23 项通过：手动两主题、严格输出、全局隔离、归档、无主轮次、重复/无效计划、外部编辑、取消、禁用、权限、shadow、record_only、20 条/24 小时、并发到达、捕获触发、关闭捕获后的打开恢复、独立周期年龄检查、file writes 开关 | `bun script/grok-memory-v2-dream.mjs cli`；`/tmp/apexo-memory-v2-dream-session-cli-periodic.log`；`apexo-shell-cli-55VtQr` |
| 最终 Desktop 生产后端 | 相同 23 项通过，Electron Node/SQLite 实际运行时 | `bun script/grok-memory-v2-dream.mjs desktop`；`/tmp/apexo-memory-v2-dream-session-desktop-periodic.log`；`apexo-shell-desktop-cMi8Vp` |
| 生产浏览器 + Desktop 后端 | 8 项通过：命令、进度、关闭重开、取消重试、计数、落盘、无主轮次、no_work、中文结果（检查点有分组） | `bun script/grok-memory-work-ui.mjs desktop --v2-dream`；`/tmp/apexo-memory-v2-dream-session-desktop-ui2.log`；`apexo-shell-desktop-WiYW7T` |
| 真实 mini/fullscreen TUI | 各 7 项通过，实际 PTY 与组合终端屏幕 | `bun script/grok-memory-work-tui.mjs --v2-dream [--fullscreen]`；`/tmp/apexo-memory-v2-dream-session-mini2.log`、`/tmp/apexo-memory-v2-dream-session-fullscreen2.log`；`apexo-shell-cli-QjDHL7`、`apexo-shell-cli-MCTi8T` |
| 原生 macOS Desktop | 7 项通过，实际窗口/preload/sidecar；含取消重试、主题预览、中文结果，截图已查看 | `bun script/grok-memory-v2-native.mjs --dream`；`/tmp/apexo-memory-v2-dream-session-native.log`；`apexo-shell-cli-SGRI3m/memory-v2-native-dream-zh.png` |
| 官方 Grok 1.0.52 | no_work 后真实捕获并整理 1 条观察/1 个主题；整理请求 0 个工具，另 7 次读取通过 | `bun script/grok-memory-scopes-official.mjs --dream`；`/tmp/apexo-memory-v2-dream-session-official.log`；`apexo-memory-official-yDdp32` |
| Core 独立进程故障回归 | Bun 和 Electron 各 8 项通过：真实强杀、竞争认领、过期接管、持久计划重放、SQLite 归档提交故障、归档后恢复和清理 | `bun script/grok-memory-consolidation.mjs cli\|desktop`；`/tmp/apexo-memory-v2-dream-session-process-cli.log`、`/tmp/apexo-memory-v2-dream-session-process-desktop.log`；`apexo-memory-dream-cli-639kHi`、`apexo-memory-dream-desktop-5M3Atr` |
| 最终存储与契约专项 | 37 通过、246 断言；含旧 schema 升级、计数/年龄、文件触碰不重置捕获年龄、shadow 去重 | `bun run test test/tool/memory-consolidation.test.ts test/tool/memory-capture.test.ts test/tool/memory-v2-management.test.ts test/server/memory-work-contract.test.ts`；`/tmp/apexo-memory-v2-dream-session-unit-final.log` |
| 受影响 Memory/Session 回归 | 170 通过、1 既有 skip、1 既有 todo、0 失败，904 断言；最终打开恢复增量由上面的专项和 23 场景覆盖 | `bun run test test/tool/memory-*.test.ts test/session/prompt.test.ts test/session/instruction.test.ts test/server/memory-work-contract.test.ts`；`/tmp/apexo-memory-v2-dream-session-regression.log` |
| 类型与生成 | 全仓 typecheck 21/21；Client 生成校验、静态配置生成、legacy SDK 生成、App/Desktop 生产构建通过 | `/tmp/apexo-memory-v2-dream-session-types-final.log`、`/tmp/apexo-memory-v2-dream-session-generated-check.log`、`/tmp/apexo-memory-v2-dream-session-desktop-build-final.log`、`/tmp/apexo-memory-v2-dream-session-app-build.log` |
| HTTP API | coverage/auth/effect 各 221 通过、0 fail/skip/missing/extra | `bun run test:httpapi`；`/tmp/apexo-memory-v2-dream-session-httpapi.log` |

产物目录父路径均为 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`。早期 `session-cli.log` 到 `session-cli3.log` 的自动触发超时来自测试环境中的 `automatic_dream_enabled=false` 覆盖项目配置，修正夹具后通过。首轮 UI/TUI 脚本期待了错误的运行状态文案，按实际文案修正后通过；没有把这些失败记为产品缺陷。

性能对照使用同一 `grok-plugins-ui.mjs desktop --benchmark --benchmark-only` 协议，浏览器时钟从请求重载到输入框首次可见绘制，共 10 次，去掉前 2 次。修改前中位数 112ms、P95 120ms，最终构建为 121ms、126ms（+9ms/+6ms）；这是小样本本机测量，不据此宣称零回归，也不代表 Dream 模型耗时或含大量 V2 数据的性能。日志 `/tmp/apexo-memory-v2-dream-session-baseline.log`、`/tmp/apexo-memory-v2-dream-session-after-benchmark.log`；最终产物 `apexo-shell-desktop-KTPCF1`。

**仍未完成**：可选 batch Dream、维护/归档回收、完整 manifest/压缩索引、高级排序/向量、原生 V2 SessionRunner Context Source、持久操作面板，以及完整生产服务强杀/长超时/跨平台验收。此次强杀测试是 Core 独立进程，原生窗口测试是列明的 macOS 场景；不能合称完整 Memory V2 或全部差距已完成。未提交、推送或合并。全仓 CI 同款测试已完成：`GITHUB_ACTIONS=false bun turbo test --concurrency=2` 返回成功，3611 pass、19 skip、1 todo、0 fail，51 snapshots、10514 断言，273 个测试文件；Turbo 4/4 任务成功，用时 9m25s。日志 `/tmp/apexo-memory-v2-dream-session-ci-tests.log`。日志中的 attention 音频/通知异常来自专门验证错误处理的测试，不是失败结果。

## 2026-10-14：Plugins 商城当前分支复验

Desktop 当前代码重新构建后，CLI 生命周期 15 项、Electron 后端 13 项、官方 Grok 1.0.52 对照 10 项、原生 Electron 商城 8 项、mini/fullscreen 各 8 项和插件单元测试 10 项（43 断言）全部通过。界面源码没有 Marketplace 标签；62 种语言的入口名称完整，57 种覆盖全部 41 个新增词条，5 种正文沿用英文回退。

CLI 和 Desktop 实际读取官方推荐目录 31 项，下载 Neon 固定提交 `1b2e687e70734599fca8158722e8c12a0e07feef`，保持 downloaded / 未信任。原生中文推荐商城截图已查看，发现、已安装、来源、搜索、自行安装和推荐卡片正常显示。真实第三方服务授权、完整 Hooks、Windows/Linux 原生窗口仍不在此次验收范围。

日志 `/tmp/apexo-plugins-store-{cli,desktop,official,native-recommended,mini,fullscreen,recommended-cli,recommended-desktop,unit,types,desktop-build}.log`。类型检查 21/21。截图 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-QtPlNj/plugins-native-recommended-zh.png`。完整使用说明见 [Plugins 文档](./plugins-feature.md)。本次未提交、推送或合并。

## 2026-10-14：Memory V2 保留期回收与后台维护

新增 `MemoryRetention` 与 `SessionMemoryMaintenance`。默认归档 30 天、终态捕获任务 14 天，每类每批最多 256 项，剩余工作由后台队列继续处理。归档删除先记录不含正文的持久日志，经过路径、权限和内容哈希验证后删除文件，再清理数据库关联；数据库失败或进程中断可恢复。主题、全局记忆、隐藏/活跃观察、待执行和可重试任务保持。保留 admission 与游标，拒绝旧轮次重新入队。

旧库补充 `terminal_at`，已知时间沿用捕获提交时间，未知历史记录从升级开始计龄，重开不刷新。活跃 Dream 或尚待恢复的持久计划使回收延后；过期且尚无持久计划的推理允许回收。clear 一并删除回收日志。会话打开、重新启用、捕获完成、手动保存和 Dream 完成都能唤醒，另有默认每小时的空闲维护。捕获或 Dream 单独关闭不影响维护；session off、rollout off、file writes 关闭、权限拒绝均阻止删除。record_only/shadow 可清理终态任务而不曝光观察。

| 范围 | 结果 | 命令与证据 |
| --- | --- | --- |
| CLI 生产会话 | 17 项通过，包括默认保留期、独立开关、游标与 admission、主题/全局保留、无模型/主轮次、活跃观察、权限、Dream 延后及完成重调度、周期维护、record_only/shadow | `bun script/grok-memory-retention.mjs cli`；`/tmp/apexo-memory-v2-maintenance-cli2.log`；`apexo-shell-cli-biTgj7` |
| 最终 Electron 后端 | 相同 17 项通过，实际 Node/SQLite 运行时 | `bun script/grok-memory-retention.mjs desktop`；`/tmp/apexo-memory-v2-maintenance-desktop3.log`；`apexo-shell-desktop-OSWjKe` |
| Core 进程故障 | Bun / Electron 各 7 项通过：提交删除日志后强杀、文件删除后强杀、两个进程竞争只清理一次、活跃 Dream 延后、过期推理、clear 隔离和主题/索引保留 | `bun script/grok-memory-consolidation.mjs cli\|desktop --retention`；`/tmp/apexo-memory-v2-maintenance-process-{cli,desktop}.log`；`apexo-memory-retention-cli-cOeDCi`、`apexo-memory-retention-desktop-G22t7n` |
| 官方安装版 1.0.52 | 6 项保留期对照通过；零日归档及终态任务删除、关联行一致、新活跃观察和任务保留、主题保留、无多余 Dream；另有 7 次记忆读取 | `bun script/grok-memory-scopes-official.mjs --dream --retention`；`/tmp/apexo-memory-v2-maintenance-official-final.log`；`apexo-memory-official-Qeb8pe` |
| 官方固定源码 | 21 项维护测试通过 | `cargo test -p xai-grok-memory --lib v2_maintenance --locked`；`/tmp/apexo-memory-v2-maintenance-official-unit.log` |
| Core 联合单元测试 | 43 通过、284 断言、0 失败；新增归档/任务批次上限、升级时间稳定、真实 SQLite 删除失败重放、文件编辑和权限等测试 | `bun run test test/tool/memory-retention.test.ts test/tool/memory-consolidation.test.ts test/tool/memory-capture.test.ts test/tool/memory-v2-management.test.ts`；`/tmp/apexo-memory-v2-maintenance-unit-final.log` |
| Dream 生产回归 | CLI / Desktop 各 23 项通过 | `bun script/grok-memory-v2-dream.mjs cli\|desktop`；`/tmp/apexo-memory-v2-maintenance-dream-{cli,desktop}.log`；`apexo-shell-cli-TH0DI0`、`apexo-shell-desktop-ASmaDv` |
| 原生 macOS 窗口 | Dream 界面 7 项通过，确认新增后台维护不破坏取消重试、主题计数与预览、中文结果 | `bun script/grok-memory-v2-native.mjs --dream`；`/tmp/apexo-memory-v2-maintenance-native.log`；`apexo-shell-cli-MxC0vW` |
| 类型/生成/构建 | 全仓 21/21；新增测试后 Apexo 类型再验通过；Client 生成检查、legacy SDK/静态 config schema 生成和 Desktop 构建成功 | `/tmp/apexo-plugins-store-types.log`、`/tmp/apexo-memory-v2-maintenance-types-final.log`、`/tmp/apexo-memory-v2-maintenance-generated-check.log`、`/tmp/apexo-plugins-store-desktop-build.log` |

产物目录父路径为 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/`。官方安装版的维护后续任务由新观察落盘触发，noop flush 不触发；初版夹具等待 noop 导致超时，按源码核实并改为发布新观察后通过。Apexo 另有 Dream 完成、会话打开及周期唤醒，触发行为差异保留。Bun 只读连接在其他 SQLite 运行时移除 WAL 辅助文件后无法重新打开；测试改为打开已存在的隔离数据库并设置 `query_only`，没有更改产品数据库配置。早期脚本还遗漏显式 `readwrite` 选项，修正后通过；这些失败不作为产品缺陷报告。

本阶段没有新增 UI 或公开 HTTP API。完整健康状态、损坏原因展示、网络文件系统拒绝、原生 V2 Runner Context Source、压缩索引、高级检索、生产服务强杀的完整生命周期和全平台验收仍未完成。Core 进程强杀结果不等同于完整生产服务崩溃恢复。完整目标继续进行，未提交、推送或合并。

本轮 HTTP API 验收完成：`bun run test:httpapi` 的 coverage/auth/effect 三组各 221 pass，0 fail/skip/missing/extra；日志 `/tmp/apexo-memory-v2-maintenance-httpapi.log`。原生 Dream 中文完成截图 `apexo-shell-cli-MxC0vW/memory-v2-native-dream-zh.png` 已视觉检查。

全仓首轮记录：3618 pass、19 skip、1 todo、1 fail，失败为新增的 256 归档批次边界用例超过原有 30 秒时限。该用例原先逐条调用 remember，反复重建日益增大的索引；改为一次准备 260 个真实外部笔记，再通过实际发现、Dream 和回收流程验证相同 256+4 边界。没有放宽断言、增加超时或修改产品逻辑。修正后本文件 8 pass、49 断言、0 fail，用时 6.49 秒，日志 `/tmp/apexo-memory-v2-maintenance-unit-fast.log`；全仓复验结果以下方最终记录为准。

生产会话性能：同一 App 和 `grok-plugins-ui.mjs desktop --benchmark --benchmark-only`，浏览器计时重载到输入框首次可见绘制，共 10 次并排除前 2 次。基线 median/P95 为 113.5/119ms，最终 108/129ms；样本量小，不据此宣称稳定改善、零退化或大规模记忆场景性能。最终测量在全仓首轮退出后独立运行；日志 `/tmp/apexo-memory-v2-maintenance-{baseline,benchmark-final}.log`，产物 `apexo-shell-desktop-05j4jo`。

**最终全仓复验通过**：`GITHUB_ACTIONS=false bun turbo test --concurrency=2` 返回 0，3619 pass、19 既有 skip、1 既有 todo、0 fail，51 snapshots、10563 断言、274 个测试文件；Turbo 4/4 成功（3 项缓存），用时 9m44s。日志 `/tmp/apexo-memory-v2-maintenance-ci-tests-final.log`。修正后的 Apexo 类型检查 `/tmp/apexo-memory-v2-maintenance-types-release.log`、格式检查和 `git diff --check` 均通过。测试日志中的预期插件加载/音频异常来自错误处理测试，不是失败结果。保留首轮超时记录，不用最终通过覆盖其原因。以上是本地 CI 同款检查，未运行 GitHub PR 检查，也未提交、推送或合并。下一阶段继续维护诊断与剩余差距；Plugins 商城已完成此次请求范围，无需在没有相关改动时反复重做相同验收。


## 2026-10-14：Memory V2 内容无关的健康诊断

新增 `MemoryHealth` wire contract/Core 只读汇总、会话权限和启停检查、健康 GET API、`apexo memory status`、Desktop 中英文诊断页以及 mini/fullscreen `h`/`r`/Esc 入口。Client 与 SDK 已按生成命令更新。Dream 成功时间和再次检查标记使用原有 metadata 表保存，clear 同步移除；打开诊断不会消费标记、接管租约、迁移或恢复任务。

| 层级 | 结果与命令 | 证据 |
| --- | --- | --- |
| Core 真实 SQLite | 健康、Dream、保留期共 25 pass，157 断言；健康专项 5 项 | `/tmp/apexo-memory-health-unit3.log` |
| CLI | `bun script/grok-memory-health.mjs cli`，8 项 | `/tmp/apexo-memory-health-cli.log`，fixture `apexo-shell-cli-oeqmMr` |
| Electron 后端 | 同脚本 `desktop`，8 项；独立 CLI 与 HTTP scope 数据完全相同 | `/tmp/apexo-memory-health-desktop.log`，fixture `apexo-shell-desktop-rhd5RH` |
| 原生 macOS | `bun script/grok-memory-v2-native.mjs --health`，4 项，包含英文/中文、标题和无正文/模型调用 | `/tmp/apexo-memory-health-native2.log`，fixture `apexo-shell-cli-rnY3zu` |
| mini PTY | `bun script/grok-memory-health-tui.mjs`，6 项 | `/tmp/apexo-memory-health-mini-final.log`，fixture `apexo-shell-cli-iteCBo` |
| 全屏 PTY | `bun script/grok-memory-health-tui.mjs --fullscreen`，6 项 | `/tmp/apexo-memory-health-fullscreen6.log`，fixture `apexo-shell-cli-pr7WNg` |
| 既有 Dream 生产链 | `grok-memory-v2-dream.mjs cli|desktop` 各 23 项 | `/tmp/apexo-memory-health-dream-cli.log`、`/tmp/apexo-memory-health-dream-desktop.log` |
| 官方固定源码 | `cargo test -p xai-grok-memory --lib v2_maintenance --locked`，21 pass | `/tmp/apexo-memory-health-official-unit.log` |
| 官方安装版 | `grok-memory-scopes-official.mjs --dream --retention`，7 次读取、实际 Dream 和 6 项保留期检查 | `/tmp/apexo-memory-health-official2.log`，fixture `apexo-memory-official-REAnoe` |
| HTTP API | coverage/auth/effect 各 222 pass，0 fail/skip/missing | `/tmp/apexo-memory-health-httpapi.log` |
| 类型与生成 | 全仓 typecheck 21/21；Client check:generated、SDK 生成、App/Desktop 构建通过 | `/tmp/apexo-memory-health-typecheck-final.log`、`/tmp/apexo-memory-health-check-generated.log`、`/tmp/apexo-memory-health-sdk.log`、`/tmp/apexo-memory-health-app-build.log`、`/tmp/apexo-memory-health-desktop-build2.log` |

本轮真实修复：原生诊断页使用了不存在的作用域翻译键，视觉检查发现后改为已有“全局/工作区”词条，并加入标题断言。全屏弹窗以 `Show` 为根时切换健康视图会重建并重置状态，改为稳定 box 根节点，健康快捷键接入模态 keymap。此前单纯等待预览就绪不能修复，保留失败日志，不把这些运行计为通过。

测试夹具修正：损坏数据库用例原先仍留有能恢复原文件的 WAL；关闭连接、移除该隔离夹具的侧文件后再破坏主文件。PTY 改用 xterm 组合增量输出，避免把终端仅发出的改动字符误判为完整屏幕。官方数据读取偶发 SQLITE_BUSY，为该只读观察连接设置 5 秒 busy_timeout 后重跑通过，未改官方程序。

中文诊断截图：`/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-rnY3zu/memory-v2-native-health-zh.png`，已视觉检查。诊断页面和 CLI 的含义、权限与版本差异见 `docs/memory-v2-feature.md`。官方状态 API 使用秒，而本项目时间戳使用毫秒；观察年龄保持秒。安装版没有已验证的同名健康端点，源码字段对照与安装版实际读写/整理测试分别记录。

共享 TUI 修复后又跑过原有全屏记忆浏览 12 项（启停、过滤、预览、旧内容拒绝删除和确认删除），日志 `/tmp/apexo-memory-health-browser-regression.log`，fixture `apexo-shell-cli-yYTHL1`；TUI 最终类型检查通过，日志 `/tmp/apexo-memory-health-tui-types.log`。

最终本地 CI 同款全仓测试：3624 pass、19 skip、1 todo、0 fail，52 snapshots、10585 断言、275 文件，Turbo 4/4，11m12s。日志 `/tmp/apexo-memory-health-ci-tests.log`。全屏根节点的最后修复另通过 TUI 类型检查和真实 mini/fullscreen、旧浏览流程专项验收；没有提交、推送或合并。已安装 Grok 的 `grok memory --help` 实际只列出 clear/help，日志 `/tmp/apexo-memory-health-official-help.log`。

性能对照使用同一生产页面测量，从 reload 到首次可见输入框动画帧，10 次丢前 2 次：改动前 median 110ms / P95 115ms，最终 median 110ms / P95 114ms。日志 `/tmp/apexo-memory-health-baseline.log`、`/tmp/apexo-memory-health-benchmark-final.log`，最终 fixture `apexo-shell-desktop-foLj0R`。并行全仓回归期间的首次测量为 122ms / 152ms，保留 `/tmp/apexo-memory-health-benchmark-after.log`；测试结束后复测未见该差异，因此不将并行负载样本判为产品回归。该脚本本轮仅运行 `--benchmark-only`，不是重复的 Plugins 功能验收。


## Memory V2 实时捕获诊断（2026-10-14）

新增默认关闭的 `memory_v2.capture_status_enabled`；六阶段 `memory.capture.activity` 仅供当前兼容会话的实时客户端使用，未加入当前 Protocol ServerDefinitions，也没有 durable metadata。Core 入队结果返回本次实际创建的 job，避免重复 flush 重发 queued。成功通知只包含实际提交的观察路径和内容；失败不包含原始 provider 输出。发布前重新检查开关和模式，完成前后重新检查文件权限。详情、输出渠道和明确边界见 `docs/memory-v2-feature.md`。

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| CLI 真实服务 + SSE | 11 项通过，涵盖阶段顺序、文件正文、失败重试、模式/权限撤销和不持久化 | `/tmp/apexo-capture-status-cli2.log` |
| CLI 默认关闭 | 6 项通过，所有 capture 诊断均未发送 | `/tmp/apexo-capture-status-disabled.log` |
| Electron active | 11 项通过，同一契约及不持久化检查 | `/tmp/apexo-capture-status-desktop-active.log` |
| Electron record_only | 11 项通过，调试开关开启后能查看已保存的隐藏观察 | `/tmp/apexo-capture-status-desktop2.log` |
| 原生 macOS 窗口 | 4 项通过，运行/成功详情、刷新不重放、中文界面 | `/tmp/apexo-capture-status-native2.log` |
| mini / fullscreen 真实 PTY | 4 / 5 项通过，正文/路径、快捷键、关闭返回、不写入历史 | `/tmp/apexo-capture-status-mini.log`、`/tmp/apexo-capture-status-fullscreen.log` |
| Headless CLI | default / json / streaming-json 各 3 项通过 | `/tmp/apexo-capture-status-headless2.log` |
| Core capture 与事件清单 | 19 pass、111 断言 | `/tmp/apexo-capture-status-unit.log` |
| 终端控制字符隔离 | 1 pass、3 断言，保留多行中文并移除 ANSI/OSC/控制字符 | `/tmp/apexo-capture-status-formatter.log` |
| 官方固定源码 | 开关与不持久化测试 1 pass，wire 往返 2 pass | `/tmp/apexo-capture-status-official-source.log`、`/tmp/apexo-capture-status-official-wire.log` |
| 官方安装版 1.0.52 | 7 次读取、flush 与 Dream 成功；capture 通知 **partial / not_observed** | `/tmp/apexo-capture-status-official-probe.log` |
| 类型、生成与构建 | 全仓 typecheck 21/21，Client check:generated、App/Desktop 构建通过 | `/tmp/apexo-capture-status-typecheck-final.log`、`/tmp/apexo-capture-status-generated-check.log`、`/tmp/apexo-capture-status-app-build.log`、`/tmp/apexo-capture-status-desktop-build.log` |

官方安装版在显式开启 memory_v2 和 capture_status_enabled 后仍未发送捕获通知。对照脚本已兼容官方持久通知 `_x.ai/session_notification` 与固定源码临时通知 `x.ai/session_notification` 两种方法名，结果仍相同；不以更改断言把该缺项算成通过。探测结果单独为 partial；原始失败记录保留在 `/tmp/apexo-capture-status-official{,2,3}.log`。固定源码测试成功仅证明源码行为。

本轮修正了闭包中事件联合类型的收窄，以及测试清单中不相交字面量的类型断言。测试夹具的最初失败分别来自数据库文件随运行时/分支命名、英文状态首字母大小写、普通 CLI 输出使用 stderr；均修正夹具，不修改产品行为或放宽超时。原生中文截图 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-RqwM3p/memory-v2-native-capture-zh.png` 已目视检查，长路径完整换行。

全部运行使用隔离配置与本地模型；没有重启用户应用，也未提交、推送或合并。Plugins 商城功能和已记录的多语言边界保持不变；本轮没有重复整套 Plugins 功能验收。

本轮 HTTP API coverage/auth/effect 各 222 pass、0 fail/skip/missing，日志 `/tmp/apexo-capture-status-httpapi.log`；新增终端防控制字符用例加入后，Apexo 最终类型检查通过，日志 `/tmp/apexo-capture-status-apexo-final-types.log`。

本轮本地 CI 同款全仓回归最终为 3626 pass、19 既有 skip、1 既有 todo、0 fail，52 snapshots、10592 断言、276 个文件；Turbo 4/4 成功，用时 10m56s。日志 `/tmp/apexo-capture-status-ci-tests.log`。这是本地检查结果，尚未提交、推送或运行 PR CI。

性能最终复测在全仓测试结束后运行：同一生产页面从 reload 到首个可见输入框动画帧，10 次丢前 2 次，改动前 median 113.5ms / P95 137ms，改动后 110.5ms / P95 115ms，未见回归。日志 `/tmp/apexo-capture-status-baseline.log`、`/tmp/apexo-capture-status-benchmark-final.log`；使用 `grok-plugins-ui.mjs --benchmark-only`，没有再次执行 Plugins 功能场景。最终 `git diff --check` 通过。完整差距目标继续进行，未标记全部完成。


## 2026-10-14：Memory V2 manifest 预算、紧凑索引与读取次数

本轮将 Core 索引生成与兼容会话注入统一到 `MemoryManifest`，补齐每作用域的标准/紧凑预算、标题与摘要、观察时序、主题读取计数排序、文件名补充列表及 UTF-8 截断。所有生产写入路径传递 `memory_v2.compact_index_enabled`，默认关闭；静态配置 schema 与 legacy SDK 已重新生成。该开关不是存储后端选择，已有会话前缀仍维持到压缩边界。

只对模型普通文件读取累计主题读取次数，管理预览和 Dream 不累计；数据库忙碌只跳过辅助计数。读取排名以原始路径为键，展示转义不影响权限。权限过滤视图不覆盖共享文件，修改过的捕获观察不会进入新索引。普通模式同样记录次数。Core 单元使用真实文件、数据库和锁，未用内存模拟存储。

生产 CLI 与 Electron 后端：`grok-memory-manifest.mjs <cli|desktop> [--compact]`，四组各 14 项通过；覆盖空索引、字节上限、标题/摘要/文件名、真实模型读取、管理预览、稳定前缀、新会话与实际压缩刷新、列表排序和权限隔离。`grok-memory-v2-management.mjs` 两端各 24 项通过，继续覆盖清理、删除、关闭和恢复。旧用例原本断言观察正文直接进入上下文；改为带明确标题的测试观察，并继续断言同一事实的出现/撤销，符合官方标题索引契约，不移除隐私断言。

官方安装版 `1.0.52 (0920c8169e27)` 使用 `grok-memory-scopes-official.mjs --compact-index --context` 通过 6 项紧凑索引和 5 项上下文稳定性断言，另完成全局/克隆/worktree/隔离读取。产物 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-memory-official-iyJ7ZO/memory-scopes.json`，日志 `/tmp/apexo-manifest-official-installed2.log`。首轮脚本未启用上下文收集，因此在采样断言停止；现已使 `--compact-index` 隐式启用所需采样。失败保留在 `official-installed.log`，不是官方功能缺失。

固定源码 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` 的 `cargo test -p xai-grok-memory --lib manifest --locked` 31 项通过，包括预算、排序、溢出、隐藏数据和恢复相关场景，日志 `official-source.log`。本地三套索引/管理/捕获测试 29 项、207 断言通过（`unit.log`）；全仓类型检查 21/21 通过（`all-types.log`）。以上日志除另有说明都使用 `/tmp/apexo-manifest-` 前缀。

原生 Electron `--manifest` 首次两轮因测试未等待列表/预览异步加载而失败，补齐针对目标元素的等待后 5 项通过。视觉检查进一步发现长列表选中索引会带走顶部操作区，因此调整列表与预览为受约束的独立滚动区域，后续最终窗口验证另附。所有服务、模型与窗口均为隔离测试，不重启用户应用。

最终 Desktop 构建通过（`desktop-build2.log`）。独立 Electron 窗口 `grok-memory-v2-native.mjs --manifest` 6 项通过，包括 200 条笔记下的顶部控件可见性、生成索引保护与中文预览（`native-final.log`）。截图 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-Tfz2z9/memory-v2-native-manifest-zh.png` 已视觉检查；修复后列表滚动不再带走启停、搜索和操作入口。

追加 `grok-memory-v2-dream.mjs <cli|desktop> --compact` 两端各 23 项通过，涵盖手动、自动、捕获后唤醒、恢复、周期触发、取消与 kill switch，确认整理不把紧凑索引恢复成普通摘要（`dream-cli.log`、`dream-desktop.log`）。官方默认模式 `--context` 也通过原有 5 项上下文断言（`official-standard.log`）。HTTP API coverage/auth/effect 每组各 222 通过，Client `check:generated`、App 类型检查与生产构建通过。

生产会话可输入基准沿用同一脚本、10 次采样并舍弃前 2 次：改动前中位数 110.5ms / P95 115ms（`/tmp/apexo-capture-status-benchmark-final.log`）；本轮首次中位数 125ms / P95 209ms，存在单次高延迟；在无并行构建/测试时独立复测为 111ms / P95 118ms（`benchmark.log`、`benchmark2.log`）。保留两次结果，未据首轮单次波动判定稳定回退，也未删除异常样本。

首轮全仓结果为 3631 pass、19 skip、1 todo、1 fail（`ci-tests.log`）：既有 `httpapi-session.test.ts` 的持久目录请求收到 500；同文件独立复验 21 项通过。已补失败响应正文到断言诊断；五个独立进程重跑该场景全部通过（`session-fresh-1.log` 至 `session-fresh-5.log`），原 500 尚未复现。曾尝试 `--rerun-each=5`，但仓库的全局清理会在首轮后销毁共享运行时及日志目录，后四轮因测试基础设施失败，未当作原 500 的复现；改为独立进程验证。最终在无并行构建/重型验证的条件下完整复验通过：3632 pass、19 skip、1 todo、0 fail，52 快照、10651 断言，Turbo 4/4（`ci-tests-final.log`），用时 9m39.853s。原 500 未再次复现，不能据此声称已经定位或修复其根因；保留响应正文诊断供再次出现时定位。完整目标仍保留其余 Memory、Goal、Workflow、媒体、Hooks/Sandbox 与跨平台缺项；不以索引专项通过声明全部完成。

## 2026-10-14：Plugins 当前构建复核

确认当前分支已具备 Plugins 卡片商城、自行安装、推荐下载、来源管理和三端共用的插件生命周期。本轮重新运行 CLI 15 项、Electron 后端 13 项、官方 Grok Build 1.0.52 对照 10 项、原生窗口 8 项及生产浏览器 24 项，全部通过。插件专项 10 通过、43 断言；App 类型检查和 `git diff --check` 通过。

推荐目录两端各返回 31 项；CLI 与 Desktop 均下载 Neon 的 Git 版本 `4b40580dee0e6acfe2c7bc01bee811dbfeffef78`，确认只下载、未启用。此前记录的 Git 版本是历史快照。浏览器覆盖安装、更新、禁用、卸载、自行安装、来源增删、10 种界面语言、阿拉伯语 RTL 与窄屏。日志前缀 `/tmp/apexo-plugins-review-`，各项结果及中文截图见 [Plugins 功能文档](./plugins-feature.md#当前分支验收2026-10-14)。

首次专项测试因沙箱内本地 HTTP 监听失败而出现 1 项失败；允许隔离测试监听后重跑相同测试，全部通过，保留首轮日志。此次只更新验收与本地化记录，没有修改产品实现，也未重复全仓 CI。62 种语言有名称，57 种覆盖全部 41 个 Plugins 词条；另外 5 种正文回退与完整 Hooks 兼容性继续明确列为边界。本轮补读 MediaWiki 语料，未将缺乏整句核验的翻译写入产品。

## 2026-10-14：Memory 大文件清理、扫描上限与 Grok ACP 大回复

`MemoryV2.fingerprint` 用 64 KiB 缓冲区计算原始文件 SHA-256，并核对打开文件与路径的身份、大小和时间。删除与覆盖前校验不再依赖有 2 MiB 上限的正文预览，超大 `MEMORY.md` 也不会阻止清理后的索引重建；原有不可覆盖发布和旧哈希冲突保护保持有效。真实测试包含超过 350 万字节的 Unicode 与无效 UTF-8 字节、期间改动、不可变发布、主题/观察/归档及作用域隔离。

新增目录迭代器：每目录最多 100,000 项，递归目录队列另有 100,000 项预算；只读视图最多 10,000 项。管理列表保留生成索引优先的顺序；磁盘上的超额文件保留，清理仍遍历全部合格 Markdown。删除日志在删除前统一持久化，发布与删除恢复均每批 256 项，测试包含 513 项删除与 257 项待发布恢复。点号名字和符号链接仍跳过，此实现不等同于官方整目录移除；网络文件系统拒绝及完整生产崩溃组合仍缺。

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| 大文件 CLI / Electron 后端 | 各 29 项通过 | `/tmp/apexo-large-clear-cli-final.log`、`/tmp/apexo-large-clear-desktop-final.log` |
| 官方安装版大文件清理 | 9 项清理检查、7 次基础读取 | `/tmp/apexo-large-clear-official-final.log`；fixture `apexo-memory-official-6igGq5` |
| 大目录 CLI / Electron 后端（最终实现） | 各 11 项通过，包含 4097/10,001 主题、生成索引保留及清理被列表省略的文件 | `/tmp/apexo-memory-scan-cli-verified.log`、`/tmp/apexo-memory-scan-desktop-verified.log` |
| 普通 / 紧凑 manifest 回归（最终实现） | CLI 与 Electron 两种模式各 14 项通过 | `/tmp/apexo-memory-manifest-{cli,desktop}[-compact]-verified.log` |
| 原生 macOS 大目录 | 7 项通过，10,000 个列表项及中文索引预览 | `/tmp/apexo-memory-scan-native-final.log`；fixture `apexo-shell-cli-XxZayp` |
| 官方安装版经默认 Apexo ACP 适配器 | 列表上限 3 项、清理 9 项、基础读取 7 次通过 | `/tmp/apexo-memory-scan-official-fixed.log`；fixture `apexo-memory-official-ha97l8` |
| 官方固定源码 | 清理相关 6 项、扫描上限 1 项通过 | `/tmp/apexo-large-clear-official-source.log`、`/tmp/apexo-memory-scan-official-source.log` |
| Core / ACP 受影响回归 | 58 pass、0 fail、379 断言，8 文件 | `/tmp/apexo-memory-scan-regression-perf.log` |
| 最终类型检查 / Desktop 构建 | 全仓 21/21，构建通过 | `/tmp/apexo-scan-final-types.log`、`/tmp/apexo-memory-scan-desktop-build-perf.log` |

两处产品问题由实际对照暴露并修复：

1. 官方 4097 文件列表经 ACP 转发先超时，隔离重跑观察到大 JSON 被后续通知打断；直接连接同一个官方二进制则通过。新增真实子进程回归稳定复现输出描述符上的 `EAGAIN`。`runGrokBuildAgent` 现使用 stdout/stderr 管道并处理背压，退出前等待输出排空；多 MiB Unicode 回复和后续通知可完整解析，信号转发测试也通过。保留 `/tmp/apexo-memory-scan-official{,-isolated,-direct}.log` 和 `/tmp/apexo-memory-scan-acp-repro.log`；修复后的官方脚本仍使用原先 30 秒请求期限。
2. 原生窗口在 10,001 个主题下等待模型上下文超过原先 10 秒，因为紧凑 manifest 仍读取全部正文。改为先读元数据排序，再按普通 64 项 / 紧凑 512 项预算读取手工文件正文，捕获观察继续进行完整性检查。相同原生场景最终提交后 1297ms 到达测试模型，原先失败保留于 `/tmp/apexo-memory-scan-native.log`；没有放宽等待期限，该时间只代表本机单次回归。

另有一个测试夹具问题：新增 257 条 pending 记录的测试未释放准备语句，SQLite 连接关闭时报 `database is locked`。夹具在运行恢复前显式结束语句和连接；未改变生产行为或断言。原失败日志 `/tmp/apexo-memory-scan-regression-final.log`，修正后及性能修复后的 58 项均通过。生成索引置前后，索引排名脚本改为定位第一项主题，避免把生成文件误当主题。

全部检查使用隔离配置、临时目录和本地测试模型。没有重启用户应用或修改用户插件；Plugins 的既有三端结果与 5 种语言正文回退边界保持不变。本阶段没有提交、推送或合并；完整差距目标仍在进行。

原生大目录中文截图 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-XxZayp/memory-v2-native-manifest-zh.png` 已目视检查：顶部控件保持可见，列表与预览各自滚动，生成索引没有单项删除入口。最终 Client `check:generated` 通过；HTTP API coverage/auth/effect 三组各 222 pass、0 fail/skip/missing，日志 `/tmp/apexo-scan-final-generated.log`、`/tmp/apexo-scan-final-httpapi.log`。

最终 CI 同款全仓回归通过：3640 pass、19 skip、1 todo、0 fail，52 快照、10684 断言、279 文件，Turbo 4/4，用时 9m47.302s；日志 `/tmp/apexo-scan-final-ci.log`。运行期间没有并行构建或大目录 E2E，没有因输出缓冲而重启测试。最终 `git diff --check` 通过。该结果覆盖当前分支的共享实现，不能代替未实现功能或其他操作系统的验收。

## 2026-10-14：Memory 网络文件系统拒绝

新增 `MemoryFilesystem`，在 V2 初始化、健康诊断和主题读取计数打开 SQLite 前执行检查。Linux 通过 `statfs` 类型，macOS 通过只读挂载表的类型/本机标记，Windows 通过 UNC 与系统卷 API 判断。显式 `GROK_SQLITE_JOURNAL_MODE=truncate`（大小写不敏感）拒绝 V2；`wal` 不跳过实际检测；无效值继续探测。未知/探测失败沿用官方 best-effort 行为。没有新增运行时依赖或公开协议字段。

| 验证 | 结果 | 日志与产物 |
| --- | --- | --- |
| CLI 强制策略与已有数据保护 | 11 项通过，拒绝新建、保存、列出、清理；健康与计数不打开受限数据库 | `/tmp/apexo-memory-filesystem-cli-final.log`，fixture `apexo-shell-cli-DM7i5q` |
| 最终 Electron 后端强制策略 | 同上 11 项通过，使用 Node/SQLite | `/tmp/apexo-memory-filesystem-desktop-final.log`，fixture `apexo-shell-desktop-ghu3Y0` |
| CLI 实际网络挂载 | 8 项通过，WAL 不绕过 WebDAV，独立本地作用域仍可写，清理不删除本地笔记 | `/tmp/apexo-memory-filesystem-mounted-cli-final.log`，fixture `apexo-shell-cli-mdgEUw` |
| 最终 Electron 后端实际网络挂载 | 同上 8 项通过 | `/tmp/apexo-memory-filesystem-mounted-desktop-final.log`，fixture `apexo-shell-desktop-HW1W5U` |
| 本地生产管理回归 | CLI / Electron 各 29 项通过 | `/tmp/apexo-memory-filesystem-local-{cli,desktop}.log`，fixtures `apexo-shell-cli-QPoEMX` / `apexo-shell-desktop-QM8Ifx` |
| 官方安装版 1.0.52 | WAL、Truncate、真实 WebDAV 共 6 项通过；无远端写入、无 V2 共享数据库 | `/tmp/apexo-memory-filesystem-mounted-official-final.log`，fixture `apexo-memory-filesystem-official-qMhQqR` |
| 官方固定源码 | Memory 网络相关 3 项（2 项 V2 拒绝及 1 项 legacy journal），SQLite journal 19 项 | `/tmp/apexo-memory-filesystem-reference-{memory,journal}.log` |
| 受影响实现回归 | 41 pass、0 fail、301 断言，6 文件；其中平台分类专项 4 项 | `/tmp/apexo-memory-filesystem-regression-final.log` |
| 类型与构建 | Apexo 类型检查、最终 Desktop 构建通过 | `/tmp/apexo-memory-filesystem-types-final.log`、`/tmp/apexo-memory-filesystem-desktop-build-verified.log` |

真实挂载夹具是 macOS 的内核 WebDAV 文件系统，服务只监听 `127.0.0.1`，只读且无第三方账户；挂载使用隐藏卷和禁止系统弹窗的选项。不是仅把环境变量当成网络挂载。请求日志证明没有 PUT/MKCOL 等远端写请求；卸载后挂载点为空，并用系统挂载表确认没有本轮遗留挂载。这里只验证了 macOS WebDAV，不能推导真实 NFS/SMB 或 Windows/Linux 挂载已经通过。

首轮真实 CLI 挂载试验在规范化前的 `/var/...` 路径上返回了本地判定；挂载表实际保存 `/private/var/...`。检测现在先规范化现存祖先，既有作用域的符号链接约束仍保留。测试卸载判断也改用规范路径；首轮遗漏的临时挂载已明确卸载，修复后的两端用例均自行卸载。失败日志保留在 `/tmp/apexo-memory-filesystem-mounted-cli.log`，不计为通过。

官方首次用例预期直接返回存储错误，但安装版实际返回 `enabled=false`、`disabled_reason=not_configured`。检查日志确认原因确为网络文件系统拒绝后，将断言改为同时检查禁用状态、明确日志原因和未创建共享数据库；没有把任意空列表当作拒绝。首轮记录保留 `/tmp/apexo-memory-filesystem-official.log`；最终官方 6 项使用修正后的实际接口契约。Apexo 保留用户启用设置并返回存储不可用，响应形状与官方不同。

本轮未修改公开 Protocol/HttpApi，未重跑与这些改动无关的全仓 CI；上一阶段的 3640 项全仓结果属于当时实现，本轮以以上受影响回归及三端实际场景为证据。没有提交、推送、合并或重启用户应用。完整目标仍包含生产服务强杀恢复、原生 V2 Runner、高级检索、Goal、Workflow、媒体、Hooks/Sandbox 与跨平台等差距，保持进行中。

## 2026-10-14：生产捕获强杀恢复、失败误报与初始化重试

新增 `grok-memory-recovery.mjs` 与官方安装版对照脚本。测试强杀自己创建的 CLI / Electron / Grok 子进程，再以同一隔离数据打开新进程；等待实际五分钟租约，不篡改数据库时间。CLI/Electron 另覆盖已提交结果日志后的观察文件/manifest 发布中断，以及已删除观察不复活。共享 Shell 夹具增加仅作用于自有子进程的 crash/reopen 控制，保留原有启动、关闭流程。

发现并修复两个实际问题：

- `/flush` 先读任务、后读游标；两次读取之间发生终态失败时，旧任务快照仍为运行中，新游标却已推进，导致返回 completed。真实失败复现于 `storage-repro-cli.log`。新增 Core `progress(sessionID, target)`，一次 SQL 读取 indexed 与冻结范围内的终态失败；测试覆盖重开、重试、终态及后续任务不干扰已有屏障。
- `Effect.cached` 永久保留捕获存储初始化失败。用目录暂时占据 `MEMORY.md`，恢复文件后同实例第二次打开仍失败，复现于 `storage-repro2-cli.log`。改用作用域缓存：成功长期保留，失败立即过期，重新初始化前关闭部分资源。保留文件安全检查，增加恢复失败原因日志。

以下日志除另有说明使用 `/tmp/apexo-memory-recovery-` 前缀。

| 验证 | 最终结果 | 日志与 fixture |
| --- | --- | --- |
| 最终 CLI 实际强杀恢复 | 9 项通过 | `cli-final.log`；`apexo-shell-cli-viBvCq` |
| 最终 Electron 后端实际强杀恢复 | 9 项通过 | `desktop-final.log`；`apexo-shell-desktop-tzHAvd` |
| 强化捕获、失败、存储修复 | CLI / Electron 各 17 项；每端 20 个终态失败会话、10 次修复和项目重开 | `capture-cli-fixed.log` / `capture-desktop-fixed.log`；`apexo-shell-cli-kXUR7V` / `apexo-shell-desktop-IMX910` |
| 官方安装版 1.0.52 实际强杀 | 5 项通过，使用官方 stdio ACP | `official-final.log`；`apexo-memory-recovery-official-6Qnwvv` |
| 官方固定源码捕获与恢复 | 41 pass、0 fail | `reference.log`，`cargo test -p xai-grok-memory --lib v2_capture --locked` |
| 最终受影响回归 | 47 pass、0 fail、288 断言，6 文件 | `regression-final.log` |
| 类型与构建 | 全仓类型 21/21，Desktop 构建通过 | `all-types.log`、`desktop-build-fixed.log` |

`grok-memory-capture-session.mjs` 的强化选项为 `--repeat-failures --repeat-recovery --repair-storage`。失败状态仍要求 failed，恢复仍使用原 10 秒期限；没有放宽断言。强杀用例使用原五分钟 lease，进程重新打开只恢复已入队记忆任务，不重新执行主会话。运行中的操作面板不持久化，用例明确检查面板状态为空，再启动新的 `/flush` 观察已恢复结果。

官方失败专项并非通过：`grok-memory-recovery-official.mjs --failure-only` 在第二次提取失败得到 `flushed=false, disposition=retry_required`，第三次任务行 status=failed、attempt=3，却得到 `flushed=true, disposition=flushed`。严格断言没有放宽，两次观察一致。日志 `official-failures-final.log`、`official-failures-evidence.log`；完整响应与任务行位于 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-memory-recovery-official-PVxpxO/evidence.json`。固定源码的 flush 轮询在检查工作失败前按游标返回成功，与此现象相符；Apexo 的终态失败稳定返回 failed，不据此声称与官方所有响应一致。

首轮常规 Desktop 回归的项目重开超时保留在 `capture-desktop.log`；原日志未保存原因，不能认定它与后来人为复现的缓存问题同源。补充诊断后的普通运行及三个新进程共 30 次重复重开通过，最终修复后又通过上述 10 次修复重开。另有测试基础设施失败：沙箱本机监听受限时初始 CLI/Desktop 未能启动；官方只读 SQLite 观察连接不能重建 WAL 辅助文件，改为仅打开已有数据库并设置 query_only；首次失败专项把文字消息当成结构化 API，改为核对 disposition。均保留原失败日志，不计为成功。

完整目标仍进行中。新确认的行为差异是本地捕获单次 4 分钟、flush 15 分钟，官方分别为 2 分钟、4 分钟；本地自动连续尝试与官方显式重试/新工作唤醒、retry_required 诊断也需对齐。Dream/清理全部生产崩溃组合、操作状态持久化、原生 V2 Runner、高级检索、Goal、Workflow、媒体及其他既有缺项均保留。本轮没有 Protocol/HttpApi 形状变化，未重跑全仓单测或生成客户端；没有提交、推送、合并或重启用户应用。

## 2026-10-14：捕获重试、轮询与真实超时

单次捕获期限调整为 2 分钟，`/flush` 等待期限调整为 4 分钟。失败后没有新工作时退出当前提取循环，保留重试资格；显式 `/flush` 或新的持久 admission 才唤醒重试。读取状态只负责首次恢复，不会在每次桌面轮询时消耗下一次尝试。重新启用记忆仍会恢复未完成工作。

公开 `MemoryWork.Result` 增加 `retry_required`。Core 在一次读取中返回冻结目标范围内的索引游标、终态失败与待重试状态；终态失败仍优先于已推进的游标。共享 Dream/工具适配接口统一使用该响应契约，Client 与旧 SDK 已重新生成。Desktop 复用已有译文“等待重试的提取任务”，mini/fullscreen 显示重试提示，原提取操作可再次触发。

实际并发用例复现了重复消费 admission 唤醒：新轮次已被当前循环处理，留在邮箱中的通知又触发了一次失败重试。现在邮箱区分 admission、恢复和显式重试，认领前合并已观察通知；迟到的 admission 通知在没有 pending 工作时不再启动重试。严格回归检查两次失败 admission 均为 attempt=1，显式 flush 后为 `[2,1]`，随后成功重试发布。另保留每端 20 个失败会话、10 次存储修复/项目重开和状态轮询不改变尝试次数的断言。

本节日志使用 `/tmp/apexo-memory-retry-` 前缀。以下最终检查均已取得成功退出状态。

| 验证 | 当前结果 | 日志或 fixture |
| --- | --- | --- |
| CLI 强化捕获 | 18 项通过 | `cli-verified.log`；`apexo-shell-cli-08oe2s` |
| 最终 Electron 强化捕获 | 18 项通过 | `desktop-verified.log`；`apexo-shell-desktop-FAtMOT` |
| CLI 实际期限与强杀恢复 | 13 项通过；flush 240070 ms，capture 120152 ms | `timeout-cli-verified.log`；`apexo-shell-cli-kLpKp0` |
| 最终 Electron 实际期限与强杀恢复 | 13 项通过；flush 240043 ms，capture 120045 ms | `timeout-desktop-final.log`；`apexo-shell-desktop-ZjSABx` |
| 官方 1.0.52 实际期限与强杀恢复 | 9 项通过；flush 240012 ms，capture 120046 ms | `timeout-official.log`；`apexo-memory-recovery-official-q4MklY` |
| 中文生产界面 | CLI / Electron 各 8 项；可见待重试状态，按钮仅新增一次提取 | `ui-cli.log` / `ui-desktop-final.log` |
| 实际 PTY | mini / fullscreen 各 7 项通过 | `tui-mini-verified.log` / `tui-fullscreen-verified.log` |
| 事件通知 | CLI / Electron 通过显式重试事件顺序及正文边界检查 | `status-cli.log` / `status-desktop.log` |
| 受影响单测 | 79 pass、0 fail、396 断言，9 文件 | `unit-verified.log` |
| CI 同款全仓测试 | 3645 pass、19 skip、1 todo、0 fail；280 文件、10752 断言 | `all-tests.log` |
| 类型、生成与 HTTP API | 全仓类型 21/21；Client 校验通过；API 三组各 222 项通过 | `all-types-verified.log`、`generated.log`、`httpapi.log` |

所有时间均为真实等待，没有改写数据库的 lease 或替换生产时钟。四分钟等待超时后捕获租约保持不变，五分钟租约到期才恢复；两分钟提取超时返回待重试，旧响应不得发布，显式重试只发布一份结果。官方先前“第三次失败却返回 flushed”的独立负面证据仍有效，本轮通过不代表那个错误已消失。

两次 Desktop 长测的状态请求在 45 秒客户端期限失败，保留 `timeout-desktop.log` / `timeout-desktop-verified.log`。第一份 fixture `apexo-shell-desktop-O553UZ` 的锁目录只剩 heartbeat，第二份 `apexo-shell-desktop-O0PUpA` 的锁目录为空，均没有 owner metadata。SIGKILL 落在锁初始化中间时，现有 Flock 不能确认所有者已经退出，必须等待真实 60 秒 stale interval。恢复步骤的客户端上限改为 90 秒，其他请求仍为 45 秒，捕获 2 分钟与 flush 4 分钟断言没有放宽；不删除未知所有者的锁来强行通过。此前已启动的进程不会自动采用脚本变更，因此最终重新启动隔离测试。

PTY 首轮也发现测试时序假设过窄：`/flush` 的异步 admission 可能接入尚未结束的提取，也可能在失败后显式开始第二次提取。界面用例允许这两个合法起点，随后仍严格要求重试按键只多一次请求；自动重试次数由独立 20 会话及并发 admission 用例验证。最初扩展单测的两项本机监听失败保留在 `unit-final.log`，允许测试监听后的 79 项复验通过。

生产页面基准使用相同 `--benchmark --benchmark-only` 路径、每组 10 个样本：变更前 median 133.5 ms / p95 149 ms，并行回归期间为 150.5 ms / 188 ms；日志 `baseline-verified.log` 与 `benchmark-after.log`。全仓测试与构建结束后复测为 132 ms / 152 ms，日志 `benchmark-quiet.log`；本机小样本未显示启动耗时持续上升，不据此宣称性能改善。没有重启用户应用、提交、推送或合并；完整差距目标仍进行中。

## 2026-10-14：Goal 持久状态与用量账本

此前状态核对没有代码进展，本轮继续实现 Goal。新增共享 `Goal` Schema、Core `SessionGoal` 和三张迁移表；这是完整 Goal 的基础阶段，公共 API、执行器续跑、工具、规划/验证模型和 CLI/Desktop 界面尚未接入，不能宣称 Goal 已可用。

- 创建 ID 精确重试、未完成目标覆盖保护、会话级隔离；暂停/恢复/清除和重启恢复均有旧结果隔离。
- 规划/工作/验证有独立尝试，完成报告只能申请验证。预算按每次调用累计用量的正增量记录；重复、乱序、跨进程回调不会重复扣费。暂停后的真实迟到用量继续计入，旧尝试不能改变新尝试状态。
- 三个相同阻塞须来自独立完成的工作尝试；重复工具调用不累加。默认验证上限 10，连续两次相同缺口暂停；显式恢复重置连续计数，不清除总用量。
- 读取不调用模型、不恢复执行；执行器明确确认旧运行不再存活后才能恢复到暂停状态。

实现和完整后续要求见 [Goal 实施契约](./goal-feature.md)。本轮尚未改变 SessionRunner 或主会话循环。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| Goal 核心单测 | 20 pass、0 fail、111 断言 | `/tmp/apexo-goal-core-final.log` |
| Bun / Electron 存储进程 | 各 7 项；含执行/验证 SIGKILL、五轮并发计费和重开预算 | `/tmp/apexo-goal-storage-cli3.log`、`/tmp/apexo-goal-storage-desktop2.log` |
| 官方安装版 Grok 1.0.52 | 6 项实际生命周期；规划/验证显式关闭，只验证控制语义 | `/tmp/apexo-goal-official-runtime3.log` |
| 固定源码状态 / 显示 | 128 + 10 pass | `/tmp/apexo-goal-official-tracker.log`、`/tmp/apexo-goal-official-orchestrator.log` |
| 当前 CLI / 最终构建 Desktop 后端 | 各 20 项既有 Memory 会话、权限和重载场景通过 | `/tmp/apexo-goal-smoke-cli.log`、`/tmp/apexo-goal-smoke-desktop.log` |
| 全仓类型 | 21/21 | `/tmp/apexo-goal-all-types.log` |
| 迁移、Client 生成、Desktop 构建 | 通过 | `/tmp/apexo-goal-migrations.log`、`/tmp/apexo-goal-generated.log`、`/tmp/apexo-goal-desktop-build.log` |
| HTTP API | coverage / auth / effect 三组各 222 pass、0 fail | `/tmp/apexo-goal-httpapi.log` |
| CI 同款全仓单测 | 3665 pass、19 skip、1 todo、0 fail；281 文件、10863 断言，turbo 4/4 | `/tmp/apexo-goal-all-tests.log` |

过程中修复了无预算内部调用被误判为非法参数的问题。真实并发子进程还复现 Bun `SQLITE_BUSY_RECOVERY`：原连接在 WAL 初始化后才设置 busy timeout。Bun 已把 5 秒锁等待提前，Node 连接也明确默认 5 秒；两端强杀恢复及五轮并发打开复验通过。首次失败日志 `/tmp/apexo-goal-storage-cli2.log` 保留。

官方初轮发现暂停通知早于状态文件落盘，改为观察实际状态提交；第二轮误把重开后的标题生成算成 Goal 推进，已依据实际请求内容区分。两次失败记录均保留，最终隔离运行 6 项通过，未修改官方程序。源码参考目录有此前与 Goal 无关的图片桥接测试修改，Goal 源文件没有差异；固定源码测试不是安装版完整运行的替代证据。

没有重启用户应用、提交、推送或合并。完整目标继续保持进行中，下一阶段接入公共契约与两套 Session 执行器，并补齐真正的三端 Goal 交互与独立核验。

## 2026-10-14：Goal 独立模型评审边界

在持久状态层上新增 `SessionGoalReview`：独立规划/核验请求、实际 Token 入账、两分钟期限、严格输出检查、预算终止和迟到结果保护。`pauseAttempt` 按尝试 ID 收尾，解决旧取消回调可能暂停新一轮的边界；中断在取得尝试与装入处理器之间也不能留下无人拥有的执行阶段。兼容模型服务 `SessionGoalModel` 使用最近用户消息选定的模型，评审不写入主会话，也不扫描全部历史来选择模型。

已验证：

- Core 状态/模型边界 33 pass、163 断言，含旧请求在恢复后返回仍计费但不能提交、旧 finalizer 不能暂停新尝试。
- 实际兼容 HTTP 模型服务 3 pass、19 断言；独立请求、历史不变、503 不自动重试、取消。
- `grok-goal-review.mjs cli` / `desktop` 各 8 项，使用真实本地 OpenAI SSE、Bun 或 Electron 内嵌 Node/SQLite；包含规划、拒绝核验、接受核验、格式错误、503、预算、取消和原始目标隔离。
- `grok-goal-official.mjs --planner` 开启安装版独立 planner，7 项生命周期对照通过；仅终止该脚本子进程。fixture `apexo-goal-official-jCPabK`。
- 固定官方源码既有 planner 74、classifier 197 项通过。安装版未完成核验面板全链路，本次没有把源码测试替代成安装版行为验收。
- 受影响回归 `bun test test/session/goal.test.ts test/session/prompt.test.ts test/session/llm.test.ts`：133 pass、1 skip、0 fail、599 断言。实际运行命令还含一个不存在的 `test/session/usage.test.ts` 参数，Bun 没有执行该文件；不计为独立用量套件覆盖。类型检查复验 21/21。

日志前缀 `/tmp/apexo-goal-review-`：`core-final2.log`、`http-final.log`、`cli2.log`、`desktop2.log`、`official-runtime.log`、`official-planner.log`、`official-classifier.log`、`affected.log`、`all-types-final.log`。Bun fixture `apexo-goal-review-cli-kWVtLW`，Electron fixture `apexo-goal-review-desktop-4zqwe8` 保存全部 HTTP 请求和断言结果。

保留的首次失败：原生 HTTP 对 503 内置两次重试，7 次模型操作实际发出 9 个请求，脚本现在同时断言总数与该错误恰好三次；兼容 HTTP 适配器设置 `retries: 0` 的测试仍要求只发一次请求。Electron fixture 的无关 AppNodeBuilder 依赖导致 jsonc-parser 动态 require 打包失败，收窄为数据库与模型传输层后通过；测试 Stream 泛型误用导致的类型错误已修正。详见 [Goal 契约](./goal-feature.md)。

**未完成的范围保持不变**：目前是单次无工具内部模型评审，仍需官方式工作区读取、多核验者及策略调整、主工作循环与子任务计费、两套执行器集成、`/goal`/API/工具、CLI 和 Desktop UI。未改动公开 API，没有手动修改生成代码；未重启用户应用，也未提交、推送或合并。本阶段没有重新声称全仓 3665 项或最终 Desktop 界面 Goal 已验收。

## 2026-10-14：剩余功能复核与 Goal 兼容循环进展

当前兼容执行层已接入独占 `runGoal`、自动续轮、预算停止、暂停隔离、`update_goal`、子代理用量归属和后台子任务等待；独立核验材料包含子会话记录。上阶段“主工作循环与工具未接入”的结论已更新。公共 API、`/goal`、CLI/Desktop 界面、原生 V2 执行器、工作区读取、多核验者和策略调整仍未完成。

本次复核修复了子任务证据筛选访问可选 metadata 的类型错误，并将筛选限定为 task。Apexo 包类型检查通过；内部 HTTP 集成 7 pass、0 fail、25 个断言，格式检查通过。日志 `/tmp/apexo-goal-loop-status-types2.log`、`/tmp/apexo-goal-loop-status-review2.log`、`/tmp/apexo-goal-loop-status-format.log`。首轮并行检查有类型错误和 3 个 5 秒超时，原始日志 `status-types.log` / `status-review.log` 保留；独立复跑未放宽超时或断言，超时根因尚未确认。

差距主表已同步 Goal 的部分实现状态。Plugins 商城主流程保持已实现，其余缺项仍包括 5 种语言正文、完整 Hooks/manifest/策略兼容及下载/缓存管理；完整功能和三端验收仍未完成。本次没有重跑全仓 CI 或 Goal CLI/Desktop/官方完整循环，不用历史全仓结果为当前全部改动背书。未提交、推送、合并或重启用户应用。

## 2026-10-14：Goal 公共控制与实际模型循环

兼容 HttpApi 新增读取、创建、运行、暂停、恢复和清除六个端点。创建只持久化目标，运行入口在取得会话独占执行权后才确认 admission；状态轮询不恢复执行或调用模型。重启后的旧执行只能由显式控制请求恢复到暂停，再由用户恢复。会话级控制串行化，旧 Goal ID 不得控制新目标，清除已结束目标也不能取消随后开始的普通提问。旧 SDK 已生成 Goal 客户端；原生 Protocol/Client 与 V2 SessionRunner 的 Goal 契约尚未接入。

执行取消增加本次运行的身份检查：保存 Runner 引用仍不足以识别其后来承载的新工作，现在取消同时核对 owner。后台通知还复现了实际计费上下文泄漏：Goal 完成后，迟到 Shell 结果继承已经结束的尝试，导致普通后续回复无法调用模型。通知入口现在清除旧 Goal 上下文；正在运行的 Goal 仍通过自己的显式尝试计费。修复前失败记录为 `/tmp/apexo-goal-api-notification-before.log`，修复后 8 个 Goal 集成通过，28 个断言，见 `notification-after2.log`。

本节日志除另有说明使用 `/tmp/apexo-goal-api-` 前缀。

| 验证 | 最终结果 | 证据 |
| --- | --- | --- |
| CLI 实际服务/模型循环 | 8 项通过，24 个实际模型请求 | `cli-final.log`；fixture `apexo-shell-cli-UfxQ1n` |
| 最终生产 Electron 后端 | 同 8 项通过，24 个实际模型请求 | `desktop-final.log`；fixture `apexo-shell-desktop-3V29oe` |
| 官方安装版 1.0.52 执行对照 | 完成、拒绝后继续、预算停止 3 项通过，29 个实际模型请求 | `official-execution4.log`；fixture `apexo-goal-official-OAcrpT` |
| 官方启用 planner 的生命周期 | 7 项通过，2 个保留中的规划请求 | `official-lifecycle.log`；fixture `apexo-goal-official-iVPenv` |
| 全仓类型与最终 Desktop 构建 | 21/21；生产构建通过 | `all-types-final.log`、`desktop-build-final.log` |
| 生成契约 | Client generate、check:generated 和 legacy SDK build 通过 | `client-generate.log`、`generated-check.log`、`sdk-generate.log` |
| HttpApi | coverage / auth / effect 各 228 pass、0 fail、0 skip、0 missing | 前两组 `httpapi.log`；完整 effect `httpapi-effect-traced.log` |
| CI 同款全仓单测 | 3693 pass、19 skip、1 todo、0 fail；282 文件、10992 断言，turbo 4/4 | `all-tests-final.log` |

两端实际场景覆盖持久创建且不调用模型、冲突创建、独占 admission、规划/工作/核验真实用量、拒绝核验后继续、预算停止且不能恢复绕过、迟到后台通知独立计费、暂停/显式恢复、旧目标清除不打断普通工作，以及真正 SIGKILL 后的被动读取和显式恢复。Desktop 验证使用生产打包后端，不代表新增了 Goal 窗口。

官方执行 fixture 使用安装版实际隐藏 evaluator 与默认三个核验者；完成场景一次工作/三次核验，拒绝场景两次工作/六次核验。官方预算用高水位基线，不能直接要求等于 Apexo 累计账本。核验使用官方已有的 `Refuted` / `Not Refuted` 终止文本回退，未覆盖工作区读取或 JSON verdict 文件写入，不能宣称完整核验已对齐。本轮确认独立 JSON evaluator 是另一个明确缺口，已加入 Goal 契约和差距表。

保留的测试失败包括官方 SSE fixture 缺少 created 字段、缺少 evaluator JSON、标题生成被误计为核验；修正 fixture 后仍要求拒绝首轮完整核验面板并发生第二次实际工作。初次三文件 HTTP/Goal 集成有一个目录提示假设错误：现有路由优先按 Session ID 定位，不能预期不同目录 header 得到 404；已按真实路由规则验证返回对应会话且读取不修改状态。初次七文件回归 201 pass、1 skip、1 fail，唯一失败为 Desktop 工具清单期望漏加 `update_goal`，已补正。

HttpApi 原整组命令在 effect 阶段超过九分钟未退出，确认进程身份并保存线程采样后中止；该次命令不记为成功。新增六条路由单独跟踪通过；相同断言和 30 秒场景期限下，完整 effect 跟踪重跑 228 项通过并正常退出。没有因为观察超时放宽断言、改产品实现或宣称已确定原轮次根因。原日志与 `httpapi-hang-sample.txt` 保留。

生产页面复测沿用 `grok-plugins-ui.mjs cli --benchmark --benchmark-only`：每组 10 次重载，前两次预热，统计余下 8 个样本。变更前为 median 216 ms / p95 388 ms（`/tmp/apexo-goal-loop-baseline.log`）；与全仓单测并行时为 179 ms / 426 ms（`benchmark-after.log`）；单测结束后的复测为 154.5 ms / 646 ms（`benchmark-quiet.log`，fixture `apexo-shell-cli-UzLjTQ`）。后者原始样本为 `[157,216,131,115,286,646,148,162,161,132]`。小样本尾部波动原因未确认，不能根据中位数下降宣称整体性能改善或确认无退化；最终性能验收需补充对照。该脚本的 `passed: 0` 表示 benchmark-only 没有执行商城操作用例，不计作额外功能通过数。

本阶段仍缺 `/goal`、CLI headless/mini/fullscreen 和 Desktop 操作界面、独立轮次 evaluator、工作区读取、多核验者和策略调整、原生 V2 Goal。Memory V2、Workflow、媒体、Hooks/Sandbox、Plugins 的剩余边界与跨平台验收也继续保留。没有提交、推送、合并或重启用户应用，完整目标保持进行中。

## 2026-10-14：Goal 独立轮次评估器

兼容执行器新增持久 `evaluating` 阶段。工作轮次结束后由无工具独立模型输出严格的 `continue/candidate_complete/blocked` JSON；自报完成不跳过评估，候选完成仍需核验。评估器证据和具体下一步保存到 `Goal.Info.evaluation`，后续工作收到该下一步；continue 不再因旧的“三轮未申请完成”计数而停下。阻塞按稳定键累计三个独立轮次，更换键、进展或显式恢复均重置连续计数。

请求使用结构化输出 schema，拒绝额外字段、空证据/下一步及不合规阻塞键。格式/传输/缺失用量最多重试一次，每次有独立调用 ID 并分别计费；超预算、失效尝试和存储错误不重试。取消、清除和恢复都保留代次隔离。原始目标完整保留，评估材料按 UTF-8 限制为总共 32 KiB、单项 4 KiB，方案 16 KiB，不截坏中文或 emoji。原始核验材料读取仍是后续范围。

新增 `usageIncomplete`：评审未返回用量或执行中进程被强杀时，明确标记已记录 Token 只是下界；重试、恢复不清除标记。独立模型适配器主动清除工作轮次的计费上下文，避免调用者遗漏时双重计费。新增状态字段通过兼容 HttpApi/旧 SDK 暴露，Client generate/check 和 legacy SDK build 已按脚本完成；存储仍是既有 JSON 状态，SQL 列与约束没有改变。原生 V2 执行器尚未接入。

本节日志使用 `/tmp/apexo-goal-evaluator-` 前缀。

| 验证 | 最终结果 | 证据 |
| --- | --- | --- |
| CLI 实际 API/模型循环 | 15 项通过，71 个实际请求；含工作/评估阶段 SIGKILL | `cli-final.log`；fixture `apexo-shell-cli-7qHuvo` |
| 最终生产 Electron 后端 | 同 15 项通过，71 个实际请求 | `desktop-final.log`；fixture `apexo-shell-desktop-0BMUG5` |
| 官方安装版 1.0.52 | 7 项通过，65 个实际请求 | `official.log`；fixture `apexo-goal-official-UJjYBl` |
| 受影响完整回归 | 122 pass、1 既有 skip、0 fail；3 文件、634 断言 | `regression-final.log` |
| Goal 状态/评审追加复验 | 41 pass、0 fail、237 断言，含新增评估器超时最多两次 | `core-final.log`；与上行存在重叠，不相加为总覆盖 |
| 类型与格式 | 全仓 21/21；本阶段文件格式及差异检查通过 | `all-types-final.log`、`format-final.log` |
| 生成与生产构建 | Client generate/check、legacy SDK、最终 Desktop 构建通过 | `client-generate.log`、`generated-check.log`、`sdk-generate.log`、`desktop-build-final.log` |

官方对照包含完成、核验拒绝后继续、预算停止、四轮持续推进、三轮稳定阻塞、非法 JSON 后成功重试及两次非法 JSON 后基础设施暂停。官方仍使用默认三个核验者和既有终止文本回退；本地当前为一个无工具核验者，不将该差异写成已完成。两端另外覆盖评估器取消、预算在评估阶段耗尽、迟到通知独立运行、清除旧 Goal 不影响新提问，以及被动读取不推进、显式恢复和再次重开无复活。Desktop 是最终打包后端，不代表新增了 Goal UI。

失败记录保留：首轮阻塞集成 fixture 未为评估响应提供用量，正确进入失败处理，补齐真实响应后继续验证；首次 CLI 的 held-evaluation 夹具同时挂起了工作阶段，导致“评估器已进入”超时，现只挂起指定阶段，原期限不变。一次与构建/类型检查并行的会话回归有 Shell 等待 10 秒超时（118 pass、1 skip、1 fail）；构建结束后单独按原期限复验通过，原因尚未确认，不宣称已修复未知的产品问题；最终完整受影响回归也在原期限下通过。

仍需完成 Goal 命令/界面、原生 V2、多核验者、工作区读取与策略调整，以及差距文档其他全部项目。此前全仓 3693 项结果属于上一阶段，不用于替代本阶段受影响回归或最终整体验收。没有提交、推送、合并或重启用户应用；完整目标保持进行中。


## 2026-10-14：Goal 空会话启动、命令和用户面板

新增 `Goal.Start`、持久 `Goal.Info.launch` 与 `POST /session/:sessionID/goal/:goalID/start`。先保存模型/agent 与固定消息 ID，再在该会话的独占执行器内接纳目标正文并启动；重复请求不能重复写消息、切换初始模型或恢复暂停目标。部分写入可修复；已经接纳的消息编辑保持，原始目标由 Goal 独立保存。GET 仍只读。旧 SDK 与 Client 已按生成流程更新。

CLI 新增 `apexo goal create/status/start/pause/resume/clear --attach ...`，输出 JSON；create 可新建会话，并在启动前输出持久 ID 供显式重试。mini/fullscreen 使用共享 `/goal` 面板，支持目标、可选预算、状态、快捷键和清除确认。Desktop legacy/V2 输入框共用 Goal 控件；新聊天可直接输入 `/goal <目标>`，控制命令包括 `/goal status/pause/resume/clear`。面板显示阶段、用量下界提示、计划、评估、核验详情及未满足项；关闭不暂停。

本轮实际发现并修复：mini 缺少共享组件导出、空会话没有继承已保存/配置的模型；恢复时将正常的消息编辑误判成冲突。清除后新表单为空是正确行为，首次 fullscreen 脚本漏填目标导致失败，修正步骤后在原期限下通过。初次新增 locale 词条插入到 import 区域造成类型错误，已移到词典对象；初次 API 脚本局部变量重名也已修正。失败日志均保留，不用后续通过替代原因。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| CLI 实际 API/模型循环 | 18 项，80 请求，含空会话、重试、预算、取消、SIGKILL、编辑后恢复 | `/tmp/apexo-goal-start-cli-final.log`；`apexo-shell-cli-RDhbFy` |
| 生产 Electron API/模型循环 | 同 18 项、80 请求 | `/tmp/apexo-goal-start-desktop-final.log`；`apexo-shell-desktop-qpJGHe` |
| 生产浏览器连接 CLI / Electron | 各 8 项，含全新聊天、slash 控制、清除、预算及中文 | `/tmp/apexo-goal-ui-browser-cli-final.log`、`browser-desktop-final.log`（同前缀）；`apexo-shell-cli-0veJJK`、`apexo-shell-desktop-vH4lj8` |
| macOS 原生 Electron 窗口 | 4 项：创建、重开/暂停/恢复、中文核验结果、清除 | `/tmp/apexo-goal-ui-native.log`；`apexo-shell-cli-4l5TsQ` |
| mini 真实 PTY | 5 项，含 `/goal pause/resume` | `/tmp/apexo-goal-ui-mini-final.log`；`apexo-shell-cli-hJETXB` |
| fullscreen 真实 PTY | 5 项，含 `/goal pause/resume` | `/tmp/apexo-goal-ui-fullscreen-final.log`；`apexo-shell-cli-CPBTV8` |
| headless CLI | 3 项创建/状态/暂停恢复/清除与错误码检查 | `/tmp/apexo-goal-ui-headless.log`；`apexo-shell-cli-XMSd79` |
| 官方安装版执行/评估 | 7 项、65 请求 | `/tmp/apexo-goal-ui-official.log`；`apexo-goal-official-W718zJ` |
| 官方安装版生命周期 | 7 项、2 请求，含强杀后暂停及只读状态 | `/tmp/apexo-goal-ui-official-lifecycle.log`；`apexo-goal-official-0S4u2I` |
| Goal/会话/HTTP/footer 受影响回归 | 最终 149 pass、6 skip、0 fail、763 断言 | `/tmp/apexo-goal-ui-regression-final.log` |
| CLI 帮助快照 | 1 项、43 断言通过，加入 goal 帮助 | `/tmp/apexo-goal-ui-help.log` |
| Client 生成校验 | 通过 | `/tmp/apexo-goal-ui-generated-check.log` |

受影响回归首轮 148 pass、6 skip、1 fail：既有前台 Shell 转后台测试在原 5 秒期限内未看到启动输出（`regression.log`）。原断言独立复跑通过（`shell-isolated.log`），最终完整受影响回归通过；尚未定位首次超时根因，未放宽期限或声称已经修复这个未知问题。六个 skip 为既有投影/终端测试，本轮没有跳过新功能失败。

新增 Goal 文案通过 i18n；英文与简体中文完整，其他语言英文回退。语料依据及功能边界见 Goal 文档。Desktop 核验追踪信息放入可展开结果详情，避免默认界面直接堆叠内部调用标识；截图已检查布局和中文状态。生产浏览器覆盖 V2 输入框，legacy 输入框完整交互、其他语言正文、Windows/Linux 仍待验收。官方采用默认三个核验者，本地目前仍为一个无工具核验者，不能宣称完整 Goal 已等价。

本轮没有提交、推送、合并或重启用户已有应用/服务。全部进程与文件使用隔离 fixture。完整目标继续包括剩余 Goal、Memory V2、Workflow、媒体、Hooks/Sandbox、Plugins 边界及最终全项目验收。

后续用量展示复核又确认：工作请求被取消且没有返回 usage 时，之前仅保留计数，未标记下界。`SessionGoalUsage.track` 的结束处理现与评审边界一样设置 `usageIncomplete`；已收到的用量保持，清除旧 Goal 后的迟到处理不会恢复旧目标。新增真实 Stream 中断测试，Goal 核心/评审 43 项、248 断言通过（`/tmp/apexo-goal-ui-usage-tests.log`），CLI 18 项/80 请求通过（`usage-cli.log`，fixture `apexo-shell-cli-YDTsAv`）。生成契约未改变。

追加修复后的最终复验（日志除特别说明均使用 `/tmp/apexo-goal-ui-` 前缀）：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 最终生产 Electron API/模型循环 | 18 项、80 请求通过，包含取消后用量下界 | `usage-desktop.log`；`apexo-shell-desktop-cM5B4b` |
| headless CLI 连接 Electron 后端 | 3 项通过 | `headless-desktop.log`；`apexo-shell-desktop-PtX2G2` |
| 最终原生 macOS Electron 窗口 | 4 项通过；中文截图显示用量下界提示，完成结果详情默认折叠 | `native-final.log`；`apexo-shell-cli-J4j5Vq` |
| App / Desktop 生产构建 | 均通过 | `app-build-verified.log`、`desktop-build-usage.log` |
| 全仓类型 | 21/21 通过，19 项缓存 | `types-verified.log` |
| HttpApi | coverage / auth / effect 各 229 pass、0 fail、0 skip、0 missing、0 extra | `httpapi.log` |
| Goal/会话/HTTP/footer 受影响回归 | 150 pass、6 既有 skip、0 fail；4 文件、767 断言 | `regression-verified.log` |

HttpApi 本轮完整 effect 阶段最终输出全部 229 项通过；不能把等待期间暂无输出当作失败。本轮没有重跑 CI 同款全仓单测，之前的 3693 项属于控制 API 阶段，不能作为最新全部增量的验收结果。上述实际模型请求均通过可控本地协议 fixture 发出，验证执行及计费行为，不代表真实模型的任务完成质量。

生产页面性能采用同一脚本与统计口径：10 次重载，去除前 2 次预热。改动前 median 159 ms / p95 268 ms（`baseline.log`）；最终 App 构建后、未与类型检查或回归并行的测量为 median 136.5 ms / p95 298 ms（`benchmark-final.log`，`apexo-shell-cli-V9OUI3`）。最终原始样本为 `[159,290,143,127,115,144,126,298,134,139]`。中位数降低、尾部略增，样本较少，不能宣称整体性能改善或已证明没有退化；此数据仅衡量生产浏览器重载到输入框首次可见，不代表 Desktop 整体启动性能。benchmark-only 的 `passed: 0` 不计作功能验收数量。


## 2026-10-14：Goal 多核验者与报告

将默认单个核验者改为三个；配置 `goal.verifier_count` 与环境变量 `GROK_GOAL_VERIFIER_N`，按官方优先级与 u32 范围解析并夹在 1–5。核验开始固定人数，第一位高置信度否决、阻塞后的完整核验、其余人的严格多数规则均依据固定官方源码 `goal_classifier.rs`；不是简单的三人投票。每份报告持久保存身份、原始证据摘要、结论、置信度、未满足项、实际用量和耗时。CLI 状态 JSON、mini/fullscreen 与 Desktop 面板共用结果；Desktop 可以展开各份证据。

核心边界：每个实际模型请求独立计费；预算停止、清除和旧尝试仍受代次保护。索引及请求身份不能重复覆盖，未齐的面板不能通过旧的单条结论接口提前完成。核验中实际强杀后可以只读恢复部分报告，明确控制请求才进入恢复，重新核验不复用过期批准。第一位可以看到自己的上一份报告，但还没有实现官方真实子会话续接、工作区工具、专属 scratch 文件及角色模型覆盖；原生 V2 和策略调整继续保留。

失败及修复：首次持久面板将不存在的 previous 字段编码为显式 undefined，被严格 Schema 拒绝；改为省略后通过。取消测试复现并行调用尚未完成终结处理，父控制请求就已返回，缺失用量标记未保留；改为显式作用域拥有各调用，并发等待其结果，关闭作用域时等待全部退出。又补了后一个核验者失败/耗尽预算时取消前一个挂起核验者的测试。首次已有 fixture 的 Token/请求数仍按单人计算，按真实三人请求更新。一次综合回归包含旧计数断言、两个原期限 Shell 等待超时和两个并行快速失败超时；当时进程先加载了旧模块，后续测试文件在最后取消修复后才加载，不能把这轮混合状态作为最终证据，原日志保留为 `regression.log`。最终稳定代码重新执行受影响整组，结果另列。

本节日志前缀 `/tmp/apexo-goal-panel-`。Client generate/check、legacy SDK 与配置 schema 均通过现有脚本生成，没有手改生成文件。真实模型请求使用本地可控协议服务，验证执行契约，不证明开放任务的模型质量。英文/简体中文新增面板文案，其余语言回退；仍需母语复核。没有提交、推送、合并或重启用户应用。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| Goal / runtime flags / 会话 / HTTP / footer 回归 | 203 pass、6 既有 skip、0 fail，1021 断言 | `regression-final.log` |
| CLI 实际 API / 模型循环 | 18 项、102 请求通过 | `api-cli-final.log`；`apexo-shell-cli-RwRkAU` |
| 生产 Electron 后端 API / 模型循环 | 18 项、102 请求通过 | `api-desktop.log`；`apexo-shell-desktop-ADPsPC` |
| CLI / Electron 核验面板场景 | 各 11 项；含人数配置、环境覆盖、否决、多数规则、取消及实际强杀恢复 | `matrix-cli-final.log`、`matrix-desktop.log` |
| 官方安装版默认三人 | 7 项、65 请求通过 | `official-three.log`；`apexo-goal-official-0ncMc2` |
| 官方安装版一人 / 五人 | 各 3 项，分别 17 / 41 请求通过 | `official-one.log`、`official-five.log` |
| 官方固定源码 Goal classifier | 197 pass、0 fail | `official-source.log` |
| mini / fullscreen 真实 PTY | 各 6 项，包含 3/3 逐人报告 | `mini.log`、`fullscreen.log` |
| 全仓类型 | 21/21 通过，19 项缓存 | `types-final.log` |
| 生成检查 | legacy SDK、Client generate/check、配置 schema 通过 | `sdk.log`、`client-generate.log`、`generated-check.log`、`schemas.log` |

官方安装版对照仍采用其终止文本回退，不等同于官方工作区工具和真实核验子会话的完整流程；置信度与多数规则另由固定源码测试覆盖。API / 面板结果不与单元测试数量相加。本阶段没有重跑 CI 同款全仓单测，历史全仓及 HttpApi 数量不替代本阶段的最终整体验收。


新增原生窗口发现：展开第三份报告后，清除确认按钮位于弹窗可见区域之外，agent-browser 拒绝点击（`native.log` 与 `apexo-shell-cli-7hmPfp/goal-native-failure.png`）。Goal 弹窗改为填满已有固定容器，内部内容明确按剩余空间滚动；不修改共享 Dialog。第一次复验仍然失败，进一步 DOM 诊断确认内容区高 539px、可滚动内容高 736px，按钮在可见区域外，脚本没有先滚动；不能仅凭覆盖错误把这次失败判定为无法滚动。原生脚本现显式滚动到确认按钮后正常点击，不使用强制点击。

诊断同时发现定时刷新替换报告对象，已展开的报告会在下一次读取后折叠。状态更新改为按调用 ID 协调既有报告节点；浏览器和原生脚本都在展开后等待 2.5 秒，跨过完成状态的轮询周期，确认报告仍展开。原生脚本也在滚动后等待相同周期再点击，检查滚动位置保持。失败时保存 DOM 尺寸、命中元素及截图，便于区分布局与自动化问题。

本次沙箱内的三次界面复验未能监听临时端口，均没有形成有效功能测试结果；已终止这些测试自身创建的进程，并在获准监听本地端口后重跑。一次 Desktop 构建因无法读取 `models.dev` 快照失败，后在允许该网络读取的环境完成原构建脚本；没有替换模型快照或忽略构建步骤。

最终界面证据（同 `/tmp/apexo-goal-panel-` 前缀）：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 生产浏览器连接 CLI / Electron | 各 9 项通过，包含报告跨轮询保持展开 | `browser-cli-reconcile.log`、`browser-desktop-reconcile.log`；`apexo-shell-cli-ve0oZ9`、`apexo-shell-desktop-o5e8B0` |
| macOS 原生 Electron 窗口 | 5 项通过，包含展开报告及滚动后的清除确认 | `native-reconcile-final.log`；`apexo-shell-cli-LEUHDU`；已检查 `goal-native-zh.png` 和 `goal-native-clear.png` |
| 最终 App / Desktop 生产构建 | 均通过 | `app-reconcile-build.log`、`desktop-reconcile-build-network.log` |
| 最后 UI 改动类型 / 格式 | App 类型、涉及源文件格式及差异检查通过 | `app-typecheck-reconcile.log`；全仓 21/21 检查早于最后 UI 改动，其余包未再改动 |

原生窗口的前一次最终构建复验在进入 Goal 表单前退出（`native-reconcile.log`，`apexo-shell-cli-LCSHOc`），未执行任何功能检查；原因尚未确认。单独按原始步骤和期限复跑五项通过，不将重跑通过写成已修复该未知退出问题。原生脚本只清理自己的窗口和服务，没有重启用户应用。此前未滚动的失败日志与 DOM 诊断也继续保留。

完整 Goal 的工作区工具、真实核验子会话续接、角色模型覆盖、策略调整及原生 V2 集成仍未完成；本节完成的是多核验者面板及报告。其他功能的完整原生窗口、legacy 输入框、多语言和跨平台验收继续按差距清单保留。

性能采用相同生产脚本，10 次重载去掉前 2 次预热。修改前 median 135ms / p95 199ms（`baseline.log`）；最终构建后、未与构建或功能测试并行的复测为 median 171.5ms / p95 238ms（`benchmark-final.log`；`apexo-shell-cli-MMqLCa`），原始样本 `[157,130,189,173,151,130,188,147,170,238]`。本次中位数和尾部均上升，样本少且未做受控成对归因，不能判定具体原因或宣称没有性能退化；完整性能验收仍保留。该指标只覆盖浏览器重载到输入框首次可见，不代表原生 Desktop 启动耗时；benchmark-only 的 `passed: 0` 不计为功能验收。

## 2026-10-14：Goal 工作区工具与真实核验子会话

兼容执行器的规划者和核验者已使用持久子会话，经过正常模型传输、工具与权限路径执行。规划和核验可读取、列目录、搜索、调用 LSP/网页读取以及运行权限允许的检查；不提供直接文件写入、任务创建、Goal 控制或任意 MCP 工具。Shell 仍由宿主权限控制，角色的只读要求不是操作系统隔离。每轮重新提供原始目标和角色约束，避免上下文压缩后丢失要求。

索引 0 续接自己的上一子会话，其他核验者新建独立会话。续接前重新继承父权限，显式路径拒绝不能被既有会话放行绕过。每次传输通过既有账本计费；新增回执只用于报告汇总，不第二次计费。`plannerSessionID` 与逐人 `sessionID` 保存工具记录关联。评审使用原有两分钟期限，取消会等待其拥有的子会话及后台检查退出；缺失用量保留不完整标记。独立 evaluator 仍为无工具调用。

本阶段验证（日志前缀 `/tmp/apexo-goal-session-`）：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| CLI / 最终生产 Electron 工作区专项 | 各 7 项、45 次实际模型请求通过 | `workspace-cli-final.log` / `workspace-desktop-final.log`；fixture `apexo-shell-cli-kCqZ6a` / `apexo-shell-desktop-kksOES` |
| 官方安装版 1.0.52 | 3 项、22 次实际模型请求通过；规划者及核验者读取文件，通过工具写方案和 JSON/Markdown 报告 | `workspace-official-final.log`；`apexo-goal-official-i2MNyH` |
| CLI / 最终生产 Electron Goal API 回归 | 各 18 项、102 次实际模型请求通过 | `api-cli-final.log` / `api-desktop-final.log`；`apexo-shell-cli-GgEvH8` / `apexo-shell-desktop-bWq7Wt` |
| CLI / 最终生产 Electron 多核验者回归 | 各 11 项通过；覆盖表决、取消、重启和人数配置 | `panel-cli-final.log` / `panel-desktop-final.log`；默认配置 fixture `apexo-shell-cli-F4bQ6K` / `apexo-shell-desktop-glT1BN` |
| 受影响会话、工具、模型与 API 回归 | 157 pass、1 既有 skip、0 fail，858 断言，5 文件 | `regression-objective-final.log`，69.22s |
| 全仓类型 | 21/21 通过，19 缓存、2 重查 | `types-objective-final.log` |
| Core Goal 状态回归 | 56 pass、0 fail、381 断言 | `core.log`；在最后内部 Request 原始目标字段追加前运行，之后全仓类型与集成回归通过 |
| SDK / Client / Desktop | 按仓库脚本生成，Client 生成校验通过，最终 Desktop 构建完成 | `sdk.log`、`client-generate.log`、`generated-check.log`、`desktop-objective-build.log` |

工作区专项通过真实 `list_dir`、`grep`、`read_file`、`run_terminal_cmd` 测量行为：首轮实际文件否决工作模型的完成声明，修复后首位核验者续接且其余核验者独立读取；逐人计费与总计一致。完成状态与工具记录在隔离生产服务强杀重开后保持一致。另覆盖工具读取后的核验取消、无部分完成报告、子会话空闲，以及明确路径拒绝不泄露正文。

保留失败记录：初始测试夹具混淆旧轮次工具结果与当前轮次，漏发第二次写入；取消准备信号将 grep 输出误当成 read 完成；拒绝读取后仍无限请求被拒工具。分别改为检查最新消息、在挂起点发信号、收到拒绝后返回失败结果，不延长原超时或放宽权限断言。官方夹具最初将规划提示中的“核验者”误判为核验阶段，又取消了角色明确允许的文件写入；之后只批准角色声明的文件路径。最后修正数组式消息提取和不跨反引号的路径匹配，避免转义换行让正则捕获错误文件名。原日志 `workspace-{cli,desktop,official}*.log` 均保留。早期单测的文件 API、测试回复构造、路径模式和子会话数量断言错误修正后，整组重新运行；最终通过数来自稳定代码。

本阶段没有新增 UI，也没有重新完成全仓单测、所有原生窗口或跨平台验收。上一阶段的未知原生启动退出与性能差异继续保留。Goal 仍缺独立 scratch/文件报告、角色模型/工具配置、策略调整/进度摘要和原生 V2 Protocol/Runner；Memory V2、Workflow、媒体、Shell/配置、Hooks/Sandbox、Plugins 兼容与本地化边界继续按差距表执行。未提交、推送或合并，未重启用户已有应用或服务。

## 2026-10-14：Goal 规划/核验模型与本地 agent 配置

增加 `goal.planner_model`、`goal.skeptic_models`、`goal.use_current_model_only` 和 `GROK_GOAL_USE_CURRENT_MODEL_ONLY`。配置使用原子的 `{model, agent_type}`；当前 agent_type 选择 Apexo 内置或用户配置的 agent。核验池按索引轮流分配，既有分配跨恢复固定，扩容只追加、缩容与强制继承不删除旧分配。普通工作模型和无工具 evaluator 保持当前会话选择。

实际执行采用选定模型、agent 提示与权限。角色自身和父会话的禁止规则均保留，不能被子会话通用 allow 覆盖。找不到模型/agent 或角色缺必要能力时整组回退；显式角色执行失败最多尝试一次当前模型，先检查预算与所有权，取消不重试。若失败调用缺失用量，即使后续模型成功仍暂停，不掩盖不完整计费。新增可选 `plannerExecution`、逐人 `execution` 与 `skepticModels`，包含实际模型、agent 和回退原因；无需 SQL 迁移。

最终验证（日志前缀 `/tmp/apexo-goal-role-`）：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| CLI / 最终生产 Electron 角色专项 | 各 11 项、95 次模型请求通过；真实文件读取、父/角色工具限制、模型池、重启持久化、配置优先级、未知/不可用 agent 与模型、一次回退、取消不重试 | `cli-final.log` / `desktop-complete.log`；首个 fixture `apexo-shell-cli-9Vj9gr` / `apexo-shell-desktop-pwHJHS`，取消 fixture `apexo-shell-cli-VZqu72` / `apexo-shell-desktop-iBjRIH` |
| 受影响整组回归 | 309 pass、1 既有 skip、0 fail，1192 断言，7 文件 | `regression-final.log`，68.92s；Goal/Prompt/Tools/LLM/Goal HTTP/RuntimeFlags/Config |
| 全仓类型 | 21/21，全量执行无缓存 | `all-types.log`，61.258s |
| 生成、构建与格式 | SDK、Client 生成校验、静态配置 Schema、Desktop 最终构建、源码格式与差异检查通过 | `sdk.log`、`client-check.log`、`schemas.log`、`desktop-final-build.log`、`format-check.log` |
| 官方安装版强制继承 | 4 项、22 次模型请求通过 | `official-current.log`；`apexo-goal-official-lcY1zG` |
| 官方安装版未知角色模型回退 | 4 项、22 次模型请求通过；核验池中的未知模型采用当前模型 | `official-unknown.log`；`apexo-goal-official-sxLT3D` |
| 官方安装版显式模型池 | 核验模型池生效；规划模型覆盖 **partial** | 严格断言失败 `official-explicit.log` / `apexo-goal-official-CHZQHi`；独立观察 `official-observe.log` / `apexo-goal-official-oCVW7v` |
| 固定官方源码测试二进制 | planner 26、Goal 配置 43、核验分配 5 项通过 | `source-planner.log`、`source-config.log`、`source-assignment-final.log`；固定 checkout 的 `target/debug/deps/xai_grok_shell-030c1142e110c722` |

官方差异没有放宽为通过：安装版两次都将 planner 发给 `fixture` 而非配置的 `fixture-planner`，事件 `goal_planner_fired.model_id` 也是 `fixture`；核验者同时正确使用 `fixture-skeptic / fixture / fixture-skeptic`。严格模式继续断言规划模型；新增观察模式输出 `status: partial` 和 expected/observed，保留原始模型请求。源码 planner/config 测试只能证明该源码测试范围，不替代安装版行为。未知模型对照的规划阶段本就继承当前模型，不能据此单独证明规划模型回退，核验池结果才是该项实测证据。

失败修复记录：新增模型元数据起初混用了 Schema `id` 和兼容会话 `modelID`，导致首次类型检查和 11 个 Goal 集成失败；已在执行边界显式转换，之后 15 项集成及最终整组通过。一次断言的 branded ID 类型也已修正。分配持久化测试原先跳过恢复后的工作轮次，违反 Goal 接纳规则；补齐真实工作/完成申请后通过。CLI 初次权限夹具同时给父会话全局 allow，覆盖了父 agent 的 webfetch deny；改为父会话明确 deny，保留全局 allow 与角色 bash deny，验证两类拒绝均生效。首次源码 assignment 过滤词命中 0 项，未计为通过，修正为现有 5 项测试名后实际运行。`enabled/disabled` 等布尔拼写依据固定源码 `xai-grok-env/src/registry.rs` 补齐，既有 Memory 布尔解析共用此函数并纳入最终回归。

使用与当前边界见 Goal 文档。此阶段实现本地模型/agent 选择，不冒充官方 `cursor`、`grok-build-plan` 等专有 harness 风格切换；策略角色、独立核验文件、策略调整/摘要、原生 V2 和剩余差距继续保留。没有新增 UI，未重跑完整全仓单测、全部原生窗口、性能或跨平台验收，不能用 309 项扩大为全项目通过。未提交、推送、合并或重启用户已有应用。

## 2026-10-14：Goal 私有规划与逐人核验文件

兼容执行器现在为每次规划和核验分配独立私有目录，规划者实际调用受限 write 写入 Markdown，核验者实际写入 JSON 判定与 Markdown 明细。终端回复不参与判定；文件缺失、损坏、为空、超过上限或输入哈希被修改均暂停，不得自报成功。原始目标、冻结材料及核验计划有不可变哈希检查；每个调用只拥有自己的报告路径。worker scratch 与核验输出分开，规划及报告路径/字节数/SHA-256 随 Goal 状态持久化。

写工具经宿主插件 Hooks 与 edit 权限；前后检查当前 Goal 尝试，取消后封闭写入能力。存储使用私有目录、排他临时文件与原子替换；读取拒绝符号链接、硬链接、特殊文件、目录替换和无效 UTF-8，并检查读取期间文件变化。所有权检查和唯一目录阻止旧结果覆盖新尝试；本机制不是 OS sandbox，已有 Shell 仍受宿主权限约束。

本阶段最终证据（日志前缀 `/tmp/apexo-goal-files-`）：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| CLI / 最终生产 Electron 文件专项 | 各 11 项、92 次真实模型请求通过；真实文件写入、终端文本不覆盖判定、三人路径隔离、内容哈希、重开读取、越界、缺失/损坏/空报告、目标/计划篡改、edit 拒绝、取消 | `cli-final.log` / `desktop-final.log`；fixture `apexo-shell-cli-TzdimC` / `apexo-shell-desktop-nQwFKe` |
| 官方安装版文件对照 | 3 项、22 次请求通过；实际工作区读取、规划 Markdown 与核验 JSON/Markdown 写入、三人核验完成 | `official.log`；`apexo-goal-official-9uDNdh`；`--execute --workspace` |
| 文件边界单测 | 5 项、38 断言通过 | `unit.log`；之后纳入整组 |
| 最终受影响整组 | 314 pass、1 既有 skip、0 fail，1242 断言，8 文件，62.28 秒 | `regression-diagnostic.log` |
| 类型、生成及构建 | 类型 21/21（18 缓存、3 重跑）；SDK、Client 生成校验及最终 Desktop 构建通过 | `all-types-final.log`、`sdk.log`、`client.log`、`desktop-build-final.log` |

旧夹具改为发送实际文件工具调用；既有预算场景的新增结束/明细回复显式返回零用量，保留原预算断言。新的文件专项每个请求返回 120 tokens 并检查总量，覆盖真实多轮计费。脚本将原有模型决策计数与全部模型请求计数分开，额外写文件调用不再隐含到旧计数中。

失败记录已依照新增 AGENTS.md 规则按类型归档到 [docs/testing](./testing/README.md)：测试服务类型引用、旧夹具协议/计数和错误命令目录均已修复验证。首轮整组有 4 项原期限超时；下一轮有 2 项规划传输失败，单独 15 项和最终整组通过。两种现象根因均未确认，保留为待调查，不能把重跑通过当作修复。没有通过增加期限或忽略用量缺失使测试通过。当前没有有证据的三次同根因复发，规则索引活动约束数为 0。

本阶段不包含新增报告管理 UI/远程浏览器下载、报告自动清理或 Git 基线 diff 材料；这些与原生 V2、官方专有 harness/策略角色及策略调整继续保留。未重新完成全仓单测、全部原生窗口、性能与跨平台验收。没有提交、推送、合并或重启用户已有应用。

补充回归：最终角色配置 CLI/Electron 各 11 项，均为 95 个模型决策、158 次实际请求（`roles-cli.log` / `roles-desktop.log`）；工作区专项 CLI/Electron 各 7 项，45 个模型决策、56 次实际请求（`workspace-cli.log` / `workspace-desktop.log`，CLI 原日志的 requests 字段仍是决策数，实际请求见其 fixture 的 calls.json）。控制 API 修复取消同步点后两端各 18 项、102 个模型决策/185 次请求通过，日志 `api-cli-fixed.log` / `api-desktop-fixed.log`，fixture `apexo-shell-cli-AepLNX` / `apexo-shell-desktop-uDWGAC`。

Desktop API 首次失败是夹具仅等待 executing 阶段便取消，而尚未确认请求已到达 provider；此时不应强求 usageIncomplete。修复为等待实际请求进入已有挂起点后再取消，原断言及期限保留，未改产品。记录 [BUG-20261014-004](./testing/test-fixtures/goal-cancel-provider-readiness.md)。文档编辑/测试工作目录错误在本轮第二次出现，已在 [BUG-20261014-003](./testing/test-fixtures/test-working-directory.md) 累计为 2 次，尚未达到提炼新约束的阈值。

## 2026-10-14：Goal Git 基线与核验变更材料

兼容控制入口创建 Goal 时记录 Git HEAD，精确重试、暂停/恢复和重开保留原值；核验对比原基线与当前工作区，覆盖后续提交、暂存与未暂存的净变更，并单独列出未跟踪文件。清单在 patch 截断前获取，每轮只采集一次，各核验者收到同一份材料在其权限范围内的内容。新增 changes.patch / changed-files.json 私有文件及持久路径、SHA-256、字节数，结束时检查不可变哈希。

采集不改变工作区/index，禁用 external diff 和 textconv，使用 literal pathspec、NUL 文件列表、输出上限与期限。patch 上限 256 KiB；截断、权限省略和材料不可用均显式标记。read deny/ask 不进入自动材料。核验仍需检查当前文件与运行结果；已有未提交改动可能包括创建前的工作，不将净 diff 当成“全由 Goal 产生”的证明。

三端专项发现原有核验消息会转发宿主生成的 summary diff，绕过上述 read 过滤。已去掉该自动摘要及 patch/step snapshot 元数据，保留用户对话、附件和实际工具回执；真实核验请求检查旧的受限文件内容不泄露。记录 [BUG-20261014-010](./testing/permissions/goal-review-summary-diff.md)。

本阶段证据（日志前缀 `/tmp/apexo-goal-changes-`；模型请求均经过隔离 fixture 服务）：

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| CLI Git 材料专项 | 7 项、109 次实际模型 HTTP 请求通过：创建后提交/精确重试、真实 Shell 暂存和工作区改动、整轮材料一致、deny/ask 隔离、大 patch/完整清单、篡改暂停、无基线明确不可用、进程重开 | `cli-permissions.log`；`apexo-shell-cli-7GP6SW` |
| 最终生产 Electron 后端 | 同一专项 7 项、109 次请求通过 | `desktop-permissions.log`；`apexo-shell-desktop-o42QKV`；中断后重新检查最终日志及输出，未重复启动 |
| 官方安装版 1.0.52 | 4 项、25 次请求通过；持久基线、提交/暂存/工作区 patch、未跟踪列表、三人共享材料、真实工作区/patch 读取和文件报告 | `official-final.log`；`apexo-goal-official-3TpQsp`；命令 `grok-goal-official.mjs --execute --changes` |
| 单元与受影响整组 | 最终 320 pass、1 既有 skip、0 fail，1273 断言，9 文件，56.14 秒 | `regression-diagnostic.log`；独立 Git/文件专项先前 11 pass，之后增补材料篡改覆盖纳入整组 |
| 类型 / 生成 / 构建 | 全仓类型 21/21（20 缓存、1 重跑）；旧 SDK 再生成、Client generate/check:generated 和最终 Desktop 构建通过 | `all-types-final.log`、`sdk.log`、`client-generate.log`、`client-check.log`、`desktop-build-final.log` |

整组首轮 319 pass、1 skip、1 个 HTTP 生命周期 5 秒超时。增加请求阶段诊断后，独立三项及相同整组均通过；最终生命周期请求共 192 毫秒，整个测试约 1.17 秒。未找到原超时根因，继续保留 [稳定性调查](./testing/test-stability/goal-suite-timeout.md)，不以重跑通过冒充修复。

本轮修复另包括服务 Layer 显式导出、Effect.try API 签名，以及测试夹具的官方路径提取、完成后临时 patch 清理和 Shell 工具名称问题，分别登记为 BUG-20261014-005 至 009；具体失败日志和修复验证见 [测试索引](./testing/README.md)。没有已证实三次同根因复发，因此活动约束仍为 0。

仍未完成：无基线时按创建时间查提交/空树/非 Git mtime 的回退采集、计划变更策略、报告浏览/下载/清理、原生 V2 执行器、官方专有 harness/策略角色及其他总表差距。本阶段未重新完成全仓单测、完整原生窗口、性能与跨平台验收；没有提交、推送、合并或重启用户已有应用。

## 2026-10-14：Goal 无基线变更材料回退

兼容核验现在按三层采集材料：原始 Git 基线；创建时间窗口内最早提交的父节点至当前 HEAD（首次提交使用该仓库格式的空树）；当前文件 mtime 扫描。缺省/失效基线、工作期间新建仓库和非 Git 目录均有明确路径。原始创建基线始终保持不变，材料另记 source、derivedBaseline 与 head，仍由整轮共享、各角色权限过滤和不可变文件哈希保护。

历史回退只覆盖已提交范围，并另列未跟踪路径，不能代替对当前未提交内容的工作区检查。mtime 展示当前内容，无法重建旧版本或已删除文件。扫描遵守读取权限和本地 ignore 文件，跳过依赖/构建目录及链接；单文件 64 KiB、总 patch 正文 256 KiB，清单先于正文截断获得。二进制只给出大小。遍历深度、条目、输出和耗时有界，文件/目录身份在读取前后校验；材料不可用不代表没有变更。这些限制已写入材料及 [Goal 文档](./goal-feature.md#无基线时的变更材料回退)。

以下日志前缀为 `/tmp/apexo-goal-fallback-`；模型 HTTP 请求经过隔离 fixture，未将固定响应场景冒充开放任务的模型质量验收。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| CLI 回退专项 | 5 场景，各 20 次实际 HTTP 请求，全部退出 0；新仓库/首次提交、已有父提交、非 Git mtime、完整清单与大文件截断、空结果；每场景均强杀重开并检查持久状态 | `cli-final.log`；fixture `apexo-shell-cli-yb2WY6`、`dJKMaq`、`pn38qu`、`VX9iDB`、`uHXPCz`（后四项沿用同一前缀） |
| 生产 Electron 后端回退专项 | 相同 5 场景、100 次请求通过 | `desktop-final.log`；fixture `apexo-shell-desktop-QnlBsl`、`yk0xul`、`mia7fN`、`e2b9L7`、`2P2CQ2`（后四项沿用同一前缀） |
| 已有 Git 材料回归 | CLI / Electron 各 7 项、109 次请求通过；保留提交/暂存/工作区、deny/ask、整轮一致、截断、篡改暂停、重开检查；missing-base 改为检查实际 mtime 回退 | `baseline-cli.log` / `baseline-desktop.log`；fixture `apexo-shell-cli-8EoEIt` / `apexo-shell-desktop-r22IuL` |
| 官方安装版 1.0.52 | `--execute --fallback=initial`、`parent`、`mtime` 三组各 4 项、25 次请求通过；实际读取共享材料并写入报告 | `official-initial.log` / `official-parent.log` / `official-mtime.log`；fixture `apexo-goal-official-DtdnTO` / `eUZ285` / `MvXqNB` |
| 官方固定源码 | 已构建的 Shell 测试二进制 `capture_changes_diff --test-threads=2`：13 pass、0 fail，覆盖逐层回退、忽略目录、mtime 同秒、二进制和限额 | `official-source.log`；源码 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` |
| 受影响整组 | 327 pass、1 既有 skip、0 fail，1311 断言，10 文件，86.42 秒；新增 7 项覆盖 SHA-256 空树、失效基线、无窗口提交、权限、ignore、链接及截断 | `regression.log`；原 9 文件加 `goal-changes-fallback.test.ts`，原测试期限不变 |
| 类型 / 生产构建 | 全仓类型 21/21（19 缓存、2 重跑）；生产 Desktop 构建退出 0 | `all-types.log`、`desktop-build.log`；本阶段未修改公共 Schema / HttpApi，不需要再生成 SDK |

两端首次 mtime 测试失败来自夹具将裸 `secret.txt` 当成非 Git 全局 worktree 相对路径。补充 `**/secret.txt` 后，模型实际读取回执和最终材料的内容隔离断言均通过；未改变产品权限语义或删减断言。按类型记录为 [BUG-20261014-011](./testing/test-fixtures/goal-fallback-permission-pattern.md)，同一轮两个后端使用同一错误配置计作一次发生。记录和约束索引的 16 个 Markdown 文件本地链接检查通过，活动约束仍为 0。

这次整组通过不证明此前超时或模型请求失败已修复，原有调查继续保留。剩余工作包括报告管理/清理、计划变更与策略角色、原生 V2、其他功能差距及当前全部改动的最终整体验收；本阶段没有完成全仓单测、完整原生窗口、性能或跨平台验收，没有提交、推送或合并。

## 2026-10-14：Goal 报告查看、下载与显式清理

已接入按 session/Goal 隔离的报告目录、目录元数据、完成/未完成条目、授权列表/纯文本读取及删除接口。客户端只传服务端生成的报告 ID 和固定文件 key；当前计划与保留的核验报告以数据库哈希校验。旧平铺目录在清除状态前持久化归属日志，隔离删除可以重新打开后恢复。可恢复的 Goal 禁止删除报告；完成/预算停止可确认删除，清除 Goal 会先停止执行并清理文件，会话消息和项目文件保留。

Headless CLI 支持 reports/report/cleanup-reports、JSON/标准输出和本地新文件保存；mini/fullscreen 支持浏览、预览、保存及确认清理。Desktop 通过同一 SDK 查看和真实浏览器下载，中英文操作文案已加入，打开面板才请求报告。远端替换 Goal 时按目标 ID 重建报告状态，不保留旧预览和确认。

本阶段最终证据：

| 验证 | 结果与证据 |
| ---- | ---------- |
| CLI 后端、重开和真实 CLI 子进程 | 8 项，17 次模型请求，`/tmp/apexo-goal-reports-cli-verified.log`，`apexo-shell-cli-GRA9Do` |
| 生产 Electron 后端 | 8 项，17 次模型请求，`/tmp/apexo-goal-reports-desktop-verified.log`，`apexo-shell-desktop-bEc534` |
| 生产 App 连接 CLI / Electron | 各 12 项，包括实际下载和面板打开时远端替换 Goal；`ui-cli-verified.log` / `ui-desktop-verified.log`，`apexo-shell-cli-5xsTzD` / `apexo-shell-desktop-lUDpw2` |
| 真实 PTY mini / fullscreen | 各 8 项，含实际保存、预览退出及确认清理；`tui-mini-verified.log` / `tui-fullscreen-verified.log`，`apexo-shell-cli-dnScX1` / `apexo-shell-cli-6vlMCt` |
| 真实 macOS Electron 窗口 | 修复夹具视口外点击后 7 项通过；`native-fixed.log`，`apexo-shell-cli-4tFJjT`；中文界面、报告实际下载、删除与清除均覆盖，每次点击检查真实事件命中 |
| 官方安装版 1.0.52 | `grok-goal-official.mjs --execute --changes` 4 项、25 次实际模型请求；`official.log`，`apexo-goal-official-Hi3fk0` |
| 固定官方源码终态清理 | `terminal_transitions_ --test-threads=2` 5 pass、0 fail；`official-cleanup.log` |
| 受影响整组 | 332 pass、1 既有 skip、0 fail；1334 断言、11 文件、62.11 秒；`regression.log` |
| 类型检查 | 全仓 21/21、18 缓存，`types-last.log`；随后终端修复的包级 `bun typecheck` 退出 0，`tui-types.log` |
| 公共 HTTP API | coverage/auth/effect 各 232 pass、0 fail、0 skip、0 missing；`httpapi.log`，包含 3 条新增报告路由 |
| 客户端生成及 CLI 帮助 | Client generate、check:generated、legacy SDK build 均退出 0；CLI 帮助 1 pass、43 断言、37 份快照更新，`help.log`，包含之前新增的 Memory/Plugins 与本轮 Goal 选项 |
| 构建 | App 最终构建退出 0；Desktop 首次模型目录下载证书失败，安全 curl 下载后用已有 MODELS_DEV_API_JSON 构建退出 0，未关闭 TLS 验证；`desktop-build-snapshot.log` |

除明确写出完整路径者外，上表日志前缀均为 `/tmp/apexo-goal-reports-`。日志和临时截图只作为本地验证证据，不将其当成跨平台 CI。原生报告预览和清除前画面已人工检查，滚动后操作可见；核验内容中的英文为夹具模型输出，不是本地化遗漏。中文术语参考 VS Code 简体中文与 Firefox zh-CN 语料，其他语言仍按现有 fallback，不能声称全部新增文案已完成各语言原生审阅。

本次已修复并记录：服务依赖缺失第二次 [BUG-005](testing/types/goal-changes-service-layer.md)、可变磁盘哈希替代权威值 [BUG-012](testing/permissions/goal-report-catalog-authority.md)、旧报告清理恢复 [BUG-013](testing/persistence/goal-report-legacy-cleanup.md)、目标替换状态 [BUG-014](testing/ui/goal-report-replacement-state.md)、Fullscreen 父组件重建 [BUG-015](testing/ui/goal-terminal-report-root.md)、终端预览误判 [BUG-016](testing/test-fixtures/goal-terminal-preview-readiness.md)、原生夹具视口外点击 [BUG-017](testing/test-fixtures/goal-native-offscreen-click.md)。BUG-015 有四次独立运行证据，已提炼 [RULE-001](rules/tui-dialog-stable-root.md)，活动约束数 1。BUG-014 为静态发现，不推测修复前运行次数。

原生窗口早先三个缺少事件轨迹的失败仍保留原始证据，不强行并为已确认复发；后续明确捕获的视口外点击已修复。整组 5 秒超时与历史模型请求失败的根因调查仍保留。关闭报告面板时的生产输入框性能基线中位数/p95 为 113.5/123 ms，本次首轮改动后为 163.5/200 ms；[INV-005](testing/performance/goal-report-composer-baseline.md) 保留退化结果并继续诊断，不能称为性能验收通过。

当前留存完整报告供下载；官方完成/预算停止会移除 scratch 并另存摘要，因此两者留存策略仍不一致。**会话删除时回收、后台保留期及终态 scratch 生命周期、原生 V2、策略角色/可变计划、其他功能差距和全量跨平台验收仍未完成。** 本阶段没有提交、推送或合并，不将局部功能通过写成整个目标完成。

追加视觉复核：新增 [BUG-018](testing/ui/goal-report-preview-visibility.md)，点击查看后预览已在 DOM 中但位于弹窗可视区域之外。已补查看成功后的绘制帧滚动，下载保持列表位置，并将可见性/命中检测加入 CLI 和 Desktop 浏览器及原生窗口脚本。App/生产 Desktop 重建及 App 类型检查通过；最终浏览器两端各 12 项通过，日志 `ui-cli-preview.log` / `ui-desktop-preview.log`（同上前缀），夹具 `apexo-shell-cli-ZdnQej` / `apexo-shell-desktop-3Wnvcn`；原生最终 7 项通过（`native-preview-final.log`，`apexo-shell-cli-0tdoWU`），截图已确认正文可见；中间新增夹具绘制回调等待问题已另记并修复 [BUG-019](testing/test-fixtures/goal-native-animation-frame-wait.md)，没有放宽期限或取消断言。官方安装版再次 4 项、25 次请求通过，`official-final.log`，`apexo-goal-official-oqSe53`。

性能诊断追加：产品代码不变的一次运行中位数/p95 为 122.5/141 ms，宿主 1 分钟负载约 6.6–6.8，无长任务及报告资源/API 请求；较先前 163.5/200 ms 波动明显，仍不能据一次更快重跑证明原因或修复。完整逐次资源/导航/负载已保存于 `apexo-shell-desktop-xSxign/plugins-benchmark-diagnostics.json`。

中文操作术语交叉参考：[VS Code zh-Hans](https://raw.githubusercontent.com/microsoft/vscode-loc/main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json)、[Firefox zh-CN](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-CN/browser/browser/menubar.ftl)。角色名与完整新文案仍保留母语审阅范围。

预览滚动修复后的性能复测：中位数/p95 为 136.5/191 ms（`benchmark-preview.log`，`apexo-shell-desktop-KgazhG`），仍有波动，保留在 INV-005，不标记性能通过。文档/约束本地链接最终检查 30 份、0 个缺失；本轮涉及文件的 `git diff --check` 通过。全部本轮测试进程已正常完成或记录失败并完成清理，没有因观察超时另起重复测试。


## 2026-10-14: Durable Goal report and scratch cleanup

Implemented a database-owned cleanup queue that survives Session/Goal cascade deletion. Completion and budget stops remove system-owned worker scratch after the scoped executor closes, while retaining downloadable reports. Clearing a Goal and deleting a Session capture fixed report IDs before deleting ownership. Startup recovery and one-minute bounded retries handle failed removals and deletion quarantines. Same-ID replacement, resumable Goals, unrelated Sessions/databases, and project files are protected. Corrupt Goal state no longer blocks Session deletion, and deletion retains cancellation of detached jobs owned through `ownerSessionId`.

Verification performed on macOS with pinned Bun 1.3.14:

| Scope | Result | Reproducible command / coverage |
| --- | --- | --- |
| CLI cleanup lifecycle | Final run: 7 checks passed, 22 provider requests | `bun script/grok-goal-cleanup.mjs cli`: pause, terminal/budget scratch, clear/delete failure, real process death/reopen, periodic retry without restart, prior-Goal cleanup and unrelated-file preservation |
| Production Electron backend | Final rebuilt run: 7 checks passed, 23 requests | Same script with `desktop`, including the final detached-job deletion fix |
| Task contracts and real process cancellation | CLI and production Electron: 25 cases each passed | `bun script/grok-task-contract.mjs cli` and `desktop`; deleting the owning Session terminates its detached Shell PID while preserving an unrelated live Shell |
| Report regression | CLI and Electron each 8 checks, 17 requests | `bun script/grok-goal-reports.mjs cli|desktop`: authenticated bytes/hashes, real CLI save/no-overwrite, tamper rejection, reopen, explicit cleanup and transcript preservation |
| Core cleanup | 5 tests, 27 assertions passed | `GITHUB_ACTIONS=false bun test test/session/goal-cleanup.test.ts`: database upgrade/cascade/reopen, shared data root, fixed-ID retry, symlink refusal and scratch preservation |
| Affected Goal/HTTP/prompt suite | Final sequential run: 155 pass, 1 existing skip, 0 fail, 888 assertions, 57.78 s | `GITHUB_ACTIONS=false APEXO_TEST_GOAL_TIMING=1 bun test test/session/goal-cleanup.test.ts test/session/goal-reports.test.ts test/server/httpapi-goal.test.ts test/session/goal.test.ts test/session/prompt.test.ts` |
| Typecheck | Final run: 21/21 passed, 20 cached | `bun turbo typecheck --concurrency=2`, after the detached-job change |
| Desktop build | Final production build passed | From `packages/desktop`: `bun run build`, using a verified model-catalog snapshot through `MODELS_DEV_API_JSON` |
| Database generation | Generation and consistency check passed | From `packages/core`: `bun script/migration.ts --name goal-cleanup`, then `bun script/migration.ts --check` |
| HTTP API gates | coverage/auth/effect: each 232 pass, no failures/skips/missing routes | `bun run test:httpapi`; executed before the final detached-job change |
| Installed Grok 1.0.52 | 4 checks, 25 requests passed | `bun script/grok-goal-official.mjs --execute --changes` |
| Installed Grok task contracts | 13 cases passed | `bun script/grok-task-contract-official.mjs`; input boundaries and host wait cap, not equivalence of Session deletion APIs |
| Pinned Grok source | 5 terminal-transition tests passed | `terminal_transitions_` filter at source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, including scratch removal and classifier-detail rescue |

The first affected-suite run had one HTTP concurrency-test timeout at the existing five-second deadline. The unchanged-deadline sequential run passed; this does not establish a root cause or fix. Keep [the timeout investigation](testing/test-stability/goal-suite-timeout.md) open.

Native full-window verification subsequently passed all seven checks with recorded click hits, verifier expansion, localized preview/download, cleanup, and clear. Geometry showed asynchronous preview scrolling, so the fixture now waits on the original visibility predicate. Earlier immediate and sustained visibility failures, plus one separate dialog disappearance, remain under investigation. The preceding isolated six-check diagnostic was not counted as full acceptance. See [native preview investigation](testing/test-fixtures/goal-preview-paint-readiness.md); a passing full rerun does not prove the unexplained failures fixed.

New fixes and records: [Effect error boundary](testing/types/goal-cleanup-remove-errors.md), [fixture process service](testing/test-fixtures/goal-cleanup-fixture-layer.md), [corrupt Goal deletion](testing/persistence/goal-cleanup-corrupt-session.md), [reused Goal ID](testing/persistence/goal-cleanup-reused-id.md), and [detached-job cancellation](testing/runtime/session-delete-detached-jobs.md). The third evidenced working-directory mistake produced [RULE-20261014-002](rules/package-test-working-directory.md); the active constraint count is two.

This stage does not complete Goal parity. Report retention, the pre-intent crash window, native V2, strategy/harness roles, unresolved native/performance cases, and cross-platform acceptance remain outstanding. No commit, push, or merge has been performed for this stage.


### Parallel implementation checkpoint: ranking, Shell settings, media and Goal lifecycle (2026-10-14)

Three GPT-6 Astra agents work on distinct feature boundaries while the parent integrates shared builds and regression checks. This checkpoint includes uncommitted work; it is not a release or a claim of full Grok Build parity.

- **Memory ranking:** source weights, session age decay, persistent access counts/boosts, staleness hints and Jaccard MMR diversity are wired into the real index. CLI and production Electron each passed five model-facing calls. Nine focused tests passed with 60 assertions; pinned official search/MMR source passed 46 tests. Installed Grok uses Memory V2, so its file retrieval checks do not establish legacy ranking equivalence. Semantic/vector retrieval and native Context Source integration remain open.
- **Shell host settings:** `toolset.bash.default_block_until_ms`, `max_block_until_ms`, and `max_timeout_secs` now control the advertised schema and execution. CLI and production Electron each passed nine real-process cases, installed Grok passed three, and pinned official source passed 19. Other historical host options and exact long-duration/cross-platform boundaries remain open. See [Shell host configuration](shell-host-configuration.md).
- **Goal lifecycle:** report IDs are reserved before filesystem creation; terminal transitions and fixed cleanup intents share a transaction. All cleanup jobs honor live worker teardown barriers. Optional retention preserves active reports and only removes captured superseded/incomplete reports. CLI and production Electron each passed 11 storage/crash, seven lifecycle and two retention cases. The focused Goal/report suite passed 75 tests with 500 assertions. See [lifecycle durability](goal-lifecycle-durability.md). Native V2 integration, pre-upgrade terminal manifests and strategy/harness work remain open.
- **Media:** image editing, shared Imagine command templates and explicitly configured S3 video storage are implemented. A final source comparison corrected reference-video aspect ratio, image-generation defaults and S3 lifetime/credential behavior. The latest frozen combined regression includes those corrections; final rebuilt Desktop and installed-runtime reruns are tracked separately in [media parity](grok-media-parity.md). No paid production media call is represented by local protocol fixtures.
- **Desktop profile:** persisted next-launch preference and current active profile are separated. The selector supports both settings layouts and explains unavailable remote/V2 states. Three disk-backed preference tests passed with eight assertions; real native settings/relaunch acceptance is still in progress at this checkpoint. Direct use of the official backend is outside the user-confirmed delivery scope.

The frozen-source integration run passed **242 tests, one existing skip, zero failures, and 1253 assertions across 13 files in 61.58 seconds**. It covered Shell configuration/background tools, media/extensions, registry, Memory search/ranking, Goal cleanup/reports/HTTP/lifecycle and prompt execution. The existing skip concerns the disabled V2 event projector. Tests used pinned Bun 1.3.14 and the existing deadlines.

Earlier overlapping runs included one cleanup assertion with uncertain source-version provenance and three five-second Goal test timeouts. A separate run of those three timeout cases passed, followed by the frozen 13-file run above. These passes do not prove a timeout fix: [INVESTIGATION-20261014-001](testing/test-stability/goal-suite-timeout.md) remains open. The cleanup provenance note is recorded with [atomic terminal cleanup](testing/persistence/goal-terminal-intent.md).

Shared checkpoint checks passed: all 21 package typecheck tasks (zero cached), legacy SDK generation, Client generation and generated consistency, static schemas, and HTTP API coverage/auth/effect gates (232 checks each). These checks predate the final Desktop selector and last media parameter corrections; subsequent feature-specific checks and the next integration pass must cover those edits. Production Desktop builds were refreshed for the lifecycle teardown barrier. A new shared build for the selector and final media corrections is being verified.

No commit, push or merge was performed. All remaining items in the current feature table, native/legacy UI gaps, production service checks and cross-platform acceptance stay open.


Media checkpoint completion: the latest source and rebuilt Electron both passed all seven media scenarios after the final ratio and S3-prefix corrections. Installed Grok passed all four tools; the three focused suites passed 37 tests with 132 assertions, and Apexo typecheck passed. Automatic team ZDR cannot be inferred from an API key without team claims. The official upload-only fallback depends on transient presigning failures, which the synchronous static signer does not have; an actual failed GET remains an error. Neither behavior is represented as verified production media generation. See [media parity](grok-media-parity.md).

The freed Astra agent has moved to host Hooks compatibility; the Desktop agent is adding local feedback-draft review after recording a new production composer baseline. Native Goal V2 integration continues independently. These three workstreams are still in progress and need a new common build and regression checkpoint.
