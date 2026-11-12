# Codex comparison: first-batch development plan

Status: proposed design. No feature implementation is included in this document.

Prepared on 2026-11-12. Apexo baseline: `e4885b0378a0cd88b703133f435fd47383cff64a`. Codex source baseline: `c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee`. Codex references describe this source revision, not availability in every released CLI or account.

Reading map: [source comparison](#2-source-comparison), [F01](#4-f01-structured-code-review), [F04](#5-f04-mcp-form-elicitation), [F02](#6-f02-contextual-automatic-permission-review), [acceptance](#8-verification-plan), [PR sequence and estimates](#9-delivery-breakdown-and-effort).

## 1. Recommendation and scope

Implement these three capabilities in order:

1. **F01: structured code review.** Persist validated findings with priorities, precise locations, a stable review target and consistent CLI/TUI/App presentation.
2. **F04: MCP form elicitation.** Collect typed user input and continue the original tool invocation, with explicit ownership, deadlines and cancellation.
3. **F02: contextual automatic permission review.** Compare an exact pending action with trusted user intent and effective permissions; approve once only when the backend can prove the decision still belongs to that action.

F02 provenance and audit work can start earlier, but enabling automatic decisions comes last. F01 and F04 have clearer deterministic acceptance criteria. F02 needs evidence-quality evaluation in addition to working endpoints.

This batch excludes review auto-fixes, finding resolution workflows, peer-agent messaging, a new orchestration framework, replacement sandboxing, MCP sampling, URL-mode forms, biometric verification and a wholesale modern MCP protocol migration. Apexo owns all runtime behavior; none of these features depends on a Codex or Grok executable.

| Capability | User example                                                              | Completion criterion                                                                                                             |
| ---------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| F01        | Review this branch against main and show P1 findings                      | A report survives reload, has validated locations and coverage, and supports JSON, terminals and the existing diff UI            |
| F04        | An MCP tool asks for environment, quantity and confirmation               | Typed answers reach that exact call; decline, dismiss, timeout, interruption and reconnect are tested                            |
| F02        | A user authorized a particular push, but it still needs permission review | The backend cites the authorization and checks repository/remote/ref before approving once; insufficient evidence remains manual |

Apexo already has review CLI entry points, generic structured output, native Sessions, forks, goals, plans, MCP/OAuth/resources, command sandboxing, saved permissions and diff/comment presentation. These are foundations to reuse.

## 2. Source comparison

### 2.1 F01: the review command exists; the domain contract is missing

| Layer            | Codex evidence                                                                                                                          | Apexo evidence                                                                                                                      | Implication                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Entry/target     | [ReviewTarget and ReviewOutputEvent][c-review-protocol] define targets and findings                                                     | [review.ts][a-review-cli] constructs target instructions, including PR review, then calls generic headless execution                | Preserve selectors; resolve targets in Core before execution    |
| Execution        | [review session][c-review-session] selects a review model; [ReviewTask][c-review-task] uses a rubric, delegate and feature restrictions | [native-headless.ts][a-headless] admits Session input; [runner/llm.ts][a-runner] supports JSON response formats                     | Reuse the runner with a private review owner/profile            |
| Output           | Findings have title/body/priority/confidence/file/line                                                                                  | CLI permits optional `--output-schema`; no equivalent dedicated code-review finding contract was found in inspected Schema/Protocol | Make the result schema standard and host-validated              |
| UI               | Dedicated review-mode protocol and formatting                                                                                           | [ReviewPanelV2][a-review-panel] already renders diffs, comments and focused locations                                               | Add findings to the current panel; keep human comments separate |
| Public semantics | [App-server documentation][c-app-server] says `review/start` returns the supplied thread; detached callers create a thread first        | Apexo has its own managed-child architecture                                                                                        | Do not copy an obsolete detached API assumption                 |

The current CLI's review-specific read-only instruction is prompt text. Generic permission settings may restrict execution, but the command does not establish a dedicated review capability ceiling.

### 2.2 F04: form rendering is only one part of the gap

| Layer        | Codex evidence                                                                                                                                                      | Apexo evidence                                                                                                  | Implication                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Registration | [logging_client_handler.rs][c-mcp-handler] accepts elicitation                                                                                                      | [mcp.ts][a-mcp] advertises roots and registers a roots handler; native form handling is absent                  | Negotiate form support and register a handler                           |
| Routing      | [rmcp_client.rs][c-mcp-client], [elicitation_client_service.rs][c-mcp-service] and [request_input.rs][c-mcp-input] bind modern inputs and timeout pauses to callers | [mcp-tools.ts][a-mcp-tools] has Session/message/call context but calls a shared SDK Client without a form owner | Bind ownership before dispatch; never use the active window             |
| Types        | Dedicated MCP form/response types                                                                                                                                   | [Question][a-question-schema] answers are arrays of strings                                                     | Reuse UX patterns, not the lossy question wire type                     |
| Lifetime     | Pending responders, cancellation and interaction pauses                                                                                                             | [QuestionV2][a-question-core] has Deferred patterns; MCP calls currently have a fixed total timeout             | Add bounded interaction lifetime; never replay an uncertain remote call |

Apexo pins `@modelcontextprotocol/sdk` 1.29.0. Its installed `RequestHandlerExtra` exposes an inbound request ID, cancellation signal, metadata and transport session, but no general parent `tools/call` ID. The outgoing `relatedRequestId` option does not prove inbound parent-call correlation. Codex's newer continuation implementation cannot simply be transcribed into this SDK.

The [MCP 2025-11-25 form specification][mcp-forms] is the first-batch interoperability target. [Current SDK documentation][mcp-sdk] distinguishes that server-request flow from the 2026-07-28 input-required flow. A full migration is outside this batch.

### 2.3 F02: a classifier exists, but lacks authorization context and native ownership

| Layer       | Codex evidence                                                                                                                           | Apexo evidence                                                                                                   | Implication                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Evidence    | [guardian/prompt.rs][c-guardian-prompt] separates policy, transcript, exact action, root authorization, verified answers and permissions | [AutoReview.prompt][a-auto-review] sends tool/patterns/metadata; history is used to choose the model             | Build authoritative evidence, not merely a longer prompt |
| Reviewer    | [guardian/review.rs][c-guardian-review] constrains reviewer powers; [request_budget.rs][c-guardian-budget] bounds evidence               | Legacy classifier streams once with a 20-second timeout and conservative parse/error fallback                    | Preserve bounded execution via the native LLM interface  |
| API         | Backend approval routing                                                                                                                 | [Native permission API][a-permission-protocol] has create/list/get/reply/saved, but no review route              | Add native review/audit/mode contracts                   |
| Application | Decisions belong to exact actions                                                                                                        | [App permission context][a-permission-app] and legacy [TUI sync][a-permission-tui] classify and reply separately | Move automatic application to Core                       |
| Native TUI  | N/A                                                                                                                                      | Native events update pending state; the separate legacy event branch invokes automatic classification            | Legacy behavior is not native-parity evidence            |
| Authority   | Review remains constrained by policy                                                                                                     | [PermissionV2][a-permission-core] already checks inherited/configured denies and rechecks authority at reply     | Preserve this and add request/evidence/version fencing   |

The [bash approval parser][a-bash-approval], saved grants and `doctor --check-command` remain useful existing capabilities. Static command-policy evaluation should not be replaced by a model.

## 3. Shared architectural decisions

1. Serializable contracts belong in Schema; runtime/persistence in Core; HTTP definitions in Protocol; handlers in Server; generated adapters in Client; UI in TUI/App/session-ui. Client runtime cannot import Core or Server.
2. Name domains `CodeReview`, `McpElicitation` and `PermissionReview`. New canonical contracts are unversioned; evolving stored documents use `schemaVersion: 1`.
3. Keep the domains separate. Reuse lifecycle/event/ID conventions without building a general interaction engine.
4. Durable records are evidence, not authority to resume work. Reopening a report is safe; replaying tools or sampling after restart needs explicit admission.
5. Public metadata cannot mint managed-child ownership, tool invocation ownership or human authorization.
6. Preserve durable prompt admission before advisory wake, process-global Session coordination and Location-scoped execution. Each provider turn has one explicit `llm.stream(request)`.
7. Add canonical events and generated clients. Reconnect uses authoritative list/get plus revision/sequence; tolerate duplicate events.
8. Use Session lifecycle claims/incarnations and Location guards. Deletion, rewind, retirement and disposal invalidate pending work before stale application.
9. Add typed domain failures to runner/server contracts and expose services in the correct AppNode public groups.

## 4. F01: structured code review

### 4.1 Data contracts and persistence

Proposed contract: `packages/schema/src/code-review.ts`.

| Record   | Fields/semantics                                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target   | Discriminated uncommitted/base/commit/pr/custom selector, optional focus, mutually exclusive concrete selectors                                                       |
| Snapshot | Canonical repository identity, requested target, resolved base/head/merge-base, before/after tree references, changed-file manifest, capture time/hash                |
| Finding  | Host-generated ID, P0–P3 priority, title, explanation, finite 0–1 confidence, repository-relative path, old/new side, positive inclusive start/end lines, snapshot ID |
| Result   | Schema version, findings, assessment (`issues_found / no_findings / inconclusive`), summary, coverage/exclusions, model/usage                                         |
| Run      | Review ID, parent/review Session IDs, admitted input ID, snapshot/target, attempt/revision, status/timestamps and optional result/error                               |

Use `no_findings` instead of claiming a model has proved correctness. Empty findings with incomplete coverage or interrupted execution cannot silently become a clean review.

Propose `session_code_review` in `core/src/session/code-review.sql.ts`, indexed by parent Session/time, with snake_case columns and a schema-validated JSON report. A separate finding table is unnecessary until finding resolution/assignment is implemented.

Keep source blobs in content-addressed snapshot storage, not report JSON. Pin referenced trees so snapshot cleanup cannot break old reports. Session deletion cascades report records and releases snapshot references.

Proposed starting limits: 500 changed files, 5 MiB diff text, 2 MiB per text file, 200 findings, 5,000 characters per explanation. These are proposed product limits, not Codex constants. Every exclusion is visible.

### 4.2 Resolve and freeze the target

| Target      | Rule                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted | Capture HEAD and a working-tree view including staged/unstaged/eligible untracked changes; retain index identity for provenance |
| Base        | Resolve supplied ref and HEAD; capture their merge-base-to-HEAD diff                                                            |
| Commit      | Resolve exact commit and first parent; empty tree for root commit; explicitly document first-parent merge semantics             |
| PR          | Read PR metadata and pin base/head SHAs; retrieve exact content without changing the user's branch/worktree                     |
| Custom      | Treat instructions as focus; default target to uncommitted changes unless a concrete selector is provided                       |

Extend [Snapshot][a-snapshot] and [Git][a-git] narrowly for immutable reads/capture. Snapshot capture can return undefined and has size/ignore behavior; either establish a bounded review snapshot or report failure/incomplete coverage explicitly.

Use argv-based Git calls, validated refs, path separation and disabled external diff/textconv. Never change the user's index/worktree. Detect mutations during capture, retry once, then return `target_changed` if consistency cannot be established; this is not a global filesystem lock.

List binary files, submodule changes, unresolved conflicts, unsupported encodings, missing PR blobs and oversized/untracked exclusions in coverage. Review symlinks as links; never follow them outside the captured repository. Missing PR context must not be replaced by a different local revision.

### 4.3 Execution ownership and read-only enforcement

Use a managed child with proposed owner `{ kind: "review", reviewID, attemptID }`. Extend [SessionManagedChild][a-managed-child] and all owner checks explicitly; its existing union covers workflows/goals. A public metadata label is insufficient.

Publish progress/report references to the parent without interrupting or automatically continuing it. The worker receives a rubric, target manifest and focus, not a full parent transcript by default. Project text is evidence and cannot change its tool ceiling.

Materialize only bounded snapshot list/search/read/diff capabilities. Enforce this at advertisement **and settlement**. Reject fabricated shell/edit/write/plugin/MCP/task/workflow/goal/scheduler/network calls. Existing generic read-only child policies include web capabilities and cannot be reused unchanged.

Running tests inside the review worker is deferred. Host report/snapshot writes remain allowed; model tool execution cannot write project files. This keeps first-batch enforcement independently testable across platforms.

Reuse native model resolution/streaming. JSON output is currently attached to headless execution policy; introduce a review-role result contract rather than relying on a frontend flag. Request the canonical schema when the model supports it and always validate on the host.

Allow at most one format-repair turn, without tools, within the same target and turn/token/cost limits. Invalid output after repair is `invalid_output`, never an empty successful review.

### 4.4 Lifecycle, locations and staleness

Lifecycle: `admitted → capturing → running → completed | failed | cancelled | interrupted`.

- Exact retry of a review ID and canonical request returns that run; conflicting reuse fails.
- Use transactional admission patterns for the review record, ownership and input. Incomplete crash states remain detectable and cannot resume themselves.
- Commit terminal status/result with a revision. Provider completion alone is not report completion.
- Cancel only the owned child. Parent deletion terminates it and releases snapshots.
- Reconcile unfinished runs as interrupted after restart; history reads never call the provider.
- Findings must reference captured files, valid lines on their side and an overlap with changed lines. Reject traversal, reversed/out-of-range spans and invalid confidence; deduplicate exact duplicates.
- Invalid locations trigger diagnostics/repair, not silent dropping into a clean result.
- Staleness compares the report snapshot with the current workspace. Clicking a finding opens the captured diff. Current-file navigation is separate when the file changed.

### 4.5 API and all presentation surfaces

Proposed endpoints using Session placement middleware:

| Endpoint                                               | Behavior                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `POST /api/session/:sessionID/review`                  | Admit with retry ID, target/focus and optional model; return immediately |
| `GET /api/session/:sessionID/review`                   | Paginated report list                                                    |
| `GET /api/session/:sessionID/review/:reviewID`         | Run/result/revision/coverage                                             |
| `GET /api/session/:sessionID/review/:reviewID/diff`    | Bounded captured diff by manifest path                                   |
| `POST /api/session/:sessionID/review/:reviewID/cancel` | Idempotent targeted cancellation                                         |

Proposed events: `code_review.started / updated / finished`, carrying IDs/revisions and compact status. Fetch full reports rather than broadcasting source blobs.

CLI preserves selectors. Text shows priority/location/coverage; JSON emits a stable report envelope; streaming JSON emits progress and a final report. Exit 0 means completed, 1 execution/validation failure, 130 interruption. Proposed opt-in `--fail-on P1` returns 2 for findings at/above threshold.

Existing custom `--output-schema` stays on the generic compatibility path during rollout, with a compatibility notice. It cannot silently redefine the new mandatory report schema. Explicit legacy Session selection remains legacy until migrated separately.

Mini/fullscreen TUI need progress, keyboard navigation, readable findings and captured code/diff views. App/Desktop extend ReviewPanelV2 and session-ui focus primitives. Findings use distinct IDs/actions from human comments. Missing/stale locations show explicit states. A browser test does not prove a Desktop window works.

### 4.6 File-level work

| Existing points                                  | Proposed files/changes                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Schema/event manifests, Protocol/Server groups   | `schema/src/code-review.ts`, `protocol/src/groups/code-review.ts`, `server/src/handlers/code-review.ts` |
| Managed-child ownership, lifecycle, runner roles | `core/src/session/code-review.ts`, `code-review-store.ts`, `code-review.sql.ts`, `code-review-role.ts`  |
| Snapshot/Git                                     | Minimal immutable read/capture and retention APIs                                                       |
| CLI review and native output                     | Native review adapter and deterministic formatter                                                       |
| App review panel, session-ui, TUI                | Finding list/focus/filter and mini/fullscreen integration                                               |

All new filenames are proposals. Follow package namespace exports; avoid unnecessary umbrella barrels.

## 5. F04: MCP form elicitation

### 5.1 Contract and supported fields

Propose `schema/src/mcp-elicitation.ts`:

- Request ID, Session/message/tool-call IDs, server registration identity, connection generation, opaque invocation ID, message/schema, creation/deadline times, status/revision.
- Discriminated reply: `accept` with typed content, or `decline / cancel` without content.
- Internal terminal reasons: declined/dismissed, timeout, tool interruption, disconnect/disable, Session deletion, unavailable operator and restart.

Support the pinned SDK's form subset: strings with length/format constraints, finite numbers, integers, booleans, single-select string enums, multi-select string enums, required fields/defaults, titled enum representations and legacy enumNames. Defaults are visible and never auto-submitted.

Validate schema consistency and replies on the server: required-field names, bounds, formats, enum values, unknown keys, types and finite numbers. Reject unsupported nesting, arbitrary arrays/objects, remote references and constraints that cannot be honored. Validate before SDK normalization when it would silently strip unsupported keywords.

Proposed limits: 32 fields, 100 options per enum, 64 KiB schema/reply and one visible form per invocation. Queue additional forms with their original deadlines.

The [form specification][mcp-forms] excludes passwords, API keys, access tokens and payment credentials. Identify the server/destination; treat labels/descriptions as untrusted display content. A form answer is not a saved grant or authorization for unrelated tools.

### 5.2 Exact invocation ownership

**Recommended first implementation:** when form support is enabled for a server, use an invocation-owned client/transport for its interactive `tools/call`. Keep the existing shared catalog/control connection non-eliciting.

This costs startup time, particularly for stdio, but SDK 1.29.0 has no general inbound parent-call correlation. Never reassign that transport generation to another invocation.

1. Mint a private owner from actual Tool.Context, Session lifecycle claim and server registration/config revision.
2. Apply normal tool permissions and network policy before opening the invocation connection.
3. Reuse transport/OAuth factory code. Register `elicitation: { form: {} }` and its handler before connect; do not advertise URL mode.
4. Initialize and validate the tool definition against this connection. A changed schema requires refresh and a new model call, not silent execution under changed semantics.
5. Arm the owner immediately before the single callTool. Reject initialization/listing/idle forms as unavailable.
6. The handler captures extra.requestId/extra.signal, validates the form and creates pending state bound to both SDK cancellation and parent interruption.
7. A UI reply resolves that exact handler once; the existing tool call continues. Do not submit tools/call again.
8. Close/dispose on completion/cancellation/failure; late requests cannot reach another invocation.

Share OAuth credentials and refresh coordination; do not duplicate secret stores or browser auth flows. Bound per-server concurrent invocation connections and make queued admission cancellable. Test both stdio and streamable HTTP.

**Compatibility limit:** services requiring one long-lived session, catalog-connection state, or exclusive process ownership cannot use this first form path. Retain their existing non-interactive support and show an explicit unsupported mode.

A shared-connection mutex is cheaper but lacks explicit delayed-request origin and can stall unrelated Sessions. It is not the default. Future negotiated correlation or modern request-local continuations can remove the extra connection without changing public form contracts.

The first F04 PR must prove this design with concurrent Sessions and late/cancelled requests against real fixture servers. A product integration requiring connection continuity remains unsupported until a separately reviewed correlation design exists.

### 5.3 Live state, receipts and clocks

Use a Location-scoped McpElicitation service for live Deferred responders, plus Session-owned persisted receipts. Private owner objects are neither serialized nor accepted in HTTP requests.

Separate startup time, active tool-execution time and human wait. Proposed initial waits: 5 minutes per form, 10 minutes cumulative per invocation. Show deadlines; pausing one invocation never extends another.

McpTools currently supplies equal timeout/maxTotalTimeout. Add an Apexo active-time budget that pauses only for its pending forms, alongside an absolute wall-clock cap. Set the SDK timeout to the hard cap and use the invocation AbortSignal to enforce active time. Progress notifications must not reset unrelated/global deadlines.

| Event                        | Outcome                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| Valid accept                 | Send typed content once and continue original call                    |
| Invalid accept               | Return field errors; retain pending state/deadline                    |
| Decline                      | Send action=decline without content                                   |
| Escape/dismiss               | Send action=cancel without content                                    |
| Deadline                     | Record timed_out; cancel if live, otherwise settle locally            |
| Tool/Session interruption    | Settle forms and abort only the owned call                            |
| Frontend disconnect          | Keep live form until deadline; another surface can reload it          |
| MCP transport disconnect     | Mark interrupted/unavailable; fail the call without replay            |
| Server disable/config change | Retire owned generations for that registration                        |
| Process restart              | Historical pending receipts become interrupted; no responder survives |

A submitted answer is not proof of successful tool completion. Network/process failure after submission can leave remote outcome unknown. Never claim exactly-once external execution.

Persist minimal receipts: ownership IDs, schema digest, field names, action, reason and timestamps. Pending schema/message and values remain live by default. Do not put reply bodies in general logs, durable events, permission evidence or automatic exports. The server may include answers in its eventual tool result; clearly identify the destination.

### 5.4 API, UI and unattended policy

Propose list/get/reply routes under `/api/session/:sessionID/mcp/elicitation`. Replies include expected revision/idempotency key. Exact retry returns the existing receipt; conflicting responses fail. If comparing retries requires a content digest, use a process-local keyed digest rather than persisting brute-forceable value hashes.

Events: `mcp.elicitation.requested / settled` with IDs/revisions/safe status. Live list/get is authoritative on frontend reconnect.

Reuse question-dock layout/focus, but implement typed controls. Both terminal modes need field navigation, optional blanks, enums/multi-select, validation, decline and cancel. App/Desktop need equivalent keyboard/accessibility behavior. Opening a form never submits defaults.

Headless/scheduled/unattended calls fail clearly when input is needed. `SessionExecutionPolicy.unsupported` already names mcp_elicitation, but this inbound request bypasses model-tool selection; enforce policy in the handler too. Generic auto mode and F02 cannot fabricate answers.

This batch supports forms during model-visible tools/call. Resource browsing/attachments, initialization and connection-level operations stay non-eliciting and reject unsupported input explicitly.

### 5.5 File-level work

| Existing points                                               | Proposed changes                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Core mcp.ts/mcp-tools.ts/mcp-oauth.ts/mcp-stdio.ts            | Shared transport factory and invocation-owned connection path |
| Question Deferred pattern, Location guards, Session lifecycle | `core/src/mcp-elicitation.ts` and `mcp-elicitation.sql.ts`    |
| MCP/Session Protocol and Server groups                        | Typed endpoints, events, manifests and generated clients      |
| TUI native adapters, question routes, mini flow               | Typed form component and reconnect state                      |
| App question dock and MCP manager                             | Form dock and per-server capability/compatibility display     |

## 6. F02: contextual automatic permission review

### 6.1 Place authority in the backend

The feature is a new native Core service, not an extra frontend call to the legacy classifier. Keep existing configured/saved/inherited rule semantics and manual permission replies.

Use explicit modes: `manual / review`. Existing full-auto behavior remains a separate explicit product mode and must not be silently reinterpreted. During rollout, F02 has `off / shadow / enforce` policy states: shadow records decisions but never auto-replies.

Propose `PermissionReview` contracts for evidence summaries, decisions and audit records. Model decisions are `allow_once / ask`. Hard denial comes from authoritative policy, not a model inventing permanent rules. The service never emits an automatic always/save grant.

Normal execution:

1. Evaluate hard policy and effective authority.
2. Existing allow proceeds without unnecessary model review.
3. Existing deny blocks, with no model bypass.
4. For ask, register the pending request and an internal runtime owner.
5. If review mode is enabled and evidence is eligible, evaluate once under bounded resources.
6. Apply allow_once only through fenced PermissionV2 settlement after revalidation.
7. Otherwise keep the request available for manual action, with a concise reason.

External `session.permission.create` currently accepts source/metadata. Such public fields must not qualify a request for automatic review by themselves. Only a request tied to an actual pending runtime tool invocation may auto-apply.

### 6.2 Evidence model and trust boundary

Proposed Core `permission/review-context.ts` builds a bounded EvidenceSnapshot:

| Evidence               | Authoritative source                                                                     | Treatment                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Exact action           | Live tool invocation plus persisted tool part and canonical BashApproval metadata        | Command, arguments, cwd, paths, remote/destination, network scope and sandbox/escalation requirements; immutable digest |
| Effective authority    | PermissionV2 authority snapshot, inherited restrictions, saved grants and sandbox policy | Hard limits; no model override                                                                                          |
| User intent            | Original admitted/promoted user inputs with server-owned provenance                      | Only verified human/client input can authorize                                                                          |
| Later corrections      | Relevant promoted input and pending admission invalidation/version                       | Revocation or changed scope invalidates a prior review                                                                  |
| Task lineage           | Private Task/managed-child ownership and captured delegation                             | Delegated agent messages do not become fresh human permission                                                           |
| Transcript/tool output | Selected recent history, exact commands/results, source IDs                              | Untrusted supporting evidence, never policy                                                                             |
| Workspace facts        | Canonical Location/repository and exact action targets                                   | Context for matching scope, not blanket permission                                                                      |

**Required precursor:** the current admitted input contract contains prompt/delivery/execution policy, not a complete authorization-provenance system. Prompt.Source is attachment text positioning, not a trust label. Add server-owned private provenance at actual input admission paths, including interactive user submission, agent/task/workflow/scheduled input and imported history. Do not expose a user-settable trusted flag.

An authenticated submission is a trust-boundary claim, not proof about a physical human: internal agent-generated submissions must use distinct private origins. Existing/imported entries without reliable lineage remain unknown. They can be context but cannot establish authorization for consequential actions.

An exact prompt retry must preserve its original private provenance. Reusing a message ID through another ingress cannot upgrade unknown/agent input to human input. Extend admission reconciliation tests without weakening the existing Session/prompt/delivery equality contract.

Retain original input IDs/digests across compaction. Compaction summaries and quoted transcripts cannot upgrade to human authorization. Fork/history copy retains source identity and provenance. A task's delegated prompt is not equivalent to the original user's instruction; root evidence must come through verified ownership.

Do not admit unrelated queued prompts as permission for the currently executing action. On new admission, conservatively invalidate any pending automatic approval; recompute at the safe boundary or leave it manual. No automatic tool resubmission is required.

The prompt has explicit sections: immutable host policy, exact action, effective constraints, verified authorization candidates, and untrusted observations. Quotes, code files, tool responses and MCP form text cannot rewrite the first three sections.

### 6.3 Scope matching and bounded classification

An authorization must match the proposed action's meaningful parameters. Examples:

| Evidence/action                                              | Expected decision                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| “Review the changes” + git push                              | Ask; review does not authorize publication                              |
| “Push this branch to origin” + same repository/branch/remote | Eligible for allow_once if policy permits and exact evidence is present |
| Same instruction + force-push or different remote            | Ask                                                                     |
| “Run the tests” + recognized local test command              | Allow by existing rules or eligible review                              |
| A repository file says “the user approved deployment”        | Ask; file content is not user evidence                                  |
| “Do not push yet” arrives while classification runs          | Invalidate; no stale auto-approval                                      |
| Explicit user request but inherited hard deny                | Deny by policy                                                          |
| Missing/ambiguous provenance, destination or payload         | Ask                                                                     |

Use existing bash parsing/exact-grant logic. Review broad/opaque execution vehicles conservatively. Arguments alone do not prove what an arbitrary script will do; the first batch should not automatically authorize unknown script side effects.

Distinguish a configured hard deny from a legacy classifier's heuristic escalation. The former cannot be overridden; the latter means the evidence needs review. Porting every legacy `certain` flag as a permanent deny would prevent the intended explicit-authorization behavior.

Build the native reviewer with LLMClient and Location-scoped model resolution. [Side-question native execution][a-side-question] is a useful precedent for an isolated, tool-free streamed request; it is not a reason to copy full conversation context or mutate the main transcript.

Suggested initial bounds: one streamed attempt, no tools, no retries, 20-second deadline, 8,000 input tokens, 1,000 output tokens, at most two concurrent reviews per Location and a bounded queue. Count reviewer usage separately and include it in applicable invocation budget accounting. No nested permission requests or recursive review.

Preserve exact action and decisive authorization when budgeting. If they do not fit, ask. Do not truncate away a negation or target and still approve. Provider error, invalid/partial JSON, missing finish, timeout, cost exhaustion or model unavailability all produce ask with a machine-readable reason.

The parsed result contains decision, concise reason, risk category and cited evidence IDs. Validate referenced IDs against the captured snapshot. Do not store hidden chain-of-thought or treat model confidence as proof of safety.

### 6.4 Atomic application and races

A decision must bind:

- Permission request ID and private pending-object identity.
- Session incarnation and owned tool call.
- Canonical action digest.
- Relevant authority/mode revision.
- Input/provenance evidence revision.

Current PermissionV2.reply already rechecks deny rules, but list/get followed by a model call and a separate reply is not enough.

Add an internal `applyReviewed` operation (proposed name), guarded by a short per-request claim/CAS or semaphore. Manual replies, automatic application, cancellation and finalizers use the same settlement path. Uninterruptible execution alone does not serialize fibers.

At apply time recheck the request, action, Session/tool owner, current policy, mode and input revision. Human settlement or cancellation wins if it already committed. Any mismatch discards the model approval and either leaves the request manual or reports it already settled.

Persist the audit/applied receipt before releasing the Deferred. Do not hold a database transaction or request lock during the model call. A crash between audit commit and tool resumption records interrupted/unknown completion; it must not replay the tool automatically.

Subscribe to Session input-admission invalidation and relevant policy/mode changes. An approval based on a superseded snapshot is not reused. Do not cache approvals across different requests in this batch.

### 6.5 Audit, API and frontend migration

Propose `permission_review` storage with review/request/Session/tool IDs, action digest, policy/evidence revision, provenance references, decision/source/reason, reviewer model, latency/usage, and application status:

`pending / evaluated / applied / superseded / cancelled / failed`.

Separate the model's recommendation from what actually happened. A model allow overtaken by a manual rejection is recorded as superseded, not approved.

Retain bounded redacted action/evidence summaries and source digests, not a second full transcript. User text and tool metadata can contain secrets. Follow Session deletion/retention; do not ship audit data to unrelated telemetry.

Proposed native endpoints:

| Endpoint                                                    | Purpose                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET/PUT /api/session/:sessionID/permission-review/mode`    | Read/set effective native review mode, including revision                         |
| `POST /api/session/:sessionID/permission/:requestID/review` | Trigger or join the same backend evaluation; clients never supply evidence/policy |
| `GET /api/session/:sessionID/permission-review`             | Paginated audit history                                                           |
| `GET /api/session/:sessionID/permission-review/:reviewID`   | Decision and application receipt                                                  |

The backend starts review for eligible pending runtime requests even if no frontend is open. The explicit POST is an idempotent join/retry entry under policy, not a second decision authority.

Proposed events: `permission.review.started / finished` plus existing permission settlement events. UIs show reviewing, allowed once, manual review needed, superseded, and the concise reason. A user can manually decide while the reviewer runs.

Move App/TUI native mode into backend state. Do not let two clients run classifiers or independently auto-reply. Old browser-local review preference may be offered as a user-visible migration, but must not silently enable global server approval. Keep legacy Session review behavior explicitly separate until migrated.

Headless reject/approve_once policy remains explicit. Do not silently turn headless reject into contextual review. An opt-in headless contextual mode can be added later after unattended failure semantics are agreed.

### 6.6 File-level work

| Existing points                                       | Proposed changes                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| PermissionV2, authority/saved, BashApproval           | Shared settlement gate and internal automatic-application method                         |
| Session input admission, history copy, task ownership | Server-owned provenance and evidence invalidation                                        |
| Native model/LLM interface                            | `core/src/permission/review.ts`, `review-context.ts`, `review-store.ts`, `review.sql.ts` |
| Schema/Protocol/Server permission groups              | `schema/src/permission-review.ts`, native mode/review/audit routes and events            |
| App permission context, TUI sync/native adapters      | Server-owned modes/status and removal of native client-side decisions                    |
| Legacy auto-review.ts                                 | Compatibility adapter only; no new native runtime dependency on legacy Provider/Session  |

## 7. Integration, migration and rollout

### 7.1 Schema and service integration

- Add canonical public contracts/events once, with unique brands and schema identifiers. Keep private runtime capabilities out of Schema.
- Register Core services in the appropriate global/Location nodes and expose them in the relevant application public groups. Preserve package dependency direction.
- Add database migrations under Core. Use additive tables/columns initially, FK deletion behavior and schema-version validation. Opening an old database must not start background review/tool work.
- Add Protocol groups/errors/event manifests and Server handlers before generation. Native routes use Session-owned placement; a caller's directory override must not redirect another Session.
- Generate Client from `packages/client` after public API changes. Generate the legacy SDK only when its API changes. Never edit generated trees by hand.
- Update current App/TUI transport adapters explicitly. Presentation compatibility events must not acquire runtime authority.

### 7.2 Backward compatibility

| Area                                | Migration                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Old review conversations            | Remain ordinary transcript text; do not manufacture validated historical findings                                        |
| Existing custom CLI output schema   | Retain the generic compatibility path during rollout                                                                     |
| Existing MCP servers                | Keep existing tool/OAuth/resource behavior; form support is explicit per server and connection compatibility             |
| Historical pending forms            | Do not synthesize live responders from receipts                                                                          |
| Existing permission rules/grants    | Preserve precedence and scope; model review never lifts denies                                                           |
| Historical user inputs              | Unknown provenance remains unknown; no automatic trust backfill from role labels                                         |
| Existing frontend review preference | User-visible migration to native backend mode; no silent expansion of authority                                          |
| Fork/rewind/delete                  | Preserve evidence lineage where valid; never copy pending responders, private owners or reusable auto-approval authority |

### 7.3 Rollout and rollback

1. F01 opt-in native structured review, then default for supported selectors after UI/JSON acceptance.
2. F04 per-server opt-in, validated separately for stdio/HTTP and documented incompatible stateful servers.
3. F02 off by default, then shadow, then opt-in enforce. Keep a server-side switch that immediately stops new model approvals and invalidates in-flight approvals.
4. Rollback disables entry/application paths without deleting historical records. Keep readers capable of displaying existing reports and audits. Reverting a flag must not replay tools, auto-submit forms or widen permissions.

All App/session-ui visible strings use existing i18n APIs. Preserve English source copy when adapting existing UI. Verify translations through the repository's required localization sources; a passing English window is not evidence for every locale.

## 8. Verification plan

These are planned acceptance requirements, not claims that the features already pass.

### 8.1 F01 acceptance

| ID  | Scenario                                                          | Required evidence                                                               |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| R01 | Staged/unstaged/untracked, base, root/merge commit and PR targets | Captured SHAs/trees and manifest match the requested target                     |
| R02 | Rename/deletion/addition/symlink/binary/oversized file            | Correct side/line semantics or explicit exclusion; no outside-root reads        |
| R03 | Model emits write/bash/plugin/MCP/task calls                      | Settlement rejects them; project/index/HEAD remain unchanged                    |
| R04 | Invalid JSON, invalid path/line/confidence, duplicate finding     | Bounded repair/diagnostics; never fabricated clean success                      |
| R05 | Workspace changes during capture and after review                 | Capture conflict detected; historical diff remains stable and marked stale      |
| R06 | Cancel, parent delete, restart, duplicate admission               | No orphan execution or automatic resampling; report lifecycle is truthful       |
| R07 | Text/JSON/streaming JSON and optional threshold exit              | Deterministic schema and exit semantics; no progress contamination in JSON      |
| R08 | Mini/fullscreen, browser and actual Desktop                       | Finding navigation reaches captured code; comments remain editable and distinct |

Start from actual tests such as `test/cli/run-review-options.test.ts`, `test/v2/headless-runner.test.ts` and `test/snapshot/snapshot.test.ts` in packages/apexo. Add real native review integration tests rather than copying the output formatter into tests.

### 8.2 F04 acceptance

| ID  | Scenario                                                        | Required evidence                                                   |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| E01 | Each field kind/default/enum/optional value                     | The real MCP fixture receives exact JSON types and values           |
| E02 | Required/bounds/formats/unknown fields/unsupported schema       | Core rejects invalid input before it reaches the server             |
| E03 | Two Sessions on one server; multiple tool calls/code-mode calls | No form or answer crosses invocation ownership                      |
| E04 | Decline/cancel/server cancellation/parent interruption          | Original Deferred/call terminates appropriately; no hidden retry    |
| E05 | Human wait and tool timeout                                     | Waiting pauses only its active budget, hard cap still terminates    |
| E06 | Frontend reconnect versus transport/process reconnect           | Frontend recovers live state; dead external operations never resume |
| E07 | Late old-generation request or duplicate/conflicting UI reply   | Cannot settle a new invocation; one terminal receipt                |
| E08 | OAuth refresh/server disable/definition change                  | Existing auth/retirement semantics hold; changed tools fail safely  |
| E09 | Headless/scheduled/no operator                                  | Immediate explicit outcome rather than an indefinite prompt         |
| E10 | Native mini/fullscreen/App/Desktop                              | Keyboard flow, typed controls, deadlines and dismissal work         |

Extend actual native stdio/HTTP fixtures around `test/v2/mcp-native.test.ts`, `mcp-oauth-transports.test.ts`, `mcp-codemode-toolsearch.test.ts` and `test/fixture/mcp-native-stdio.ts`. Upstream MCP/Codex tests are references, not Apexo verification.

### 8.3 F02 acceptance

| ID  | Scenario                                                       | Required evidence                                               |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| A01 | Explicit allow, configured/inherited deny, ordinary ask        | Existing rule precedence preserved                              |
| A02 | Same action with authorized/unauthorized user intent           | Correct evidence selected and cited; consequential unknowns ask |
| A03 | Injection in tool output/repository/MCP form/delegated message | No elevation to human authority                                 |
| A04 | Compaction, fork, imported history and scheduled input         | Provenance retained or explicitly unknown                       |
| A05 | New correction/revocation while model is delayed               | Stale allow is never applied                                    |
| A06 | Manual reply vs two clients vs auto-result vs cancellation     | One settlement; losing recommendations recorded truthfully      |
| A07 | Same command, different cwd/remote/ref/network/payload         | No approval reused across changed action digests                |
| A08 | Timeout, invalid/partial JSON, provider error or budget cap    | Manual ask with reason; no recursion or retries                 |
| A09 | Crash/deletion/rewind during review or application             | No surviving authority and no tool replay                       |
| A10 | UI disconnected, frontend reload, mini/fullscreen/Desktop      | Backend decision unchanged; consistent status/audit             |
| A11 | Explicit headless reject/approve_once                          | Existing unattended semantics preserved                         |
| A12 | Secret-bearing metadata and audit export                       | No raw secret or hidden reasoning in audit/event logs           |

Extend `test/permission/auto-review.test.ts`, `test/permission/next.test.ts` and native runtime/HTTP fixtures. Use a local streaming-provider fixture to control timing/errors, real database/services and actual permission settlement. A deterministic fixture proves plumbing, not model judgment.

Before enabling enforce, run a separately labeled live-model evaluation corpus: initially at least 60 reviewed scenarios covering authorized actions, ambiguous scope, revocations, injections and inherited denials. Require zero unauthorized automatic approvals on that fixed corpus; report false asks, latency and usage too. This is a bounded release gate, not a statistical safety guarantee. Retain scenario IDs, policy/prompt version and model identity without private user data.

### 8.4 Cross-surface evidence matrix

| Surface                | F01                                 | F04                                      | F02                                         |
| ---------------------- | ----------------------------------- | ---------------------------------------- | ------------------------------------------- |
| Core + native HTTP     | Admission/report/snapshot lifecycle | Exact live invocation and typed response | Evidence, policy and atomic settlement      |
| Headless CLI           | All formats/targets/cancel/exit     | Explicit unattended behavior             | Preserve explicit execution policy          |
| Mini terminal          | Compact review navigation           | Complete form interaction                | Native review status/manual fallback        |
| Fullscreen TUI         | Review list/diff/focus              | Complete form interaction                | Native mode/status/audit                    |
| Browser App            | Existing diff panel integration     | Typed form dock                          | Backend-owned review UI                     |
| Rebuilt Desktop window | Real window navigation/reload       | Real window input/cancel/reconnect       | Real window preference/status/manual action |

Record each surface as passed, failed or not run. Backend fixtures and packaged sidecar tests do not substitute for window interaction. Run against known build/source identities and dispose only fixture-owned processes.

### 8.5 Repository gates and relevant constraints

Before implementation, reread [the constraint index][rules] and applicable package instructions. Key constraints include canonical IDs/paths, explicit production service outputs, truthful fixture evidence, typed runner failures and stable terminal dialog roots. Record a production benchmark baseline before changing Session/timeline code.

For feature implementation, run focused tests from packages/apexo and `bun typecheck` from affected package directories. Use canonical constructors and real service composition; avoid global mocks. No direct root bun test or direct tsc.

Before every push, run the repository-required gates sequentially:

1. Root: `bun turbo typecheck --concurrency=2`.
2. Root: `GITHUB_ACTIONS=false bun turbo test --concurrency=2`.
3. packages/client: `bun run check:generated`.
4. packages/sdk/js: `bun run check:generated`.
5. packages/apexo: `bun run test:httpapi`.

Finish generated-source writers before readers; Turbo tests may invoke generation/build prerequisites. After intentional API generation, verify the generated diff and use the canonical check scripts. Do not mask drift with manual edits.

When fixing any implementation/test failure, write the required English bug record with observed behavior, cause, fix and actual verification. Do not invent historical occurrences or treat a passing rerun as a proven fix.

## 9. Delivery breakdown and effort

Each row is an independently reviewable PR to main; none should claim its entire feature is complete prematurely.

| PR  | Scope                                                           | Dependency               | Exit condition                                                                   |
| --- | --------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| 1   | F01 contracts, target capture, report storage/read API          | None                     | Canonical snapshot/result validation and migration tests                         |
| 2   | F01 managed execution, capability ceiling and CLI               | PR 1                     | Real native review succeeds; mutation attempts/cancel/restart covered            |
| 3   | F01 mini/fullscreen/App/Desktop findings                        | PR 2                     | Captured-location navigation, history and formats accepted                       |
| 4   | F04 invocation ownership/transport spike and Core protocol      | None; reuse existing MCP | Real concurrent stdio/HTTP routing proven; unsupported stateful cases documented |
| 5   | F04 typed forms, deadlines, lifecycle and all UI                | PR 4                     | Full E01–E10 and generated client acceptance                                     |
| 6   | F02 provenance, action snapshot and settlement/audit foundation | None                     | Human-vs-agent boundaries and race tests pass without model auto-apply           |
| 7   | F02 native reviewer and shadow mode                             | PR 6                     | Bounded provider execution and evaluation evidence                               |
| 8   | F02 opt-in enforcement and frontend migration                   | PR 7                     | A01–A12 plus live-model corpus; no competing client decisions                    |
| 9   | Cross-feature integration, packaging and release documentation  | PRs 3, 5, 8              | Matrix complete, regressions resolved and CI green                               |

Default implementation sequence: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. If staffing permits independent work, PR 6 can start earlier; PR 8 still waits for evidence. This is a dependency description, not authorization to start additional agents.

Planning estimate for an engineer familiar with this repository:

| Workstream                                      | Engineering days |
| ----------------------------------------------- | ---------------- |
| F01                                             | 6–9              |
| F04, including transport compatibility proof    | 5–8              |
| F02, including provenance and evaluation        | 8–12             |
| Cross-surface integration and regression buffer | 3–5              |
| Total                                           | 22–34            |

These are estimates, not a delivery promise. Stateful MCP compatibility, reviewer provenance and native UI regressions are the main uncertainties. If the first delivery must be smaller, ship PRs 1–3 as a complete F01 slice and keep F04/F02 gated. Do not cut ownership, host validation or cancellation to make a date.

## 10. Decisions to preserve during implementation

- Snapshot-bound findings take priority over auto-fixing.
- MCP answers continue one live invocation; receipts cannot resurrect it.
- Use invocation-owned transport for initial generic form support; do not guess caller identity.
- Permission review is a backend decision with exact evidence and one-time authority.
- Missing provenance or insufficient evidence produces a manual request.
- Model recommendations and applied actions are separate audit facts.
- All three surfaces need their own evidence; “native backend works” is not “Desktop is done”.
- Stay within Apexo's runtime and dependency architecture.

## 11. Source index

Local links refer to inspected existing files. Filenames labeled proposed elsewhere do not yet exist. The Codex links are pinned to the comparison commit.

[a-review-cli]: ../../packages/apexo/src/cli/cmd/review.ts
[a-headless]: ../../packages/apexo/src/cli/native-headless.ts
[a-runner]: ../../packages/core/src/session/runner/llm.ts
[a-review-panel]: ../../packages/app/src/pages/session/v2/review-panel-v2.tsx
[a-mcp]: ../../packages/core/src/mcp.ts
[a-mcp-tools]: ../../packages/core/src/mcp-tools.ts
[a-question-schema]: ../../packages/schema/src/question.ts
[a-question-core]: ../../packages/core/src/question.ts
[a-auto-review]: ../../packages/apexo/src/permission/auto-review.ts
[a-permission-protocol]: ../../packages/protocol/src/groups/permission.ts
[a-permission-core]: ../../packages/core/src/permission.ts
[a-permission-app]: ../../packages/app/src/context/permission.tsx
[a-permission-tui]: ../../packages/tui/src/context/sync.tsx
[a-bash-approval]: ../../packages/core/src/tool/bash-approval.ts
[a-snapshot]: ../../packages/core/src/snapshot.ts
[a-git]: ../../packages/core/src/git.ts
[a-managed-child]: ../../packages/core/src/session/managed-child.ts
[a-side-question]: ../../packages/core/src/session/side-question-native.ts
[rules]: ../rules/README.md
[c-review-protocol]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/protocol/src/protocol.rs
[c-review-session]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/core/src/session/review.rs
[c-review-task]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/core/src/tasks/review.rs
[c-app-server]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/app-server/README.md
[c-mcp-handler]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/rmcp-client/src/logging_client_handler.rs
[c-mcp-client]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/rmcp-client/src/rmcp_client.rs
[c-mcp-service]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/rmcp-client/src/elicitation_client_service.rs
[c-mcp-input]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/rmcp-client/src/request_input.rs
[c-guardian-prompt]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/core/src/guardian/prompt.rs
[c-guardian-review]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/core/src/guardian/review.rs
[c-guardian-budget]: https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/core/src/guardian/request_budget.rs
[mcp-forms]: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/client/elicitation.mdx
[mcp-sdk]: https://ts.sdk.modelcontextprotocol.io/v2/servers/elicitation
