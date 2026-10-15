# Ordinary V2 Session completion timeout in the full unit suite

- **ID:** BUG-20261015-102
- **Status:** Investigating; no root cause or repair established.
- **Scope:** `packages/apexo/test/e2e/v2-session.e2e.test.ts`, ordinary native Session execution through the actual HTTP application.
- **Observed episodes:** One full-suite timeout. A later focused pass is not a repair or another occurrence.

## Observation and expectation

The full unit checkpoint after managed-child admission and sandbox presentation integration failed the case “admits once, rejects conflicting retries, then promotes and executes through the V2 runner”. Its first assistant-completion poll exhausted its 15-second budget with `V2 runner did not complete`; the test elapsed approximately 16,872 ms. The expected behavior is that the admitted prompt is promoted once and the ordinary Session produces a completed assistant response. The failure did not capture provider-call count, the last transcript, or the underlying drain Cause, so it cannot identify which execution phase stopped progressing.

The aggregate completed with 4,106 passes, 19 skips, one todo and two failures across 4,128 tests in 376 files, with 13,989 assertions and 53 snapshots. The other failure was the independently recorded stale managed-child message expectation, BUG-20261015-101. This checkpoint predates the subsequent duplicate-toast and compatibility plan changes.

## Reproduction and bounded diagnosis

Run the repository gate with pinned Bun 1.3.14: `GITHUB_ACTIONS=false bun turbo test --concurrency=2`. The observed run used a coherent isolated source, package/export and dependency snapshot with private SDK outputs. It had no cached Turbo tasks. The existing MCP diagnostic instrumentation captured adapter failures before safe-error translation, but did not capture a Cause attributable to this Session timeout.

A separate diagnostic copy of the unchanged Session scenario added failure-only observations: provider-call count, request path/message count, projected messages, and a bounded passive bodyless Session wait request. It retained the original completion deadline and assertions. Running that one case from the Apexo package directory passed once: **1 test, 27 assertions**, 4,277 ms for the test and 6.91 seconds for the process. It completed with exactly two provider requests. The failure-only observations therefore did not execute.

## Root cause and current action

**Unknown.** No runtime fix or timeout increase was made. Source review found the ordinary prompt still awaits advisory wake admission, the coordinator retains its existing owned wake scheduling, and cold Location construction still awaits both plugin readiness barriers. These observations do not establish why the aggregate timed out. Host contention, a lost wake, model readiness, managed-child classification and the separate MCP investigation are not established causes.

Preserve this record as unresolved. At the next independently required aggregate checkpoint, capture the failing Session's provider count, projected state and drain outcome before cleanup. Do not repeat broad gates merely to obtain a green rerun, weaken the completion assertion, or close this record because the focused case passes.

Later shared Plan/media UI checkpoint: the full repository unit command completed all six Turbo tasks successfully, including the Apexo suite’s 4,155 passes, 19 skips, one todo and zero failures across 383 files. This adds a successful aggregate observation, not a causal repair or a new failure occurrence. The earlier unexplained symptom remains an investigation. This aggregate precedes the Shell/media-options integration.
