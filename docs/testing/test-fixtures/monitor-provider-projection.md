# BUG-20261015-157: Async tool fixtures inspected the wrong provider projection

- Status: three independent fixture corrections verified; recurring constraint promoted.
- Scope: native Monitor provider fixtures, an independent installed Scheduler probe and native headless signal output. Three independently introduced uses of historical tool arguments as evidence of current input or produced output; no production defect is inferred.
- Observed: the Stop/rearm test rejected a correctly delivered future event because it searched the whole provider body for a suppressed marker. That marker necessarily remained in the original Monitor command's tool arguments. The narrower assertion then failed typechecking because the fixture exposes wire messages as unknown. Separately, the CLI received its expected third provider request but timed out classifying it: actual XAI Responses content was `[{"type":"input_text","text":"<system-update>..."}]`, while the helper assumed a string.
- Expected: assert delivered SystemContext updates separately from historical tool arguments, and normalize supported provider content representations at the fixture boundary.
- Fix: decode the unknown Chat Completions messages before selecting user-role system updates; test provider counts around Stop/public resume/real user promotion. The CLI classifier accepts its observed text-block array as well as string content and inspects the latest update only.
- Verification: the corrected real provider Stop/rearm case passed; the full scoped union passed 28 tests and 332 assertions. Apexo package typechecking passed after explicit wire decoding. The CLI before-state retained the actual content-array response and three provider calls; the corrected CLI passed ten checks / 57 provider calls and reaped its backend. All ten recorded process PIDs were absent after cleanup. No production provider behavior was changed for these fixture assumptions.

Commands from `packages/apexo`: `bun test test/v2/monitor-runner.test.ts --test-name-pattern 'Monitor rearm'`; `bun script/grok-native-monitor.mjs cli`; `bun typecheck`.

## Independent Scheduler probe episode

The installed Scheduler held-fire probe selected the child marker by searching the complete message history. The scheduler_create tool arguments already contained that marker, so the fixture blocked the parent follow-up before its create prompt returned. The request timed out; preserved wire inputs show the parent current user was still `MONITOR_PARENT controlled tool request`, while the actual child current user was wrapped `SCHEDULER_FIRE_MARKER` or the scheduled system reminder plus that marker. This is the same historical-arguments-versus-current-input root cause as the original Monitor assertion, independently introduced in the new Scheduler probe.

The corrected fixture classifies the latest actual user payload. The real isolated Grok 1.0.52 delete-held scenario then completed with 16 provider requests: schedule deletion succeeded while the child response remained open; releasing the child produced one further model turn, and final scheduler_list was empty. The Stop scenario completed with 15 requests and observed no model turn in the bounded 1.8-second window after releasing the child. These are installed comparison observations, not Apexo implementation tests or unbounded guarantees. Both runtimes were reaped. The failed probe's isolated saved profile was removed after verifying its owned runtime exited; request/notification evidence was retained separately.

The prior backend-readiness timeout and valid split-pipe batch assertion are not counted as this second episode. At that checkpoint there were only two occurrences and no rule was promoted.

## Independent headless signal-output episode

The native headless CLI signal matrix observed SIGINT exit 130, an interrupted canonical input receipt, one provider request and a reaped command PID. Its final assertion nevertheless searched all NDJSON stdout for `UNEXPECTED_SIGNAL_CONTINUATION`. That marker occurred in the original command argument, correctly retained inside the tool receipt; it was not produced by continued execution.

The corrected fixture checks assistant text and completed tool output separately from raw tool input. Private source local acceptance passed fifteen checks / twenty provider requests, and pure-native attachment passed seventeen checks / twenty-one requests, including both signal cases. No signal or lifecycle repair is claimed from this fixture correction. Root shared/compiled adapter acceptance remains pending.

This is the third independently verified whole-payload versus authoritative-field mistake. Follow [RULE-20261015-016](../../rules/fixture-evidence-projection.md). The separate string-versus-content-array classifier correction above is not an additional occurrence of this root cause.
