# Codex comparison: first-batch development plan

Status: F01 implemented on `structured-review`; final verification is recorded in [the implementation checkpoint](first-batch-implementation.md). F04 and F02 remain planned. This document retains the agreed scope and acceptance criteria.

Prepared on 2026-11-12. Apexo baseline: `e4885b0378a0cd88b703133f435fd47383cff64a`. Codex source baseline: `c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee`. Codex references describe this source revision, not availability in every released CLI or account.

Reading map: [source comparison](#2-source-comparison), [F01](#4-f01-structured-code-review), [F04](#5-f04-mcp-form-elicitation), [F02](#6-f02-contextual-automatic-permission-review), [acceptance](#8-verification-plan), [PR sequence and estimates](#9-delivery-breakdown-and-effort).

## 1. Recommendation and scope

Implement these three capabilities in order:

1. **F01: structured code review.** Persist validated findings with priorities, file/line locations, a frozen diff target and consistent CLI/TUI/App presentation.
2. **F04: MCP form elicitation.** Collect typed user input and continue the original tool invocation on the existing server connection, with serialized call ownership, bounded wait timeouts and clean cancellation.
3. **F02: contextual automatic permission review.** Compare an exact pending action with recent verified user intent and effective permissions; approve once in Core only when the decision still matches that pending request.

This batch intentionally avoids speculative infrastructure:

- **Excluded product scope:** review auto-fixes, finding resolution workflows, peer-agent messaging, a new orchestration framework, replacement sandboxing, MCP sampling, URL-mode forms, biometric verification, a multi-forge PR REST client and a wholesale MCP SDK migration.
- **Excluded over-design:** snapshot reference-pinning/GC tables, per-tool-call MCP process spawning, SQLite receipt tables for live MCP prompts, cross-compaction/cross-fork authorization provenance chains, `shadow` rollout state machines and paginated permission-audit subsystems.

Apexo owns all runtime behavior; none of these features depends on a Codex or Grok executable.

| Capability | User example                                                              | Completion criterion                                                                                                              |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| F01        | Review this branch against main and show P1 findings                      | A report survives reload, has validated locations and coverage, and supports JSON, terminals and the existing diff UI             |
| F04        | An MCP tool asks for environment, quantity and confirmation               | Typed answers reach that exact call on stateful and stateless servers; decline, dismiss, timeout, interruption and reconnect pass |
| F02        | A user authorized a particular push, but it still needs permission review | The backend checks recent user intent and repository/remote/ref before approving once; insufficient evidence remains manual       |

Apexo already has review CLI entry points, generic structured output, native Sessions, managed children, MCP/OAuth/resources, command sandboxing, saved permissions and diff/comment presentation. Reuse those directly.

## 2. Source comparison

### 2.1 F01: the review command exists; the domain contract is missing

| Layer            | Codex evidence                                                                                                                          | Apexo evidence                                                                                                         | Implication                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Entry/target     | [ReviewTarget and ReviewOutputEvent][c-review-protocol] define targets and findings                                                     | [review.ts][a-review-cli] constructs target instructions, including PR review, then calls generic headless execution   | Preserve selectors; resolve targets in Core before execution    |
| Execution        | [review session][c-review-session] selects a review model; [ReviewTask][c-review-task] uses a rubric, delegate and feature restrictions | [native-headless.ts][a-headless] admits Session input; [runner/llm.ts][a-runner] supports JSON response formats        | Reuse the runner with a private review owner/role               |
| Output           | Findings have title/body/priority/confidence/file/line                                                                                  | CLI permits optional `--output-schema`; no equivalent dedicated code-review finding contract exists in Schema/Protocol | Make the result schema standard and host-validated              |
| UI               | Dedicated review-mode protocol and formatting                                                                                           | [ReviewPanelV2][a-review-panel] already renders diffs, comments and focused locations                                  | Add findings to the current panel; keep human comments separate |
| Public semantics | [App-server documentation][c-app-server] says `review/start` returns the supplied thread; detached callers create a thread first        | Apexo has its own [SessionManagedChild][a-managed-child] architecture                                                  | Do not copy an obsolete detached API assumption                 |

The current CLI's review-specific read-only instruction is prompt text. Generic permission settings may restrict execution, but the command does not establish a dedicated review capability ceiling.

### 2.2 F04: form rendering is only one part of the gap

| Layer        | Codex evidence                                                                                                                                                      | Apexo evidence                                                                                                  | Implication                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Registration | [logging_client_handler.rs][c-mcp-handler] accepts elicitation                                                                                                      | [mcp.ts][a-mcp] advertises roots and registers a roots handler; native form handling is absent                  | Negotiate `elicitation: { form: {} }` and register a handler                  |
| Routing      | [rmcp_client.rs][c-mcp-client], [elicitation_client_service.rs][c-mcp-service] and [request_input.rs][c-mcp-input] bind modern inputs and timeout pauses to callers | [mcp-tools.ts][a-mcp-tools] has Session/message/call context but calls a shared SDK Client without a form owner | Serialize interactive `callTool` per server connection and bind active caller |
| Types        | Dedicated MCP form/response types                                                                                                                                   | [Question][a-question-schema] answers are arrays of strings                                                     | Reuse UX patterns, not the lossy question wire type                           |
| Lifetime     | Pending responders, cancellation and interaction pauses                                                                                                             | [QuestionV2][a-question-core] uses Location-scoped `Deferred` maps; MCP calls currently use a fixed timeout     | Mirror `QuestionV2` live `Deferred` state and pause active timeout on wait    |

Apexo pins `@modelcontextprotocol/sdk` 1.29.0. Its installed `RequestHandlerExtra` exposes an inbound request ID, cancellation signal, metadata and transport session, but no general inbound parent `tools/call` ID. Reuse the shared connection and serialize operations that can trigger forms through one gate. Local cancellation does not acknowledge remote completion: retire a cancelled or timed-out connection generation before admitting another call so late forms cannot reach its successor.

The [MCP 2025-11-25 form specification][mcp-forms] is the first-batch interoperability target. [Current SDK documentation][mcp-sdk] distinguishes that server-request flow from the 2026-07-28 input-required flow. A full SDK migration is outside this batch.

### 2.3 F02: a classifier exists, but lacks authorization context and native ownership

| Layer       | Codex evidence                                                                                                                           | Apexo evidence                                                                                                   | Implication                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Evidence    | [guardian/prompt.rs][c-guardian-prompt] separates policy, transcript, exact action, root authorization, verified answers and permissions | [AutoReview.prompt][a-auto-review] sends tool/patterns/metadata; history is only used to pick the model          | Include recent verified user inputs and authoritative scope    |
| Reviewer    | [guardian/review.rs][c-guardian-review] constrains reviewer powers; [request_budget.rs][c-guardian-budget] bounds evidence               | Legacy classifier streams once with a 20-second timeout; [local-qwen.ts][a-local-qwen] adds V1 plugin risk tags  | Run one bounded native LLM check in Core; keep V1 plugin split |
| API         | Backend approval routing                                                                                                                 | [Native permission API][a-permission-protocol] has create/list/get/reply/saved, but no review mode               | Add native Session review mode and inline review status events |
| Application | Decisions belong to exact actions                                                                                                        | [App permission context][a-permission-app] and legacy [TUI sync][a-permission-tui] classify and reply separately | Move automatic evaluation and settlement to Core               |
| Native TUI  | N/A                                                                                                                                      | Native events update pending state; only the legacy V1 event branch invokes automatic classification             | Legacy behavior is not native-parity evidence                  |
| Authority   | Review remains constrained by policy                                                                                                     | [PermissionV2][a-permission-core] already checks inherited/configured denies and rechecks authority at reply     | Preserve rule precedence and fence settlement per request      |

The [bash approval parser][a-bash-approval], saved grants and `doctor --check-command` remain useful existing capabilities. Static command-policy evaluation must not be replaced by a model.

## 3. Shared architectural decisions

1. Serializable contracts belong in Schema; runtime/persistence in Core; HTTP definitions in Protocol; handlers in Server; generated adapters in Client; UI in TUI/App/session-ui. Client runtime cannot import Core or Server.
2. Name domains `CodeReview`, `McpElicitation` and `PermissionReview`. New canonical contracts are unversioned; persisted JSON documents that may evolve use `schemaVersion: 1`.
3. Keep the domains separate. Reuse existing `QuestionV2` / `PermissionV2` / `SessionGoalRole` patterns rather than inventing a generic interaction engine.
4. Durable records are evidence, not authority to resume external work. Reopening a report is safe; replaying tools or sampling after restart requires a new user action.
5. Public metadata cannot mint managed-child ownership, tool invocation ownership or human authorization.
6. Preserve durable prompt admission before advisory wake, process-global Session coordination and Location-scoped execution. Each provider turn has one explicit `llm.stream(request)`.
7. Add canonical events and generated clients. Reconnect uses authoritative `list` / `get` plus revision/sequence; tolerate duplicate events.
8. Use Session lifecycle claims/incarnations and Location guards. Deletion, rewind, retirement and disposal invalidate pending work before stale application.
9. Add typed domain failures to runner/server contracts where required (`RULE-20261015-022`) and expose services in the correct AppNode public groups (`RULE-20261015-011`).
10. On Bun 1.3.14, endpoints with no request payload (such as `POST .../cancel`) must never be sent a body by clients or tests, avoiding `node:http` `server.close()` hangs.

## 4. F01: structured code review

### 4.1 Data contracts and persistence

Proposed contract: `packages/schema/src/code-review.ts`.

| Record   | Fields/semantics                                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target   | Discriminated `uncommitted / base / commit / pr / custom` selector, optional focus text, mutually exclusive concrete selectors                                                                                                                                                              |
| Captured | Canonical repository root, requested target, resolved `baseSha` / `headSha` / `mergeBaseSha`, before/after Git `TreeID` (when local), changed-file manifest and bounded diff patches                                                                                                        |
| Finding  | Host-generated ID, `P0–P3` priority, title, explanation, finite `0–1` confidence, repository-relative path; a line anchor (`old / new` side, positive inclusive `startLine` / `endLine`, `inHunk`) or explicit file-level anchor; bounded captured snippet for valid outside-hunk locations |
| Result   | `schemaVersion: 1`, findings, assessment (`issues_found / no_findings / inconclusive`), summary, coverage/exclusions, model/usage                                                                                                                                                           |
| Run      | Review ID, parent/review Session IDs, admitted input ID, target/captured metadata, revision, status/timestamps and optional result/error                                                                                                                                                    |

Use `no_findings` instead of claiming a model has proved correctness. Empty findings with incomplete coverage or interrupted execution cannot silently become a clean review.

Propose a single `session_code_review` table in `core/src/session/code-review.sql.ts`, indexed by `(parent_session_id, time_created)` with `ON DELETE CASCADE` from `session`, snake_case columns, schema-validated JSON report metadata, and bounded captured per-file patches and outside-hunk finding snippets. Do **not** add a separate finding table or a custom [Snapshot][a-snapshot] reference-pinning/GC subsystem: `Snapshot.capture()` is optional (`snapshots: false` returns `undefined`) and shares `.git/objects` via alternates. Persisting patches and snippets directly in `session_code_review` keeps historical finding context readable even if the workspace changes or Git objects are later pruned. Snippets count toward the existing capture size limit.

Proposed limits: 500 changed files, 5 MiB total captured diff text, 2 MiB per text file read, 200 findings, 5,000 characters per explanation. Every excluded path (binary, submodule, conflict, oversized) is listed in `coverage`.

### 4.2 Resolve and freeze the target

| Target      | Rule                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted | Capture `HEAD` tree and a shadow-index tree of staged, unstaged and eligible untracked changes via [Git][a-git] without mutating the user's `.git/index` or worktree    |
| Base        | Resolve supplied ref and `HEAD`; capture their `merge-base` to `HEAD` diff                                                                                              |
| Commit      | Resolve exact commit and first parent (empty tree for root commit); document first-parent merge semantics                                                               |
| PR          | On the host during `capturing`, resolve `baseRefOid` / `headRefOid` via `gh pr view --json` and `git fetch` into temporary shadow refs; fail clearly if `gh` is missing |
| Custom      | Treat instructions as focus; default target to uncommitted changes unless combined with a concrete selector                                                             |

Use argv-based [Git][a-git] calls (`--no-ext-diff`, `--no-textconv`, validated refs and `--` path separation). Never modify the user's branch, index or worktree. `Git.tree.capture` already serializes shadow-index writes with `KeyedMutex`; no multi-pass filesystem mutation-retry loop is needed. Review symlinks as link entries and never follow them outside the repository root.

### 4.3 Execution ownership and read-only enforcement

Use a managed child with owner `{ kind: "review", reviewID, attemptID }`. Extend [SessionManagedChild][a-managed-child] (`Owner` union and `sameOwner`) explicitly rather than relying on public Session metadata.

Publish compact progress/report events to the parent Session without interrupting or waking the parent runner. The review child receives the review rubric, changed-file manifest, focus instructions and bounded diff context—not the full parent conversation transcript.

Follow the [SessionGoalRole][a-goal-role] materialization pattern (`core/src/session/code-review-role.ts`) to advertise and settle **only two minimal read-only review tools**:

1. `review_diff`: read captured unified diff hunks from the frozen manifest (all files or filtered by path).
2. `review_read`: read bounded file lines from the captured `TreeID` / commit SHA via `git show <tree>:<path>`, including untracked files captured in the shadow tree. If captured content is unavailable, report the missing content and incomplete coverage; never fall back to the live workspace.

Reject any fabricated `bash`, `edit`, `write`, `apply_patch`, web, MCP, plugin, task, workflow, goal or scheduler tool calls at settlement. Running tests inside the review worker is out of scope.

Reuse native model resolution and streaming. Request structured JSON matching the canonical review output schema when supported, and always validate on the host. Allow **at most one tool-free repair turn** only when the model's final text is malformed JSON or fails top-level schema decoding; if still invalid, record `failed` (`invalid_output`), never an empty clean report.

### 4.4 Lifecycle, locations and staleness

Lifecycle: `admitted → capturing → running → completed | failed | cancelled | interrupted`.

- Exact retry with the same review ID and canonical request (target, focus and effective execution options) returns the existing run; conflicting reuse fails.
- Cancel targets only the owned review child Session. Parent Session deletion cascades the report and terminates any active child.
- Reconcile unfinished `admitted / capturing / running` rows as `interrupted` on startup; reading reports never triggers provider calls.
- Location validation: findings must reference a valid repository-relative path (no `..` traversal), with finite `0–1` confidence. Line anchors require positive inclusive lines (`1 <= startLine <= endLine`) within the captured file's line count on the referenced side. Deduplicate exact duplicate findings.
- **Do not reject findings just because their lines fall outside changed diff hunks** (reviewers legitimately flag unchanged call sites or invariants broken by a diff). Set `inHunk: boolean` for valid line anchors. Persist a bounded snippet from the same captured file for outside-hunk locations, including its side and starting line. If an individual finding has an invalid or unverifiable line range, downgrade it to an explicit file-level anchor, omit its line range and record a diagnostic count. Never clamp a citation to unrelated lines.
- Staleness compares captured `headSha` / tree hash with current workspace state. Clicking a line finding in `ReviewPanelV2` opens the captured diff patch or stored outside-hunk snippet; file-level findings show no precise line highlight. When the live workspace has diverged, display an explicit `stale` badge. Historical finding navigation must not load live file contents as captured evidence.

### 4.5 API and all presentation surfaces

Proposed endpoints using Session placement middleware:

| Endpoint                                               | Behavior                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/session/:sessionID/review`                  | Admit with retry ID, target/focus, model/variant/agent selection and optional execution limits/fallback; return immediately |
| `GET /api/session/:sessionID/review`                   | Paginated report list for Session                                                                                           |
| `GET /api/session/:sessionID/review/:reviewID`         | Run metadata, result, revision and coverage                                                                                 |
| `GET /api/session/:sessionID/review/:reviewID/diff`    | Captured per-file diff patches from the stored report                                                                       |
| `POST /api/session/:sessionID/review/:reviewID/cancel` | Idempotent targeted cancellation (**no request body**; callers must send empty POST)                                        |

Proposed events: `code_review.started / updated / finished` with IDs, revisions and compact status.

CLI preserves existing flags (`--uncommitted`, `--base`, `--commit`, `--pr`, `--title`, `[prompt..]`). Default text format renders priority, `path:line`, summary and coverage; `json` emits the validated report envelope; `streaming-json` emits progress events followed by the final report. Exit `0` on completion, `1` on execution/validation failure, `130` on `SIGINT`. Add opt-in `--fail-on <P0|P1|P2|P3>` returning exit `2` when findings meet or exceed the threshold. Explicit `--output-schema` keeps the existing generic headless path so custom caller schemas do not break.

Use the existing Session command/action menus for the complete interactive flow; no new standalone page is needed:

| Action                  | Mini/fullscreen TUI                                                                                                                | App/Desktop                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Start and select target | Add a Code Review action opening the existing dialog container                                                                     | Add Review Changes to the Session action menu/review-panel toolbar                         |
| Configure               | Small target selector: uncommitted (default), base ref, commit, PR or custom focus; show target-specific fields and optional focus | The same selector in an existing dialog/popover; validate before admission                 |
| Follow progress         | Show the admitted review in the Session with a status row and Cancel action                                                        | Show status and Cancel in the existing review panel                                        |
| View history            | Review History action lists this Session's reports; selecting one opens its findings                                               | Report selector/history list inside the review panel; selecting a report does not rerun it |
| Inspect results         | Priority badges and keyboard finding navigation to captured context                                                                | Findings in [ReviewPanelV2][a-review-panel], distinct from human comments                  |

Cancel calls the review cancellation endpoint with an empty body and affects only that review. Show failed/interrupted/empty states in the same surfaces. Disable unsupported actions on compatibility-only servers with a clear explanation. Both terminal modes must expose start, target selection, history and cancel, not just render reports launched from the CLI.

**CLI compatibility decisions:** validate option combinations before admission, using existing [run output/guardrail helpers][a-run-options]. The dedicated review request carries model/variant/agent selection and the validated limits to the backend; accepting a flag without applying it is an error.

| Existing option                                       | Dedicated native review behavior                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target flags, positional/piped focus and `--title`    | Preserve target/focus semantics; title is review context, not a rename of an existing parent Session                                                                                                                                                                                                                                |
| `--model`, `--variant`, `--agent`                     | Preserve selection through native resolution; the review role's capability ceiling still applies; reject unsupported selections explicitly                                                                                                                                                                                          |
| `--attach`, `--dir`, `--username/-u`, `--password/-p` | Preserve transport/authentication. With attach, target capture, Git and `gh` run on the attached server and `--dir` denotes its directory; output paths remain client-local                                                                                                                                                         |
| `--session-protocol`                                  | `native` requires the native review API; `compatibility` uses the existing generic path. `auto` selects native review when supported, otherwise the generic path with a notice. Never fall back after admission; `--fail-on` or execution guardrails cannot fall back to a path that lacks their semantics                          |
| `--output-schema`                                     | Keep the generic structured headless path and its schema/output behavior. Reject combination with new `--fail-on`; preserve guardrails if supported or reject before admission                                                                                                                                                      |
| `--ephemeral`                                         | Create a CLI-owned temporary parent/review pair, emit/write final output, then cancel any remaining owned work and delete both plus the report in `finally`. Never delete a pre-existing Session. Report cleanup failure and exit 1; this is cleanup on exit, not a guarantee of no durable writes or cleanup after a process crash |
| `--output-last-message/-o`                            | Write the validated final report as JSON plus newline to the client-local path, independently of stdout format. On failed/interrupted review, leave the destination untouched; write errors exit 1. Export before ephemeral cleanup                                                                                                 |
| `--max-turns`, `--max-tokens`, `--max-budget-usd`     | Reuse native execution accounting for the review child. Count repair turns and fallback-model usage toward the same limits; never reset limits on repair/fallback. Budget/turn exhaustion yields an incomplete/failed report and exit 1, never `no_findings`                                                                        |
| `--fallback-model`                                    | Preserve the existing fallback eligibility before primary output; apply the same target, result schema, role restrictions and remaining budgets                                                                                                                                                                                     |
| `--format`, `--thinking`                              | Keep the documented text/JSON/streaming report outputs. Show available reasoning blocks only where the renderer supports them; do not contaminate the final JSON envelope with progress text                                                                                                                                        |
| `--auto`                                              | Preserve its permission-policy meaning where applicable, but it never expands review tools or answers forms; native CLI review remains headless                                                                                                                                                                                     |
| `--wait-for-background`, `--background-wait-timeout`  | Native review cannot launch background work. Accept existing default values; reject non-default overrides as unsupported. The generic compatibility path retains its existing behavior                                                                                                                                              |

For an attached server, check required API/option support before creating the review. If a requested budget, output contract or cleanup operation cannot be honored, fail clearly instead of ignoring the option. CLI exports are host operations authorized by these flags, outside the model's read-only tool set.

Persist the effective execution options with the admitted review input and include them, focus and target in exact-retry comparison. A retry cannot change budgets or model selection on an existing run. Preserve native signal handling: confirmed `SIGTERM` cleanup exits 143, confirmed `SIGINT` cleanup exits 130, and unconfirmed cleanup exits 1 with the run identity.

### 4.6 File-level work

| Existing points                                  | Proposed files/changes                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Schema/event manifests, Protocol/Server groups   | `schema/src/code-review.ts`, `protocol/src/groups/code-review.ts`, `server/src/handlers/code-review.ts` |
| Managed-child ownership, lifecycle, runner roles | `core/src/session/code-review.ts`, `code-review-store.ts`, `code-review.sql.ts`, `code-review-role.ts`  |
| Git service                                      | Minimal read-only tree/blob diff and `gh` PR ref capture helpers in `core/src/git.ts`                   |
| CLI review and native output                     | Native review client path and deterministic formatter in `apexo/src/cli/cmd/review.ts`                  |
| App review panel, session-ui, TUI                | Finding list/badges/focus in `ReviewPanelV2`, `session-ui`, and TUI review views                        |

## 5. F04: MCP form elicitation

### 5.1 Contract and supported fields

Propose `packages/schema/src/mcp-elicitation.ts`:

- Request ID, Session/message/tool-call IDs, server name, message, validated form schema, createdAt/deadlineAt timestamps and status.
- Discriminated reply: `accept` with typed `Record<string, string | number | boolean | readonly string[]>`, or `decline` / `cancel` without content.

Support the MCP 2025-11-25 flat object form subset: strings (with `minLength`, `maxLength`, `format`), finite numbers/integers (`minimum`, `maximum`), booleans, single-select string enums (including `oneOf`/`enumNames` titles), multi-select string array enums (`minItems`, `maxItems`), `required` fields and `default` values. Defaults prefill UI controls visually and are **never** auto-submitted.

Validate both inbound form schemas and outbound user replies in Core before passing data back to the SDK: reject nested objects, arbitrary arrays, `$ref`, unknown keys, non-finite numbers and out-of-range values. Proposed limits: 32 fields, 100 options per enum, 64 KiB schema/reply payload, and **at most one active form at a time per tool call** (if a server emits a second concurrent `elicitation/create` while one is still pending, reject the second request immediately rather than queuing).

Per the [MCP form specification][mcp-forms], forms must not collect secrets or credentials; display the requesting MCP server name clearly and treat field titles/descriptions as untrusted plain text.

### 5.2 Shared-connection call gate and cancellation isolation

Keep the existing Location-scoped shared MCP connection in [mcp.ts][a-mcp]—do **not** spawn a new stdio process or HTTP session per `tools/call` (which breaks stateful MCP servers and adds multi-second startup latency).

Because `@modelcontextprotocol/sdk` 1.29.0 does not provide general inbound parent-call correlation on `RequestHandlerExtra`, use a **per-server call gate** together with connection-generation isolation:

1. When form elicitation is enabled for a server (defaulting to enabled for connected servers unless disabled in MCP config), advertise `capabilities: { roots: {}, elicitation: { form: {} } }` (never URL mode) and register the `ElicitRequestSchema` handler before `client.connect(...)`.
2. Each connection holds a cancellable `Semaphore(1)` call gate, a connection-generation token, and a mutable `activeInvocation` slot (`{ sessionID, claim, assistantMessageID, toolCallID, token, abort }` or `undefined`).
3. Route resource reads, catalog requests and other operations that can trigger forms through the same gate so they cannot overlap an armed tool call. These non-tool operations never arm `activeInvocation`; initialization completes before tools are admitted. Reject forms when unarmed or headless/unattended. Unsolicited background forms are unsupported; the gate does not add a parent-call ID to the protocol.
4. In [mcp-tools.ts][a-mcp-tools], after sandbox network and `PermissionV2.assert` checks succeed, acquire the permit (interruptible by caller cancellation), verify the connection generation is still current, set `activeInvocation` for this `Tool.Context`, and run `client.callTool(...)`. On normal completion, clear the slot and settle any leftover pending form before releasing the permit.
5. If an in-flight operation is locally cancelled or times out, mark that connection generation retired before releasing the gate, clear its owner and close its transport. Reject all late forms from the retired generation. Queued callers must revalidate the generation and cannot dispatch through the retired Client; admit new work only after reconnection. Never replay the cancelled operation automatically. Cancellation while merely waiting for the gate does not retire the connection.
6. Normal calls reuse the same connection and preserve stateful server continuity. Exceptional reconnection may lose server session/process state; report that limitation explicitly. No per-tool-call process spawning is required.

### 5.3 Live state, events and timeouts

Follow the exact [QuestionV2][a-question-core] pattern in `core/src/mcp-elicitation.ts`:

- Use a **Location-scoped in-memory service** holding `Map<ID, Pending>` (`Deferred` responders bound to both SDK `extra.signal` cancellation and Session/tool interruption) plus a small bounded in-memory LRU of recently settled request IDs so duplicate UI clicks return idempotently.
- **No `mcp-elicitation.sql.ts` table or startup DB sweep is needed.** Publish `mcp.elicitation.requested` and `mcp.elicitation.settled` via `EventV2` (recording IDs, server name, action `accept | decline | cancel` and terminal reason, without logging raw user answer values). After a process restart, no live responder exists and stale replies return `NotFound`.
- **Timeouts:** give each form a human wait deadline (default 5 minutes). Apexo owns the active execution budget, initialized from the configured MCP tool timeout; subtract elapsed active time, pause only while a validated form is pending, and resume the remaining budget rather than resetting it. Start a separate hard wall-clock cap (default 15 minutes) when dispatching the call; queueing for the gate does not consume its execution budget.
- **SDK timer wiring:** [McpTools][a-mcp-tools] currently sets both SDK `timeout` and `maxTotalTimeout` to the tool timeout. For the elicitation path, set both to the remaining hard wall-clock cap, keep `resetTimeoutOnProgress: false`, and pass a combined signal for caller cancellation, Apexo active-budget expiry and the hard cap. Do not leave the SDK's shorter default/tool timer running during a form. Clear Apexo timers/listeners on every terminal path. This uses the current SDK API and does not require a dependency upgrade. The non-eliciting path keeps its existing timeouts.

| Event                     | Outcome                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Valid accept              | Resolve `Deferred` with `{ action: "accept", content }` once                                         |
| Invalid accept            | Return validation error to UI; keep form pending                                                     |
| Decline                   | Resolve `{ action: "decline" }`                                                                      |
| Escape/dismiss            | Resolve `{ action: "cancel" }`                                                                       |
| Form deadline / hard cap  | Settle `timed_out`, abort the call and retire its connection generation before admitting new work    |
| Tool/Session interruption | Settle the owned form, abort its active call and retire that connection generation; do not replay it |
| Frontend disconnect       | Keep live `Pending` until deadline; `list` restores UI on reload                                     |
| Server disconnect/disable | Finalizer settles pending form and fails `callTool` without retry                                    |

### 5.4 API, UI and unattended policy

Propose routes under `/api/session/:sessionID/mcp/elicitation`:

- `GET /api/session/:sessionID/mcp/elicitation` — list live pending forms for the Session.
- `POST /api/session/:sessionID/mcp/elicitation/:requestID/reply` — submit `{ action: "accept", content } | { action: "decline" | "cancel" }`.

Reuse the existing question dock container and focus management in both TUI (mini + fullscreen, respecting `RULE-20261014-001` stable dialog/box roots) and App/Desktop, adding typed field inputs (text, number, boolean toggle, single/multi-select enum), inline validation errors, server attribution, countdown/deadline display, Decline and Cancel.

**Backend interaction eligibility:** compute a private `allowInteraction` value in the owning runner/tool Effect and capture it in `activeInvocation` before dispatch. The SDK callback reads that captured value; it must not attempt to recover Effect execution policy from callback-local context or infer operator presence from a focused window.

| Execution source                                                                   | Authoritative backend input                                                                                                                        | Form behavior                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Native headless CLI, including `--auto`                                            | [SessionExecutionPolicy][a-execution-policy] for the admitted input (`mode: headless`, regardless of `reject / approve_once`)                      | Reject immediately without opening a prompt                                                     |
| Scheduled work and its descendants                                                 | Verified scheduled launch/Task origin and inherited headless restriction, using [SessionTaskRole][a-task-role] and existing owner records          | Reject immediately; a child cannot remove the restriction                                       |
| Explicit fully unattended execution                                                | Admit through the existing headless execution policy (`approve_once` for full-auto, still subject to hard denies), including when launched by a UI | Reject immediately; no new global mode or table                                                 |
| Interactive TUI/App with manual permissions, F02 review, or permission auto-accept | Native interactive runner ownership with no headless/scheduled restriction                                                                         | Show the form and wait within its deadline; none of these permission modes fabricates an answer |
| Missing/stale invocation owner or indeterminate execution policy                   | No valid private invocation evidence                                                                                                               | Reject immediately                                                                              |

The existing App auto-accept preference and TUI `/auto` review toggle control permissions, not operator availability. They must not silently mark execution unattended. A UI offering a true unattended launch must submit the headless policy through the existing native admission API before execution; a browser-local preference alone is insufficient. A temporary frontend disconnect retains an eligible live form until its deadline, as above.

### 5.5 File-level work

| Existing points                                             | Proposed changes                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Core `mcp.ts` and `mcp-tools.ts`                            | Capability advertisement, connection gate, captured interaction eligibility, Apexo active timer and aligned SDK hard-cap timers |
| `QuestionV2` `Deferred` pattern, Location guards, lifecycle | `schema/src/mcp-elicitation.ts` and `core/src/mcp-elicitation.ts`                                                               |
| Protocol and Server groups                                  | `protocol/src/groups/mcp-elicitation.ts`, handlers, generated client                                                            |
| TUI native adapters, question dock, mini/fullscreen flows   | Typed MCP form dock component and reconnect hydration                                                                           |
| App question dock                                           | Typed SolidJS MCP form dock in App/Desktop                                                                                      |

## 6. F02: contextual automatic permission review

### 6.1 Place authority in the backend

Implement contextual permission review as a native Core service (`PermissionReview`), replacing frontend-driven classifier calls on native V2 Sessions while preserving existing configured rules, saved grants, inherited child restrictions and manual replies.

Keep product modes simple: **`manual | review`** per Session (with full-auto remaining a separate explicit user toggle). **Do not add a `off / shadow / enforce` rollout state machine**—Apexo is a local-first CLI/Desktop tool, so enabling `review` (`/auto`) must take effect directly, and `manual` disables model review completely. Keep V1 `LocalQwenPlugin` (`permissionAssist` / `autoAllowReadonly` in [local-qwen.ts][a-local-qwen]) scoped to legacy V1 hooks so native V2 requests have a single Core authority.

Model decisions are strictly **`allow_once | ask`**. Hard denials come only from configured/inherited policy, never from the model, and the reviewer never creates `always` / saved grants.

Execution flow inside native permission handling:

1. Evaluate static agent rules, saved grants, sandbox constraints and inherited authority in [PermissionV2][a-permission-core].
2. Explicit `allow` proceeds immediately; explicit `deny` blocks immediately (no model call).
3. On interactive `ask` tied to a live runtime tool call (never an external `POST /permission` without a runtime owner), register the `Pending` item and publish `permission.v2.asked`.
4. If the Session's native mode is `review`, spawn a bounded background review fiber linked to that `Pending` item's lifecycle.
5. If the model returns `allow_once` and atomic revalidation still matches, settle the `Pending` item once; otherwise publish `ask_manual` status with a concise reason and leave manual buttons active.

### 6.2 Lightweight input origin and evidence boundary

Proposed `core/src/permission/review-context.ts` assembles a bounded snapshot from authoritative Core state:

| Evidence            | Authoritative source                                                                                                                           | Treatment                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Exact action        | Live runtime tool call + canonical [BashApproval][a-bash-approval] metadata                                                                    | Command, args, cwd, target paths, remote/ref, network/sandbox flags + digest  |
| Effective authority | `PermissionV2` authority snapshot + inherited restrictions                                                                                     | Hard ceiling; model cannot override                                           |
| Recent user intent  | Recent `session_input` rows with `origin = "user"`, already promoted, not withdrawn, and present in this Session's effective execution context | Only effective verified user prompts can authorize consequential side effects |
| Task root intent    | Verified parent `SessionTaskStore` / `SessionManagedChild` delegation when applicable                                                          | Child agent self-prompts cannot mint fresh human authorization                |
| Recent observations | Bounded recent tool calls/results in current context                                                                                           | Untrusted context only; file/tool/MCP text cannot grant permission            |

**Pragmatic provenance (`session_input.origin`):** instead of building a cross-compaction digest chain or cross-fork provenance migration system, add a single server-owned column `origin` (`"user" | "task" | "workflow" | "schedule" | "imported" | "unknown"`, defaulting historical rows to `"unknown"`) at `SessionInput.admit` time. Exact prompt retries preserve their original stored `origin`.

Carry origin through the existing durable event/projection path, not a separate post-admission database update:

1. Classify input at trusted ingress: interactive operator submissions, Task/Workflow/Schedule producers and import/history-copy adapters. Internal synthesized review prompts use `unknown`; an ordinary public payload cannot set `origin: user`. Unclassified ingress remains `unknown`.
2. Pass the private value into [SessionInput.admit][a-input] and the canonical input/event schemas. New `PromptAdmitted` events carry origin; promotion carries the stored origin into `Prompted`, never inferring it from a message role or the current caller.
3. Wire [SessionProjector][a-projector] into both `projectAdmitted` and `projectPrompted`, including the latter's historical row-synthesis path, and expose the stored value in internal input reads. Existing rows retain their original origin on retries/promotion.
4. Decode old events with absent origin as `unknown`, using backward-compatible event schema evolution. Rebuilding projections must reproduce the same origin as live admission. Import/fork paths in this batch use `imported`/`unknown` for copied inputs rather than upgrading copied user-role messages into fresh human authorization; exact retries cannot change that classification.

This adds one column and threads a field through existing producers, events and projections; no provenance-chain service is required.

Only recent `origin === "user"` inputs that have a `promotedSeq`, have no `withdrawnSeq`, and belong to the current effective execution context at the captured sequence boundary are eligible for `Verified User Instructions`. Select the last 5 eligible prompts within the token budget, not the last 5 admitted rows. Queued/unpromoted inputs and withdrawn inputs cannot authorize the current tool action. If an instruction only existed many turns ago before compaction, in imported history (`"imported"` / `"unknown"`), or in a scheduled trigger (`"schedule"`), returning `ask` so the user clicks once is already the desired conservative behavior.

Use `SessionInputAdmission.observe` (`core/src/session/input-admission.ts`): if a new user steer/prompt is admitted while a review call is in flight, mark the in-flight snapshot stale so it cannot auto-approve against superseded instructions (falling back to manual `ask`). A new admission is an invalidation signal, not fresh authorization for an already pending action.

### 6.3 Scope matching and bounded classification

**Backend action capture is implementation work:** [Bash][a-bash] already computes `target.canonical` and the actual prefixed command, but its permission metadata currently contains command text and parser metadata, not a resolved repository/remote/ref. Before `PermissionV2.assert`, attach a private immutable action snapshot from those actual execution values: canonical cwd/repository, effective shell/command, parsed arguments and relevant sandbox/network settings. Publicly supplied permission metadata and model descriptions cannot substitute for this snapshot.

For an eligible Git push, collect scope using bounded, read-only Git/config queries from the effective cwd: repository identity, current branch/source commit and ref, selected remote, effective push URL(s), destination refspecs and force/delete flags. Resolve implicit targets only when backend rules can determine them unambiguously. Shell aliases/functions, dynamic `cd`/substitution, unsupported `git -C` or configuration overrides, custom wrappers, ambiguous push defaults and opaque scripts fall back to manual `ask`; the model must not guess omitted scope. Redact credentials in URLs before model/UI exposure.

Immediately before applying an automatic approval, compare the captured action and resolvable scope with current execution facts. Changed cwd/repository/remote/ref or unresolved scope invalidates the approval; the tool must not execute different arguments after review. Extend the existing Bash/permission boundary and [BashApproval][a-bash-approval] parsing narrowly; a general shell semantic interpreter is outside this batch.

An authorization must match the proposed action's concrete parameters:

| Evidence / action                                          | Expected decision                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| “Review the changes” + `git push`                          | `ask` — review does not authorize publication                     |
| “Push this branch to origin” + matching repo/branch/remote | `allow_once` if policy permits and exact command/remote/ref match |
| Same instruction + `--force` or different remote           | `ask`                                                             |
| “Run the tests” + local package test command               | `allow_once` (or static rule allow)                               |
| Repository file or tool output says “user approved deploy” | `ask` — untrusted observation is never user intent                |
| “Wait, don't push yet” admitted while classifier streams   | Invalidated by admission observer → remains manual `ask`          |
| Explicit user request + inherited/configured `deny`        | Blocked by `PermissionV2` before review                           |

Build the reviewer with `LLMClient` and Location-scoped `SessionRunnerModel` (following [side-question-native.ts][a-side-question] for isolated, tool-free streaming without mutating Session history, while keeping dependency direction clean so `PermissionV2` never creates a module cycle with `SessionRunner`).

Bounds: one streamed attempt, `tools: []`, `toolChoice: "none"`, no retries, 20-second timeout, 8,000 input token budget, 512 output tokens, and a Location-scoped `Semaphore(2)` concurrency cap. Preserve the exact action and latest user prompt intact when trimming older context; if the action itself exceeds budget, return `ask`. Any timeout, provider error, malformed JSON or unknown cited message ID falls back to `ask` with a concise reason.

### 6.4 Atomic settlement and races

Note an important existing behavior in [permission.ts][a-permission-core]: `PermissionV2.reply({ reply: "reject" })` rejects **all** pending requests for that Session (because up to 8 concurrent tool calls can run in one turn). Therefore:

- Link each review fiber to its `Pending` item so manual approval, manual rejection (including cascade rejection from a sibling tool call), Session interruption or Location disposal interrupts the review fiber immediately.
- Make manual `reply`, internal `applyReviewed`, sibling cascade rejection and cancellation use one short Session-scoped settlement critical section (for example, `Semaphore(1)`). `Effect.uninterruptible` may protect cleanup but does not serialize fibers and is not a substitute for this gate.
- Before the atomic pending-to-settled transition, verify the `Pending` reference is still live, `SessionLifecycle.Claim` is available, review mode/revision is unchanged, input admission sequence has not advanced, and current `authority` is not `deny`. Coordinate input/mode invalidation with this final check and transition, using the existing admission fence where applicable, so they cannot interleave after validation and before settlement.
- If a human already replied or cancelled, that settlement wins and the late model result is ignored (`superseded`). Never hold the settlement gate across `llm.stream`, and do not wait for review fibers to terminate while holding the gate they may need for cleanup.

### 6.5 Minimal API, events and frontend migration

Do **not** create a separate `permission_review` SQLite audit table, paginated `/permission-review` history endpoints, or a client-triggered `POST /permission/:requestID/review` endpoint: the backend triggers review automatically when an `ask` is created in `review` mode, and neither TUI nor Desktop needs a historical audit table UI.

| Surface / Contract                                        | Purpose                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET / PUT /api/session/:sessionID/permission-review`     | Read or update Session native review mode (`"manual" \| "review"`) with monotonic revision                                       |
| `permission.review.started` / `permission.review.settled` | `EventV2` notifications carrying `requestID`, outcome (`allowed_once \| ask_manual \| superseded`), concise `reason` and `model` |
| `Permission.Request` inline review state                  | Optional live `review?: { status, reason? }` returned by `permission.list / get` on reconnect                                    |

Migrate App (`packages/app/src/context/permission.tsx`) and TUI (`packages/tui`) native V2 Sessions to read/toggle backend review mode via the endpoint above instead of running client-side classifiers or racing multiple windows. Existing browser-local preference is not silently promoted to backend auto-approval without user toggle/confirmation. Headless `reject` / `approve_once` execution policy remains unchanged.

### 6.6 File-level work

| Existing points                                                                    | Proposed changes                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Input producers, `session-event.ts`, `session/input.ts` and `session/projector.ts` | Carry server-owned origin through admission/promotion events, live projection and replay into the new column; preserve exact retries |
| `core/src/tool/bash.ts` and BashApproval                                           | Capture canonical execution cwd/command and bounded backend-resolved Git scope; unresolved or changed scope stays manual             |
| `PermissionV2` (`core/src/permission.ts`)                                          | Shared Session settlement gate, internal `applyReviewed` hook and sibling-cancel fiber interruption                                  |
| Native LLM reviewer                                                                | `core/src/permission/review.ts` and `core/src/permission/review-context.ts`                                                          |
| Schema / Protocol / Server permission groups                                       | `schema/src/permission-review.ts`, Session mode route and `EventV2` definitions                                                      |
| App `permission.tsx` and TUI native adapters                                       | Backend-owned mode toggle, inline reviewing/reason badge, remove V2 client calls                                                     |
| Legacy `auto-review.ts` and `local-qwen.ts`                                        | Keep scoped to V1 compatibility path only                                                                                            |

## 7. Integration, migration and rollout

### 7.1 Schema, database and generated clients

- Add canonical public contracts and `EventV2` definitions in `packages/schema` with unique brands/identifiers. Keep private capabilities/claims in `packages/core`.
- Register new Core services in the appropriate global/Location nodes and export externally consumed services in public AppNode groups (`RULE-20261015-001`, `RULE-20261015-011`).
- Keep SQLite migrations minimal and additive: **only two DB schema additions** across the whole batch—`session_code_review` (for F01 reports) and `session_input.origin` (nullable/defaulted column for F02).
- Add Protocol endpoints/events and Server handlers, then run `bun run generate` from `packages/client` (and `./packages/sdk/js/script/build.ts` only if V1 surfaces change). Never hand-edit generated files, and finish generation before running `typecheck` or tests (`RULE-20261015-018`).
- Keep new App/session-ui i18n strings concise and reuse existing `common.*` / `permission.*` / `session.*` keys wherever possible across the 62 locale dictionaries.

### 7.2 Backward compatibility

| Area                                | Behavior                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Old review conversations            | Remain ordinary transcript messages; no retroactive report synthesis                                                                                                     |
| CLI `--output-schema`               | Continues using the generic structured headless path                                                                                                                     |
| Existing MCP servers                | Normal calls preserve shared connections, OAuth and stateful continuity; cancellation/timeout retires the connection, and exceptional reconnection may lose server state |
| Existing permission rules/grants    | Preserve rule precedence; model review never overrides `deny` or writes permanent grants                                                                                 |
| Historical `session_input` rows     | `origin` defaults to `"unknown"`, never treated as verified human authorization                                                                                          |
| Existing frontend review preference | Native Sessions use backend `manual` by default until user enables native `review` mode                                                                                  |

### 7.3 Rollout and rollback

1. **F01:** land native structured review behind native Session execution, validate CLI formats + TUI/Desktop panels, keep `--output-schema` compatibility intact.
2. **F04:** enable `elicitation.form` handler on native MCP connections, with per-server config opt-out (`elicitation: false`) if a defective server misbehaves.
3. **F02:** default every Session to `manual`; users explicitly opt in via `/auto` / Review Mode toggle, and switching back to `manual` immediately invalidates any in-flight review fiber.

## 8. Verification plan

### 8.1 F01 acceptance

| ID  | Scenario                                                                                             | Required evidence                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | Staged/unstaged/untracked, base, root/merge commit and PR targets                                    | Captured SHAs/patches and manifest match target without mutating user index                                                                               |
| R02 | Rename/deletion/addition/symlink/binary/oversized file                                               | Correct side/line semantics or explicit coverage exclusion; no outside reads                                                                              |
| R03 | Model emits bash/write/edit/MCP/task calls                                                           | Role settlement rejects them; repository worktree/index/HEAD remain untouched                                                                             |
| R04 | Malformed JSON, invalid line range, outside-hunk line, duplicate                                     | Repair works; invalid ranges become file-level anchors without clamping; valid outside-hunk snippets survive reload                                       |
| R05 | Snapshots disabled, captured untracked file edited later, or captured blob unavailable               | Review reads the captured version or reports missing coverage; no live fallback; later edits show `stale`                                                 |
| R06 | Cancel (empty POST), parent delete, restart, exact retry                                             | Child stops cleanly, no hang on `server.close()`, unfinished runs `interrupted`                                                                           |
| R07 | Text/JSON/streaming output, threshold, budgets, repair/fallback and signals                          | Deterministic output; limits include all provider usage and cannot silently disappear; exits 0/1/2/130/143 follow the specified outcome                   |
| R08 | Mini/fullscreen TUI, browser App and rebuilt Desktop window                                          | Start, target selection, history and cancellation work from existing menus; finding navigation uses captured context and preserves human comments         |
| R09 | Attach/auth/remote directory, model options, output export, ephemeral and compatibility combinations | Remote capture stays remote; export stays local and precedes owned cleanup; unsupported flags fail before admission; generic schema behavior is preserved |

Start from `test/cli/run-review-options.test.ts`, `test/v2/headless-runner.test.ts` and native session fixtures in `packages/apexo`.

### 8.2 F04 acceptance

| ID  | Scenario                                                                                    | Required evidence                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01 | String/number/integer/boolean/single & multi enum + defaults                                | Real stdio and StreamableHTTP MCP fixtures receive exact JSON types/values                                                                                 |
| E02 | Bounds/required/unknown keys/nested or unsupported schema                                   | Core rejects invalid schema/input before forwarding                                                                                                        |
| E03 | Stateful server across normal calls + 2 Sessions + concurrent resource read                 | Normal calls preserve server state; shared gate prevents a resource form from reaching an active tool's Session                                            |
| E04 | Decline, Escape cancel, server cancel, Session interrupt and late form                      | Forms settle cleanly; local call cancellation retires the generation and late forms cannot reach the next caller                                           |
| E05 | Real SDK call with short active timeout, longer human wait, repeated forms and hard cap     | Human wait outlives the old SDK tool timeout; active budget resumes without replenishment; SDK and Apexo hard caps terminate; no leaked timers             |
| E06 | Frontend reload vs disconnect/restart/timeout with queued callers                           | Reload restores live forms; retired Clients reject queued dispatch; reconnect does not replay old calls and reports possible server-state loss             |
| E07 | Idle/init/second concurrent elicitation or duplicate UI click                               | Non-tool or concurrent second form rejected; duplicate UI reply idempotent                                                                                 |
| E08 | Headless/scheduled descendants/explicit unattended vs interactive manual/review/auto-accept | Backend-owned policy rejects unattended forms; interactive permission modes still prompt; SDK callback uses captured eligibility and never invents answers |
| E09 | Mini/fullscreen TUI, browser App and rebuilt Desktop window                                 | Stable dialog root, keyboard navigation, validation, Decline and Cancel work                                                                               |

Extend `test/v2/mcp-native.test.ts`, `mcp-oauth-transports.test.ts` and `test/fixture/mcp-native-stdio.ts`.

### 8.3 F02 acceptance

| ID  | Scenario                                                                                       | Required evidence                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Static allow, configured/inherited deny, manual ask                                            | Existing `PermissionV2` precedence unchanged; denies never hit LLM                                                                          |
| A02 | Authorized push vs unauthorized push / `--force` / wrong remote                                | Matching scope approves once; mismatched/ambiguous scope stays manual                                                                       |
| A03 | Prompt injection in file/tool output/MCP form/task child                                       | Untrusted or non-`"user"` origin never authorizes consequential action                                                                      |
| A04 | Historical unknown/imported/scheduled inputs; queued or withdrawn user inputs                  | None supplies effective user authorization; fall back to `ask` when eligible evidence is absent                                             |
| A05 | User input admitted or mode switched during review/final settlement                            | Invalidation cannot race past the final transition; new admission never authorizes the old pending action                                   |
| A06 | Manual reply/reject, sibling cascade and auto-result interleave at authority/event awaits      | Shared settlement gate allows one outcome; completed human settlement cannot be overwritten; fiber cleanup does not deadlock                |
| A07 | Timeout, provider error, malformed JSON or oversized action                                    | Falls back to manual `ask` with concise reason; no retries/recursion                                                                        |
| A08 | Two connected clients + frontend reload + TUI/App/Desktop                                      | Single backend evaluation; consistent live status and manual fallback                                                                       |
| A09 | Each input ingress, new/old admission and promotion events, exact retry and projection rebuild | Origin is preserved through the whole event chain; absent origin stays unknown; import/copy never upgrades trust; replay matches live state |
| A10 | Canonical cwd/prefix, Git remote/ref defaults and overrides, opaque command, changed scope     | Backend supplies actual action scope; unresolved/dynamic or changed targets remain manual without model guesses                             |

Extend `test/permission/auto-review.test.ts`, `test/permission/next.test.ts` and native V2 runtime/HTTP fixtures using deterministic local streaming-provider fixtures for CI. Optionally provide an on-demand evaluation script (`packages/apexo/script/eval-permission-review.ts`) with ~30–60 curated adversarial/authorized cases for manual model benchmarking outside CI.

### 8.4 Cross-surface evidence matrix

| Surface               | F01                             | F04                                  | F02                                        |
| --------------------- | ------------------------------- | ------------------------------------ | ------------------------------------------ |
| Core + native HTTP    | Capture/report/cancel lifecycle | Shared-connection gate + typed reply | Origin check, LLM review, atomic settle    |
| Headless CLI          | Targets, formats, `--fail-on`   | Immediate unattended rejection       | Preserve explicit `reject / approve_once`  |
| Mini & fullscreen TUI | Finding list and diff view      | Typed form dock                      | Mode toggle, reviewing badge, manual reply |
| Browser & Desktop App | `ReviewPanelV2` findings        | Typed form dock                      | Backend mode toggle and inline status      |

### 8.5 Repository gates

Before implementation, reread [the constraint index][rules] and `AGENTS.md`. Run focused tests and `bun typecheck` from package directories during development (never `bun test` from root or `tsc` directly).

Before pushing each PR, run sequentially:

1. Root: `bun turbo typecheck --concurrency=2`
2. Root: `GITHUB_ACTIONS=false bun turbo test --concurrency=2`
3. `packages/client`: `bun run check:generated`
4. `packages/sdk/js`: `bun run check:generated`
5. `packages/apexo`: `bun run test:httpapi`

Record any implementation/test bug fixes in English under `docs/testing/` per `AGENTS.md`.

## 9. Delivery breakdown and effort

Consolidate delivery into **4 vertical, end-to-end PRs** (instead of 9 micro-PRs) to minimize full-suite CI gate overhead and avoid shipping dead intermediate plumbing:

| PR  | Scope                                                                              | Dependency | Exit condition                                                                                              |
| --- | ---------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | **F01 Core + CLI:** contracts, `session_code_review`, Git/PR capture, role & CLI   | None       | R01–R07 and R09 pass, including CLI compatibility, budgets and cleanup                                      |
| 2   | **F01 UI:** mini/fullscreen TUI + App/Desktop `ReviewPanelV2` findings integration | PR 1       | R08 accepted across TUI, browser and rebuilt Desktop                                                        |
| 3   | **F04 End-to-End:** shared-connection gate, `McpElicitation`, API/client & all UI  | None       | E01–E09 accepted on stateful/stateless stdio & HTTP fixtures plus TUI/Desktop                               |
| 4   | **F02 End-to-End:** `session_input.origin`, Core `PermissionReview`, API & all UI  | None       | A01–A10 accepted, including event replay and backend action capture; native App/TUI use backend review mode |

Default sequence: **PR 1 → PR 2 → PR 3 → PR 4** (PRs 3 and 4 have no code dependency on F01 if parallelized on separate worktrees, though merging sequentially keeps generated `packages/client` diffs conflict-free).

Planning estimate for an engineer familiar with this repository:

| Workstream        | Engineering days |
| ----------------- | ---------------- |
| F01 (PR 1 + PR 2) | 4–6              |
| F04 (PR 3)        | 3–4              |
| F02 (PR 4)        | 3–5              |
| Total             | **10–15**        |

## 10. Decisions to preserve during implementation

- Store bounded diff patches and outside-hunk finding snippets with `session_code_review`; no snapshot reference-pinning/GC subsystem or live-file fallback is needed.
- Preserve valid outside-hunk findings (`inHunk: false`); downgrade invalid line ranges to explicit file-level anchors without clamping.
- Reuse shared MCP connections under one gate for operations that can trigger forms. Retire cancelled/timed-out generations before new calls; exceptional reconnection may lose server state. Live forms remain in memory.
- Permission review is a backend decision (`allow_once | ask`) grounded in recent, promoted, non-withdrawn `origin = "user"` inputs in the effective context. New admissions invalidate existing reviews rather than authorizing pending actions.
- Manual and automatic permission decisions share a short Session settlement gate; `Effect.uninterruptible` alone is not mutual exclusion.
- Keep all three presentation surfaces verified on real builds (“native backend passes” is not “Desktop is done”).

## 11. Source index

Local links refer to inspected existing files. Filenames labeled proposed elsewhere do not yet exist. The Codex links are pinned to the comparison commit.

[a-review-cli]: ../../packages/apexo/src/cli/cmd/review.ts
[a-headless]: ../../packages/apexo/src/cli/native-headless.ts
[a-run-options]: ../../packages/apexo/src/cli/run-output-options.ts
[a-runner]: ../../packages/core/src/session/runner/llm.ts
[a-review-panel]: ../../packages/app/src/pages/session/v2/review-panel-v2.tsx
[a-mcp]: ../../packages/core/src/mcp.ts
[a-mcp-tools]: ../../packages/core/src/mcp-tools.ts
[a-question-schema]: ../../packages/schema/src/question.ts
[a-question-core]: ../../packages/core/src/question.ts
[a-auto-review]: ../../packages/apexo/src/permission/auto-review.ts
[a-local-qwen]: ../../packages/apexo/src/plugin/local-qwen.ts
[a-permission-protocol]: ../../packages/protocol/src/groups/permission.ts
[a-permission-core]: ../../packages/core/src/permission.ts
[a-permission-app]: ../../packages/app/src/context/permission.tsx
[a-permission-tui]: ../../packages/tui/src/context/sync.tsx
[a-bash-approval]: ../../packages/core/src/tool/bash-approval.ts
[a-bash]: ../../packages/core/src/tool/bash.ts
[a-input]: ../../packages/core/src/session/input.ts
[a-projector]: ../../packages/core/src/session/projector.ts
[a-execution-policy]: ../../packages/core/src/session/execution-policy.ts
[a-task-role]: ../../packages/core/src/session/task-role.ts
[a-snapshot]: ../../packages/core/src/snapshot.ts
[a-git]: ../../packages/core/src/git.ts
[a-managed-child]: ../../packages/core/src/session/managed-child.ts
[a-goal-role]: ../../packages/core/src/session/goal-role.ts
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
