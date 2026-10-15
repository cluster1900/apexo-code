# Native Tasks

Status: foreground and background backend implementations are integrated. Background shared tests, types, CLI, rebuilt Desktop, actual App/native-window and terminal-panel acceptance pass.

## Scope and reference

The canonical `task` tool runs one owned native subagent. It accepts
`description`, `prompt`, `subagent_type`, optional `task_id`, and optional `background`. A completed owned
`task_id` follows up the same child. Background execution is available in the extension described below; active steering remains unsupported. Unknown task IDs never create replacements.

Pinned Grok revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` provides background
Tasks, transcript-fork continuation, output and cancellation. Installed 1.0.52
comparison passed five checks with three child provider calls and 29 total requests
including ancillary work. Background returns while the child is held; output
reports running; completed `resume_from` creates a different child; cancellation
reports cancelled. The installed catalog does not advertise
`send_subagent_message`. Its `background` field differs from the pinned source's
`run_in_background`; source-only delivery is not claimed as installed behavior.
Apexo's foreground, same-child continuation is an explicit architectural adaptation.
No Grok runtime or orchestration engine is embedded.

## Execution and ownership

The native tool registry calls a Location-scoped Task service. Agent, model,
credentials and permissions resolve before mutation admission. A generic
`SessionRunner.Children` capability delegates each owned child drain to Apexo's
existing Session runner. Existing BackgroundJob owns cancellation. A one-use Task
role pins agent/model and promotes only the deterministic owned input. There is no
legacy loop bridge, direct provider stream, or second scheduler.

Private `session_task` and `session_task_launch` records retain exact parent/child
Created identities, immutable model and permission authority, launch input,
process owner, terminal receipt and final reply ID. Created publication atomically
commits sandbox inheritance and private Task authority before observers can learn
the child. A failed commit rolls back the Session projection, policy, authority and
event together. Mutable Session metadata cannot grant Task authority.

PermissionV2 intersects separately captured rulesets using its existing evaluator.
Configured hard denials and last-match wildcard exceptions survive public grants,
metadata changes and follow-up reconstruction. Ordinary child permission approval
can satisfy inherited ask. An always response cannot grant unrelated siblings or
project-wide access through the inherited Task boundary.

Standalone native prompt, side-question, Goal and Workflow admission, manual
compaction, and compatibility execution cannot start unaccounted work on a private
Task child. A present stale or invalid private record fails closed; only an absent
record is considered unmanaged. Rejection occurs before inbox, transcript, auxiliary state or process
work. Ordinary Sessions retain their behavior. Completed exact retries select their original launch ID and return the
same receipt even after a later follow-up; changed input conflicts. Unfinished prior-process launches remain
interrupted and require a new Task. Reads and waits never restart provider work.

## Management API

Task IDs are child Session IDs. All endpoints require the owning parent Session.

| Endpoint | Result |
| --- | --- |
| `GET /api/session/:sessionID/task` | Summary list; default 50, maximum 100, newest creation first and descending ID tie-break |
| `GET /api/session/:sessionID/task/:taskID` | Detail with durable output |
| `POST /api/session/:sessionID/task/:taskID/wait` | `{ task, timedOut }`; optional `timeoutMs` from 0 to 120000, default 30000 |
| `POST /api/session/:sessionID/task/:taskID/cancel` | Bodyless request, joined 204 response |

Summary contains `id`, `parentSessionID`, `description`, `status`, `startedAt`,
optional `completedAt`, optional `background`, and optional `blockedReason: "process_restart"`. Detail
adds `output`. Status is running, completed, failed, cancelled or interrupted.
Lists expose neither full output nor private authority. Unknown/foreign Tasks are
404; stale ownership and unsupported continuation are 409.

A newly committed launch can briefly precede worker registration. Cancellation
then returns a retryable 409, preserving the running receipt; it never reports
successful cancellation while allowing future execution. Registered cancellation,
foreground results and wait share a terminal receipt latch that settles after
joined child cleanup and durable terminal publication. Concurrent cancellation
joins that same receipt. Generic BackgroundJob completion alone is not proof of
Task receipt settlement. Missing receipts or closed owners fail the latch.

## Accounting and remaining restrictions

Foreground Tasks under an ordinary Goal worker carry its exact attempt and usage
observer. Normal child streams and automatic compaction contribute actual usage
before further Goal work. The budget fixture reaches 11 tokens for normal child
work or 13 for compaction against an 8-token budget, then prevents additional
provider work; it does not pretend already consumed tokens were capped.

Task is unavailable inside managed Workflow children until logical-agent budget
reservation is implemented. Goal role children cannot launch nested Tasks.
[Native foreground nesting](native-task-nesting.md) is available to privately owned
Task children within a captured `task.maxDepth` policy (default one, maximum sixteen).
Nested background Tasks, background Tasks under Goal ownership, active steering and
transcript-fork continuation remain separate work. These restrictions are not parity completion.
Sandbox policy is inherited through the private Created-bound service, never from
mutable metadata or a broadened working directory.

## Verification boundary

The sandbox-composed focused suite passed 10 tests and 182 assertions, covering
actual canonical provider execution, same-child follow-up, invalid agent and the earlier foreground-only background rejection,
private permission reconstruction, native/compatibility admission rejection,
concurrent cancel/wait, parent deletion with ID reuse, and Goal stream/compaction
accounting. Expanded atomic rollback and receipt-latch checks passed 2 tests and
39 assertions. After the final exact-retry correction, the affected canonical
receipt/store/control/deletion suite passed 6 tests and 118 assertions. Core package typechecking passed. Apexo package typechecking also passed after the composed dependency refresh.
The final composed CLI rerun passed five checks with 15 provider calls.

Both the earlier isolated and final sandbox-composed CLI runs passed five checks
with 15 provider calls: follow-up,
owned control/admission rejection, concurrent cancellation with exactly one parent
continuation, unavailable model with no child, and real process restart preserving
completed output while refusing unfinished replay. Installed-reference evidence is
comparison evidence only. The coordinated rebuilt Desktop rerun also passed five checks with 15 provider calls. The production browser and actual native window each passed six checks with eight provider calls across English, Simplified Chinese and Traditional Chinese. Native mini/fullscreen panels passed three checks with eight provider calls each at 80×24. See [Task surfaces](native-task-ui.md) for the panel/bootstrap distinction.

## Shared integration checkpoint

The Task and command-sandbox source is now integrated together. The combined package gate passed 23 tests / 284 assertions across twelve files, with clean shutdown. All 21 repository typecheck tasks, generated database schema/migration consistency, Client and legacy SDK generation, and Client generated consistency passed. The last check used an isolated Git index for this uncommitted candidate; the working index was untouched. The rebuilt Desktop backend passed the same Task five-check/fifteen-call and sandbox seven-check/four-call fixtures as the CLI. Focused HTTP coverage passed nine scenarios over 274 inventoried routes, with no missing, extra or skipped scenarios. Task UI acceptance is recorded separately; sandbox creation controls remain in development. This checkpoint does not mark the complete parity scope or repository unit gate green.

## Background extension

`task(background: true)` transfers its existing worker and terminal settlement scope to Location ownership and returns the registered receipt. The same private Task authority, one-use role, Session runner and BackgroundJob execute the child. Closing the Location application scope, deleting the parent, or cancelling the child joins its worker and terminal receipt. A settled background Task can follow up the same child in foreground mode.

Ordinary completed or failed children contribute bounded, explicitly untrusted Task data through a domain-owned SystemContext source. An idle parent receives one advisory wake through its existing coordinator. An active parent finishes its current tool/continuation chain before consuming the completion. No new durable user prompt or Session input is created. Completed model-facing `task_wait` consumes the notice; passive management reads/waits do not. Cancelled children do not produce a completion wake.

Tickets are bound to the exact parent Created incarnation, current process and accepted Stop generation. Parent Stop suppresses a late completion wake without concealing the child's readable terminal receipt. Deletion and ID reuse cannot transfer a notice. Restart never replays unfinished child work or pending completion provider work. Background execution inside Goal ownership or any managed child is rejected before child mutation; ordinary foreground Goal usage accounting is unchanged.

The optional summary flag reports the current launch's background mode. Missing flags retain the earlier foreground display default. It does not promise recovery of background work after restart. Existing recent-task limits and interrupted/process-restart guidance still apply.

### Background verification

Private production-source tests passed 15 tests / 153 assertions across completion fencing, real ownership/scope teardown, existing foreground execution and eight background HTTP cases. The native CLI passed 8 checks / 32 provider calls with `bun script/grok-native-task-background.mjs cli`. The same script accepts `desktop`, pending a coordinated rebuilt artifact.

Isolated installed Grok 1.0.52 comparison on 2026-10-15 used four private profiles. Idle completion made one child call / 11 total requests; active-parent completion one / 12; blocking wait one / 12; cancellation one / 12. Idle and active completion each produced exactly one tools-enabled parent reminder; the held active parent received no concurrent request. Blocking wait and cancellation produced no duplicate reminder. Ancillary title/summary requests are included in totals but are not parent completion turns. Reproduce with `bun script/grok-native-task-background-official.mjs idle` (also `active`, `wait`, `cancel`). This is local fixture comparison, not external service acceptance.

The implementation remains Apexo-owned and does not run Grok in product execution. Transcript-fork continuation, resume-from-transcript, worktree delegation, active child steering and Goal background lifetime/accounting remain outside this extension. A separate SOAP-shaped 500 observed during two private HTTP fixture runs has an unknown cause; passing subsequent runs do not establish a repair.

### Final private checkpoint status

After refreshing every unowned source and manifest from one live checkpoint, private Client/SDK generation and Core, Apexo, App and TUI typechecks passed. The combined Task regression passed 32 of 33 tests (316 assertions); its only failure was a 41 ms ECONNRESET on Session creation before Task/provider work, tracked as [BUG-20261015-106](testing/test-stability/task-background-connection-reset.md). This gate is not reported green. The coherent-checkpoint CLI passed all 8 checks / 32 provider calls. App adapters passed 9 tests / 35 assertions, and terminal adapter cases passed within the combined gate. The earlier 15-test and split 18-test results remain scoped evidence, not substitutes for this final failed aggregate.

## Shared background integration checkpoint

The complete shared Task suite passed 33 tests / 328 assertions across 11 files, including foreground accounting/admission and all eight background cases. App adapters passed 9 tests / 35 assertions. All 21 repository typecheck tasks passed. Client and legacy SDK generation passed; unchanged Client `check:generated` passed against an isolated candidate Git index without touching the real index. App and Desktop production builds passed.

`bun script/grok-native-task-background.mjs cli` and `desktop` each passed 8 checks / 32 local-provider calls, including real restart refusal, accepted Stop fencing and deletion/reuse. The prior isolated installed idle/active/wait/cancel comparison remains reference evidence. The background row indicators and actual browser/native-window/mini/fullscreen slice now pass acceptance: browser/native ten checks / 22 calls each, and shared narrow terminals seven / 22 each; private normal-size terminals also pass. Fixed-backend performance evidence and inspected screenshots are recorded in [background UI acceptance](native-task-background-ui.md). The earlier SOAP-shaped response and connection-reset observations remain unresolved; this successful checkpoint does not identify their causes. It does not turn the repository-wide unit gate green.
