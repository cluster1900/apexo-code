# Native Monitor backend

Status: integrated on 2026-10-15. The shared 21-file Monitor/Memory/terminal regression passed 141 tests / 803 assertions, all 21 workspace typechecks, Client/legacy SDK regeneration, isolated-index generated consistency and Desktop build. Shared CLI and rebuilt Desktop each passed ten checks / 57 provider calls; all twenty command-owned PIDs were absent after cleanup. Six fresh installed-reference comparisons passed separately. Current complete repository gates and Monitor-specific App/TUI presentation remain pending.

## Contract and ownership

The canonical native `monitor` tool runs a shell command through Apexo's existing Session process owner, AppProcess, CommandSandbox and PermissionV2. It returns a `proc_` receipt and reuses the existing Session process list/output/wait/cancel endpoints. It does not create a child Session or use a compatibility prompt loop.

Input requires `command` and `description`; `workdir` is optional. `timeout_ms` defaults to 36,000,000 milliseconds, accepts null as the default and zero as no deadline. `persistent: true` ignores the supplied timeout and records an effective zero deadline. A nonpersistent timeout above 36,000,000 is rejected. Persistent means the current owned process lifetime, never automatic restart or provider replay.

The additive wire fields are `kind: "shell" | "monitor"` and optional `monitor: { persistent, timeoutMs, accepted, suppressed, overloaded }`. Old Shell summaries omit Monitor data. Counts represent accepted/suppressed batches, including bounded delivery-queue drops; they are not counts of provider requests or individual lines. The private immutable launch request retains the Monitor options for exact retries. No database table or endpoint was added.

Monitor requires both `monitor` and `bash` permission, plus external-directory approval when applicable. It uses the same captured native command sandbox and its private handshake filtering. Managed Task/Workflow/Goal children, active Goals and captured Goal attempts are rejected before receipt creation or spawn. An ordinary paused Goal Session without a captured attempt remains ordinary.

## Output and delivery

Both stdout and stderr feed independent incremental UTF-8 decoders, including unconfined execution. Each underlying AppProcess pipe collector is bounded to one MiB; the public combined preview has its separate one-MiB total bound. The real split-byte integration correction is [BUG168](testing/runtime/monitor-independent-pipe-decoding.md). Complete nonblank lines are bounded to 500 Unicode code points, pending batches to 3,000 code points, and final unterminated lines are flushed once. Ordering follows observed output chunks; this is not a total ordering guarantee for writes to independent OS pipes. The separate retained Process preview is bounded to one MiB. Live Monitor events continue after that capture fills.

One process-scoped worker coalesces dirty signals and flushes after 200 ms. It also performs trailing retained-output writes for ordinary owned Shell processes, fixing [BUG156](testing/runtime/process-trailing-preview.md). Quiet processes do not poll storage or start provider turns. There is no per-line detached fiber or second reader. Worker interruption is joined before terminal receipt storage, including cancellation/failure paths.

The Monitor-specific token bucket charges one token per batch: capacity ten, refill one per two seconds. Suppressed batches are counted and a later accepted batch reports suppression. Sustained suppression beyond 30 seconds marks overload and kills/joins the actual process. This deliberately leaves the existing compatibility per-line limiter unchanged. At most fifty pending batches are retained across a Session's live Monitors, and at most four enter one safe provider-turn boundary. Bounded remaining data is folded into terminal delivery.

Live data is an explicitly untrusted SystemContext update. It is neither durable user input nor permission/Plan consent. Active provider streams and tool batches finish before delivery; idle delivery uses the existing owned coordinator notification. Pending Plan reconciliation runs first, so data cannot bypass an unanswered approval question. Terminal storage and process teardown precede terminal notification. Model wait/cancel consumption and passive HTTP reads retain their existing distinct semantics.

Accepted Stop suppresses queued and future delivery without turning a process into a new user request. Only promotion of real new user input in the same Session incarnation rearms a still-running Monitor; pre-Stop backlog and partial lines are discarded. Public execution resume, passive process reads/waits and Plan reply do not rearm it. Old Shell completion tickets are never rearmed. Session deletion and Location teardown join owned work; passive post-restart reads show interrupted receipts and never replay a process or provider turn.

## Reference comparison

The behavioral reference is isolated installed Grok Build 1.0.52 (`0920c8169e27`) and pinned source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`. Product code does not invoke or embed the reference runtime.

Source boundaries: `crates/codegen/xai-grok-tools/src/implementations/grok_build/monitor/{types,event,tool}.rs`, `computer/local/terminal.rs`, `session/acp_session_impl/run_loop.rs` and `tools/notification_bridge.rs`. These establish the Monitor options, both-pipe reader, 200 ms batch quota, owner-filtered pending notifications and terminal completion bridge.

Six fresh isolated local-provider scenarios completed and reaped on 2026-10-15:

| Scenario             | Observed installed behavior                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle                 | One event/model turn contained stdout emoji and stderr Chinese.                                                                                    |
| Active parent        | Zero new model turns while the parent provider was held; one event turn after release.                                                             |
| Completion           | Event and terminal delivery caused two subsequent model turns; the PID exited.                                                                     |
| Explicit kill        | PID exited and no Monitor event update was emitted.                                                                                                |
| Sustained overload   | The runtime reported “Monitor stopped” while the PID remained alive.                                                                               |
| Stop then user input | A future line still caused one model turn after ACP cancel and before new user input; later explicit input and another line caused two more turns. |

Apexo intentionally differs on overload by killing and joining the process, and on accepted Stop by suppressing delivery until real user promotion. Managed-child Monitor reparenting supported by the reference is outside this bounded native slice. The long persistent lifetime was not duration-tested; source-derived timeout semantics are distinguished from the short local fixture observations. No external service or remote-host behavior is claimed.

Reproducible comparison: run `bun script/grok-native-monitor-official.mjs <scenario>` from `packages/apexo`, where scenario is `idle`, `active`, `complete`, `cancel`, `overload` or `rearm`. The script uses its own profile, provider and processes. Native acceptance never depends on that executable.

## Scoped validation

All commands use pinned Bun 1.3.14 and explicit package directories.

- After the independent-pipe correction, the final eight-file native reducer/owner/provider/store/Plan/foreground-Bash gate passed 31 tests and 378 assertions. The earlier seven-file gate had passed 28 tests and 332 assertions before final additive contract/managed-child assertions. Real checks include held active providers, no fabricated durable user messages, permission denial before spawn, both sandboxed pipes, accepted Stop/rearm, captured paused Goal denial, post-one-MiB events, real sustained-overload PID termination, trailing ordinary Shell preview, cancellation, deletion and existing Shell wait/cancel modes.
- The final Plan/managed-child HTTP file passed two tests and 28 assertions. Approval held live events without provider work; an actual managed Task child could not create a Monitor process or receipt.
- Existing foreground sandbox Bash passed one test and 25 assertions. The specific-before-broad output union correction preserves background process IDs and omitted foreground behavior: [BUG158](testing/runtime/process-output-union-projection.md).
- Core and Apexo typechecks passed on the private sources; final post-format results are recorded in the handoff.
- Native CLI acceptance passed ten checks / 57 provider calls: idle, active, model wait/cancel, accepted Stop, real-input rearm, deletion/reused Session, timeout, overload and restart/passive reads. Every recorded process PID was absent after cleanup. The initial private rebuilt packaged Desktop acceptance passed the same ten checks / 56 provider calls, and every recorded PID was absent after cleanup. The small request-count difference is from real-time overload batching, not an asserted count equivalence. The final additional contract/owner subset passed six tests / 66 assertions; final Core and Apexo typechecks passed after formatting.

After BUG168, both native CLI and freshly rebuilt private packaged Desktop passed ten checks / 57 provider calls, including actual split-byte stdout around stderr through model-facing updates. Both Core/Apexo typechecks passed; all twenty recorded process PIDs were absent. The earlier readiness timeout remains an unresolved verification observation, not a fixed product defect.

Fixture-only corrections are [BUG157](testing/test-fixtures/monitor-provider-projection.md), [BUG159](testing/test-fixtures/monitor-plan-summary-projection.md) and the shared cancellation-readiness recurrence in [BUG099](testing/test-fixtures/task-background-provider-classifier.md). The latter delayed the model's cancel response until the command-owned PID was demonstrably alive, preserving cancellation and cleanup assertions. The corrected shared CLI/Desktop gates both passed ten checks / 57 calls. These fixture failures are not shipped runtime defects.

Commands from `packages/apexo`: `bun test test/v2/process-monitor.test.ts test/v2/monitor-execution.test.ts test/v2/monitor-runner.test.ts test/v2/process-execution.test.ts test/v2/process-runner.test.ts test/v2/process-store.test.ts test/e2e/v2-plan-monitor.e2e.test.ts`; `bun test test/session/command-sandbox-bash.test.ts`; `bun script/grok-native-monitor.mjs cli`; `bun script/grok-native-monitor.mjs desktop`. Typechecks run separately with `bun typecheck` in Core and Apexo.

## Remaining presentation work

Reuse the existing Tasks Process rows and controls for Monitor kind, persistent/deadline and suppression/overload labels. A new panel or child-Session disguise is not planned. App/Desktop en/zh/zht and terminal presentation, actual localized window checks and shared complete gates remain follow-up integration work; the earlier Shell UI evidence does not establish Monitor-specific presentation.
