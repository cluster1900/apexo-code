# Native Scheduler

Status: backend integrated with shared scoped acceptance, canonical migration, generated clients and all 21 typechecks passing. App/TUI presentation, automatic future rearming after Session restoration and fresh complete unit/HTTP gates remain open. This is separate from the compatibility Scheduler described in [native-scheduler-ownership.md](native-scheduler-ownership.md).

## Native behavior

The canonical `scheduler_create`, `scheduler_list` and `scheduler_delete` tools use Apexo-owned native Sessions, permissions, model resolution, Task receipts and the existing SessionRunner coordinator. No Grok executable, legacy prompt loop or second model executor participates. A schedule is a distinct `sched_` intent; each admitted occurrence owns a genuine native Task and a private occurrence identity.

Creation requires a prompt and an integer interval with `s`, `m`, `h` or `d` suffix. Intervals shorter than 60 seconds become 60 seconds. Creation defaults to recurring intent with `durable: false`. Both flag values remain saved with the owning Session and support future-only Resume after restart; `fire_immediately` affects initial creation only. New `recurring: false` requests are rejected with background-Shell guidance. The configured native `general` subagent is selected; its explicit model or the parent's selected native model is captured. There is no arbitrary provider bridge or silent model replacement.

Updates retain the intent ID and creation time. Prompt updates reset the next continuation chain; interval updates retain the previous cadence phase. Neither cancels an already admitted Task. Each intent has at most one unfinished occurrence. A due tick while its child is running is skipped, with a future deadline rather than catch-up work. Ten completed occurrences can reuse one settled native child; the next occurrence creates a fresh child with at most 600 characters of summary. Failed or cancelled children are not resumed as successful continuations.

The store limits nonterminal intent to 50 entries per Session and sets seven-day expiry. These bounds are implemented; the acceptance below does not claim a real seven-day observation or exhaustive capacity stress test. Canonical tool listing can expose an expired record with its explicit terminal state; the management API lists only active or paused intent. Detail remains available for owned terminal records.

## Authority, cancellation and restart

Saved authority is private, not model metadata. Every fire uses the saved parent actor, selected child agent/model and captured permission restrictions together with current native permission policy. Missing actors fail closed through PermissionV2's missing-agent deny policy. Native model resolution precedes mutation; final Task admission then revalidates exact parent Created identity, process owner, occurrence/launch identity, intent revision/generation, current Stop epoch, active Goal and pending Plan. The atomic child Created commit also writes Task authority before event observers can act.

Managed children and captured Goal attempts cannot create or own timers. An ordinary paused-Goal Session remains usable. Only a live scheduled child's exact private role and launch receipt permit listing, updating or deleting its own originating intent; sibling intents remain denied. A due active Goal pauses intent. Pending Plan skips that tick; parent completion delivery still passes the existing Plan-first boundary. Missing agent/model or failed preadmission authority pauses the intent with a safe unavailable reason.

Accepted active Stop revokes the timer epoch, pauses future intent and joins scheduled children. A child admitted before worker registration can finish registering only its exact already-owned receipt; its start fence prevents provider/tool execution after revocation. Explicit Resume waits for old Stop settlement. Idle Stop is a no-op. Deleting a schedule removes future intent while an admitted Task remains independently controllable through Task output/wait/cancel. Deleting the Session revokes its exact incarnation, drains admitted writes, joins owners and removes records. There is no second Scheduler completion notice: terminal occurrence and Task receipts precede the existing Task notification.

Saved intent never authorizes automatic provider replay after process restart. Passive reads report paused/restart_required for either durability value until the actual seven-day TTL expires. A process owner change alone does not expire ordinary Session intent. Unfinished old-process occurrences display interrupted, and their old admission cannot launch again. Explicit Resume revalidates authority and installs only a future deadline; it does not replay missed or unfinished work. User prompts, generic resume, Plan replies and passive reads do not rearm stopped timers.

## API

All routes are under `/api/session/:sessionID/schedule` and use existing native authentication and Session placement:

| Method/path | Operation | Behavior |
| --- | --- | --- |
| GET root | `v2.schedule.list` | Passive safe Summary list; no full prompt or private authority |
| GET `/:scheduleID` | `v2.schedule.get` | Owned Detail, including prompt and latest verified Task identity |
| DELETE `/:scheduleID` | `v2.schedule.delete` | Bodyless; remove future intent; 204; idempotent for an owned deleted record |
| POST `/:scheduleID/pause` | `v2.schedule.pause` | Bodyless; pause future intent; return Detail |
| POST `/:scheduleID/resume` | `v2.schedule.resume` | Bodyless; explicit future-only Resume; return Detail |

Unknown/foreign intent is 404. Safe typed errors distinguish invalid input, ownership conflict and unavailable storage. Public summaries never expose process tokens, permission snapshots, credentials or launch authority. Two additive database tables store intent and private occurrences. Shared integration generated the canonical `20261015012212_native_scheduler` migration from the SQL leaf and passed migration consistency; the private validation migration was excluded.

## Shared acceptance

The shared ten-file Scheduler/Task/protocol gate passed 22 tests / 391 assertions. All 21 workspace typechecks passed without cached tasks, and the six focused HTTP scenarios passed over the 288-route inventory with no failures, skips or inventory gaps. Client and legacy SDK generation, isolated-index generated consistency and the rebuilt Desktop backend passed. The real Git index was unchanged by generated verification.

`bun script/grok-scheduler-native.mjs cli --recurrence --default-durable` and the equivalent `desktop` command each passed six checks / 15 provider calls. They verify omitted durable remains false through actual restart, passive reads induce no model work, explicit Resume schedules future work, deletion preserves an admitted Task, active Stop joins children, idle Stop is a no-op, and a held child spanning a real 60-second tick cannot overlap the next occurrence. The final CLI and Desktop commands without those flags each passed five checks / nine calls with explicit durable true. Owned processes were reaped. These runs verify the CLI and packaged Desktop backends; they do not certify the native Scheduler window.

A fresh isolated installed-runtime `grok-scheduler-official.mjs contract` comparison passed with 25 provider requests and its owned process reaped. The complete unit and HTTP gates remain pending for the integration batch; earlier complete results do not cover these changes.

## Scoped acceptance

All commands below run from `packages/apexo` with pinned Bun 1.3.14 unless a different package is stated. These are private-checkpoint results, not shared aggregate or CI results.

- The nine-file Scheduler/Task gate passed 18 tests / 280 assertions: `bun test test/v2/schedule-store.test.ts test/v2/schedule-execution.test.ts test/v2/schedule-late-authority.test.ts test/v2/schedule-tools.test.ts test/v2/task-store.test.ts test/v2/task-background-ownership.test.ts test/v2/task-created-admission.test.ts test/v2/task-authority.test.ts test/v2/task-completion.test.ts`.
- A subsequent narrow `bun test test/v2/schedule-store.test.ts` passed 1 test / 83 assertions after four explicit orphan-read assertions were added. It verifies interrupted old-owner projection, preserved verified Task ID, refusal of old admission and no passive claim. The store test also exercises real transactional claim/bind/settle across ten same-child occurrences and the eleventh fresh child; only persisted due deadlines are advanced for that bounded store test.
- Actual held-barrier tests cover async claim crossed by Stop/Resume, child Created admission held before registration during Stop, schedule deletion and Session deletion, and Goal/Plan/delete changes while real model resolution is held. Captured Goal denial and ordinary paused-Goal success, exact child self-management, sibling denial, and scheduler/task permission denial with zero child work are verified.
- `bun script/grok-scheduler-native.mjs cli --recurrence` passed five checks / 12 provider calls before the active-Stop extension. The final script without `--recurrence` passed five checks / nine calls, adding accepted active Stop, joined child cancellation, late completion suppression and idle Stop no-op. Together these exercise every final CLI scenario; the combined final command is ready for shared integration acceptance.
- The rebuilt private packaged backend passed the final `bun script/grok-scheduler-native.mjs desktop --recurrence`: six checks / 15 provider calls. It includes real 60-second recurrence: a held child spans the first due tick, no overlap is admitted, and the next future tick continues the same settled child. Passive restart reads make no provider calls; Resume schedules only future work. This verifies the packaged backend, not a native window.
- Core, Server and Apexo package `bun typecheck` passed. All owned code passed Prettier checking. The private Desktop production build passed with explicit build version/channel; no shared artifact was written. Owned fixture backends and listeners were joined and reaped.

## Installed reference and deliberate differences

Reference only: pinned Grok Build source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`; isolated installed Grok Build 1.0.52, build `0920c8169e27`, observed on 2026-10-15. The reproducible comparison script is `grok-scheduler-official.mjs`; use `contract`, `delete` or `stop` as its argument, with `GROK_BIN` selecting the intended installed binary. It creates its own profile, local provider and leader socket and explicitly cleans up its runtime. This script is never imported by product code.

The three successful installed probes recorded 25, 16 and 15 total provider requests respectively, including ancillary requests. Contract observations: 1s became 60s; prompt-only update preserved ID/creation/next-fire despite fire_immediately; deletion emptied listing; new recurring=false was rejected. Held-child deletion did not close that child's response and allowed one later model turn after release. Active-parent ACP Stop returned cancelled; releasing the child caused no new turn during the bounded 1.8-second observation, while the schedule remained until explicit deletion. These are local fixture observations, not external-service or long-duration guarantees. The retained comparison script only replaces the audit's absolute helper import with its repository-relative equivalent; no second installed run is claimed for formatting/relocation.

Pinned source additionally shows skipped running-child/descendant ticks, phase updates, ten-iteration rollover and bounded summaries. Installed continuation uses new transcript-resumed child identities; native continuation intentionally reuses its existing same-child settled Task capability before rollover. Native restart requires explicit future-only Resume, unlike automatic installed timer recovery. Native accepted Stop explicitly pauses timers and joins children. These are documented safety/identity differences, not claims of exact behavior equivalence.

Native Scheduler App/TUI presentation and `/loop`, arbitrary transcript fork/resume, automatic unattended post-crash recovery, legacy record import and distributed scheduling remain outside this backend slice. Existing compatibility behavior is unchanged.

## Same-Session restart correction

An additional isolated installed 1.0.52 probe, `bun script/grok-scheduler-session-restart-official.mjs omitted`, made 15 provider requests and passed four observations: omitted durable persisted as false, the same intent survived an actual process kill and Session load, one child automatically fired at the real 60-second cadence, and explicit deletion emptied the list. Both owned processes were reaped. This validates same-Session recovery; it does not establish transfer into a different Session.

The native store originally expired false-valued intent when the process owner changed. The regression failed at that exact state comparison, then both durability variants passed two tests / 166 assertions after correcting expiry to use the actual TTL. The corrected store is included in the shared 22-test gate above. Shared CLI and rebuilt Desktop `--default-durable --recurrence` runs each passed six checks / 15 calls through real creation, restart, passive reads and explicit Resume; explicit durable runs each passed five checks / nine calls. See [BUG224](testing/runtime/scheduler-session-restart-intent.md).

Automatic rearming on explicit Session restoration remains an open parity requirement. It requires an Apexo-owned recovery design that distinguishes future occurrences from replay of interrupted provider work, verifies the owning Session incarnation and previous process quiescence, and respects current authority, Stop, Plan and Goal fences. Neither this retention correction nor manual Resume closes that requirement.
