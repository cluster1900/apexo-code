# Native headless input execution: backend Phase 1

This is an integrated backend implementation, not a completed native CLI feature. Apexo owns prompt admission, model execution, permissions, tools and persistence. No product code invokes Grok. Native headless local/attach command-line integration, output rendering and terminal signal handling are being validated separately before shared integration.

## Shared integration checkpoint

The combined backend, Memory and ownership gate passed 60 tests / 449 assertions across eleven files. All 21 refreshed workspace typechecks, canonical migration generation/checking, Client and legacy SDK generation, isolated-index generated consistency and the shared Desktop build passed. The four focused input HTTP scenarios passed with no failures, skips or inventory gaps. The Scheduler composition also passed its separate 18-test / 345-assertion gate. The complete HTTP gate subsequently passed all 323 scenarios in each of coverage, authorization and Effect modes over 295 routes, with no failures, skips or inventory gaps. The complete unit gate is still running. These results verify the backend composition; they do not certify the pending command-line adapter or its signals/output behavior.

## Input policy and outcomes

An optional `executionPolicy: { mode: "headless", permissions: "reject" | "approve_once" }` belongs to one canonical Session input. Omitting it preserves ordinary behavior. Exact retry includes the policy alongside the existing Session, prompt and delivery identity. Changing policy under the same input ID conflicts; retrying a withdrawn or completed input does not run it again. Existing ordinary rows and historical ordinary Prompted events remain ordinary.

The existing `session_input` row carries nullable policy/outcome columns. There is no durable drain identity, separate executor or run table. PromptAdmitted and Prompted preserve the optional policy. A durable InputExecutionSettled event records terminal outcomes without adding visible transcript content. The Prompted event sequence is the start boundary; a new canonical prompt deterministically supersedes a prior unfinished headless input. Operational process stamps never become execution authority through replay.

Public outcomes have the original input ID, Session ID, policy, admitted sequence, optional promoted/start/end sequences, status, optional reason/finish and `usageIncomplete`. Status is admitted, active, completed, failed, interrupted or superseded. Reasons are completed, provider_error, turn_limit, interrupted, process_restart, superseded, withdrawn or unavailable. Sequence bounds identify input evidence, not a drain or a new transcript partition. Output rendering must use canonical message/terminal evidence within those bounds and must not silently absorb a later unrelated input.

Normal settlement follows provider/tool cleanup and the existing Stop-hook continuation decision. Failed tools may continue through the normal next provider turn. Provider errors and turn limits have distinct failed receipts. Cancellation uses the current coordinator's joined cleanup. All receipts are terminal-immutable; later ordinary input can still steer or queue normally.

Known usage receipts remain in the canonical transcript. `usageIncomplete` is conservative: it is true when an actual model/compaction/foreground-child stream lacks valid usage, or when durable supersession/recovery cannot prove complete accounting. A final known receipt does not erase an earlier unknown one. Superseded inputs retain a conservative incomplete flag even when their earlier turns happened to report usage. This phase does not expose new aggregate token totals.

## HTTP surface

All endpoints use the existing Session middleware and stored Location. The Server delegates through SessionV2; there is no frontend execution loop.

| Endpoint                                               | Result                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Existing POST `/api/session/:sessionID/prompt`         | Adds optional executionPolicy; returns the existing admitted input envelope                       |
| GET `/api/session/:sessionID/input/:inputID/execution` | `{ data: Execution }`                                                                             |
| POST the same path plus `/wait`                        | Body `{ timeoutMs?: number }`, integer 0–30000, default 1000; `{ data: { execution, timedOut } }` |
| Bodyless POST the same path plus `/interrupt`          | `{ data: Execution }` after withdrawal or conditional joined cancellation                         |

Read and wait are passive and cannot wake a provider. Bounded polling observes already-settled outcomes without an event-subscription race. Missing Session/input is 404, stale or unavailable ownership is 409, and a storage settlement failure is a safe 503. Invalid wait payloads are rejected by the existing schema layer. A retained read claim cannot return a replacement Session's input when both IDs are reused.

Pending interruption writes a withdrawal under a short lifecycle mutation lease. Pending selection and the Prompted transaction both reject it, so a previously captured pending-row list cannot append a Prompted event for withdrawn work. Active interruption holds no mutation lease while joining execution. It supplies the exact live input capability as the existing coordinator's acceptance predicate. Promotion revokes the old predicate inside the canonical transaction. A terminal old input returns its receipt; it cannot cancel newer work. An active but not registered or no-longer-owned input returns conflict instead of falsely claiming cancellation.

## Recovery and ordinary work

A passive read derives interrupted/process_restart only when the stored process PID is independently proven absent (`ESRCH`). A service replacement, elapsed time, a different token, PID reuse, permission error or unknown owner is not proof of death. This derived view does not mutate the receipt or authorize provider work. A new explicitly admitted input may supersede old unfinished work; the resulting durable projection is deterministic under EventV2 replay.

Bare resume/advisory wake cannot replay a settled or unowned headless input. An exact prompt retry cannot authorize a second provider execution. Ready Task/Process notices are not consumed by headless execution, and completion-only wakes do not extend its result. A later ordinary steer or queued prompt may consume those notices through the existing runner. Ordinary Session.wait retains its process-local ownership snapshot semantics; it is not the new per-input completion API.

## Permissions and capability limits

The native runner installs a scoped policy only after canonical input promotion and before context, tools and provider work. PermissionV2 retains configured and inherited hard denials. `reject` converts unresolved asks into denial; `approve_once` permits that invocation without saved grants or unrelated permission-reply fan-out. No agent/config mutation, tool-registry authorization callback or second policy engine is introduced.

Foreground Task launches capture the policy in their private durable request and inherit it into the trusted child input. Parent restrictions and the child's configured restrictions remain authoritative. Background Task, owned detached Bash/process work, Monitor, Scheduler, Goal, Workflow, Question, Plan transitions and unsupported elicitation are unavailable under this policy. Hidden definitions alone are not authorization: forced unsupported calls are rejected during materialization, and Task/process/permission leaves retain authoritative checks before side effects. Ordinary foreground Bash remains supported.

Public management operations performed independently by a human are not converted into a headless invocation merely because the Session previously had one. The policy is per input. Automatic Memory capture/provider maintenance must be suppressed under the scoped policy; the separate Memory lifecycle draft consumes `SessionExecutionPolicy.forSession` for this purpose and requires composition verification before release.

## Verification

Private pinned Bun 1.3.14, actual canonical migration generation, real SQLite/EventV2/native runner and local HTTP provider:

- Final focused gate: **39 tests, 301 assertions, zero failures**, across the new input/runner/pure-and-mixed HTTP tests and existing lifecycle, control coordinator, deletion and Task-store tests.
- The new tests cover exact retries, historical/replayed policy, withdrawal after pending selection, no cancelled Prompted event, deterministic replay, known-dead versus live/unknown ownership, terminal immutability, provider completion before wait, steering/queue attribution, cancellation after newer promotion, deletion/ID reuse, hard denial under approve-once, failed-tool continuation, foreground child inheritance, detached rejection and ready-notice preservation.
- Final Core and Apexo package typechecks passed after the deterministic replay and resume-guard ordering refinements.
- Private migration/registry/schema artifacts are validation-only and excluded from delivery. Root must generate the combined canonical migration and clients after integration. No generated client was hand-edited.

Installed Grok 1.0.52 and pinned source are comparison evidence only. Nine isolated scenarios used 18 local provider requests: 12 conversation and 6 ancillary title requests. They covered plain, JSON and streaming JSON output, default permission refusal, auto approval, configured Bash deny under auto, no-operator Question behavior, SIGINT and SIGTERM. Installed JSON format differs from Apexo's existing contract; Apexo's output contract remains authoritative. Signal observations do not establish joined descendant cleanup. They do not validate Apexo's backend or the future CLI phase.

No CLI, Desktop, browser or terminal headless acceptance is claimed for this backend phase. The final native CLI must use admitted input identity and these passive outcomes, preserve existing plain/JSON/streaming-JSON formats, and add actual signal/child cleanup acceptance. Detached orchestration and interactive Question/Plan behavior remain explicit gaps.
