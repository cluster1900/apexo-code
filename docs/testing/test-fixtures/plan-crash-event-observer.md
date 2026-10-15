# BUG-20261015-120: Plan crash fixture observed a separate event service

- **Scope:** The new isolated native Plan crash acceptance fixture; no production failure.
- **Observed:** The first run timed out waiting for its durable-decision marker while the real server completed the approval and made its normal next provider request.
- **Expected:** The fixture parks only after the actual server has durably committed the selected decision or original tool result, then its parent kills and reaps that exact process.
- **Cause:** The preload constructed an independent AppRuntime and registered an Effect EventV2 listener there. That service instance did not observe the server's EventV2 publications. Diagnostic tracing showed the real GlobalBus notifications, while the separate service listener saw none.
- **Fix:** Observe the actual process notification bridge, after EventV2's durable transaction and projector commit. A fixture-only bounded synchronous checkpoint writes its marker and waits for the parent to kill the owned process. No production failpoint, fabricated receipt, or alternate event implementation is introduced.
- **Verification:** `bun run script/grok-plan-crash.mjs cli` in `packages/apexo` passed ten checks and six local-provider calls across postdecision and post-tool-success crashes. Restart, pending/history reads and exact answer retries started no provider work. A genuine new input reconciled the original tool and Step.Ended exactly once, verified against SQLite receipts/events. Every fixture process was reaped.
- **Occurrences:** One fixture-authoring episode. The diagnostic rerun is not an independent recurrence. The subsequent encoded/runtime payload decoder error is recorded under BUG079.

Shared integration verification: the combined native Plan and background Task approval suite passed 14 tests / 153 assertions; all 21 repository typecheck tasks passed. CLI and rebuilt Desktop recovery each passed 13 checks / 10 local-provider calls; the actual crash checkpoints passed 10 checks / six calls. This does not replace the separate pending UI acceptance.
