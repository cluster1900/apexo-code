# BUG-20261015-271: Shared Memory validation exceeded multiple existing deadlines

- **Scope:** The nine-file shared native Memory Dream/capture/store integration gate after Stage 2 integration.
- **Status:** Investigating; the invocation mismatch is identified, but no product timing repair is established.
- **Observed:** The first shared run reported 47 passes, 21 failures, one additional error and 411 assertions across 68 tests in 255.02 seconds. Most failures reached Bun's default five-second case deadline. The controller shutdown scenario separately reached its internal ten-second deadline, and the mixed HTTP scenario exceeded its explicit twenty-second case deadline. Interrupted child cleanup also reported an error.
- **Expected:** Tests run with the package/CI command's existing thirty-second outer budget, retain their explicit tighter phase deadlines, and join fixture work before returning.
- **Reproduction:** From `packages/apexo`, run the nine Memory files listed in `docs/native-memory-dream.md`. The failing invocation omitted `--timeout 30000`; workspace typechecks and other private validation were also active.
- **Root cause:** The command used Bun's default case budget instead of the established package/CI budget. That proves an invocation mismatch, not the cause of the internal ten-second or explicit twenty-second failures. Concurrent host activity is context, not a proven causal explanation. No failing assertion was weakened and no production timeout was changed.
- **Correction and investigation:** Reap the first run and the typechecks, then run the same files serially with the existing CI `--timeout 30000` option. Preserve the original internal bounds and record any remaining phase failure. The serial CI-configured rerun passed all 68 tests / 436 assertions in 22.76 seconds. No production code or internal phase deadline changed between runs. The invocation correction is verified; the original internal deadline causes remain unresolved.
- **Related evidence:** [BUG235](native-memory-lifecycle-timeouts.md) concerns earlier different phase deadlines. No common root cause is established; neither observation is promoted to a recurring product constraint.
- **Occurrences:** One shared validation episode; multiple failed cases do not count as independent occurrences.

## Completed-child Task command-budget observation

An independent private Task-message validation invocation omitted the package's
`--timeout 30000` option. Eight cases passed and the three new completed-child
wake cases reached Bun's default five-second deadline. No internal phase
deadline or product behavior was changed. The same expanded two-file gate with
the established CI command budget passes 12 tests / 174 assertions in 5.53 seconds
overall. The command mismatch is verified; a passing rerun does not establish
why those individual earlier cases were slower. This observation does not
increase any count of proven product timing failures.

## Automatic legacy B1 regression observation

A later coherent private five-file Memory run used the correct `--timeout 30000` budget. All 40 legacy cases passed, including the new publication fence. The existing V2 concurrent exact-flush case then exceeded its ten-second settlement poll; manual Dream reported `stale_lease`, and automatic/shadow Dream cases exceeded phase or case deadlines. Other validation processes were active and the host showed severe memory pressure, but no common root cause was isolated. The owned broad test process was intentionally terminated and joined to stop further resource contention; this is an incomplete red regression run, not a passing suite. No case budget, lease duration, assertion or production behavior was changed to hide the observations. Focused serial V2 verification is recorded separately. These are additional symptoms in the validation investigation, not independent proven recurrences.

The subsequent serial two-file legacy plus V2 lifecycle run passed 56 tests / 277 assertions in 37.96 seconds, including the previously timed-out V2 concurrent exact-flush case. No phase bound or product behavior was changed for that rerun. This verifies those scenarios; the earlier broad Dream lease/deadline symptoms remain unresolved and the interrupted five-file run is still incomplete.
