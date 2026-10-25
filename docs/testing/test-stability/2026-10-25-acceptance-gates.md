# Acceptance gate follow-up — 2026-10-25

Scope: the Desktop/CLI fixes on `fix-acceptance-issues`, based on `a99a9b3812b5cba19dfee08f1bdd05d0aac16ac2`. Environment: macOS 26.6.2 arm64, Bun 1.3.14. The full gate ran with the HttpApi exerciser and isolated Electron acceptance instances. This is one observed failed full-suite run, not evidence of recurring identical root causes.

## BUG-20261025-008 — OAuth expiry fixture assumes readiness precedes expiration

- Scope: `test/v2/mcp-oauth-flow.test.ts`, `denial, issuer mismatch and expiration never commit tokens`.
- Observed: batch 8 failed after 365.75 ms with `McpOAuth.Failure` code `load`. The original combined case did not retain which subcase failed, so its exact rejected operation remains unconfirmed.
- Expected: denial, invalid issuer and expiration must leave credentials empty and perform no token grant, including expiration before authorization readiness.
- Reproduction: run the named test with an expiry timeout of 1 ms. Real discovery can be cancelled before `manager.start` returns a URL; the public flow is `failed` with error `expired`, grants are zero and stored credentials are empty. The previous fixture unconditionally awaited successful readiness even though its 100 ms timer also owned discovery.
- Root cause of the independently reproduced fixture defect: the readiness assumption excluded a valid earlier expiration. This explains a possible full-load failure path; the collapsed original error alone does not prove that was its exact cause.
- Fix: exercise both 100 ms and 1 ms expiry. Accept a typed readiness rejection only in expiry cases, then require the authoritative terminal error to be `expired`. Keep the empty-store and zero-grant assertions. Production authentication behavior is unchanged.
- Verification: `bun test test/v2/mcp-oauth-flow.test.ts --test-name-pattern 'denial, issuer mismatch' --rerun-each 10` from `packages/apexo`; PASS: ten runs, zero failures, 110 assertions.

## BUG-20261025-009 — Running-task metadata readiness timed out once

- Status: unresolved root cause; not claimed fixed. GitHub: [#156](https://github.com/cluster1900/apexo-code/issues/156).
- Scope: `test/session/prompt.test.ts`, `running task tool preserves metadata after tool-call transition`.
- Observed: batch 10 timed out waiting for running task metadata; case duration 7506.40 ms.
- Expected: the running task retains its child Session ID, title and model metadata across the tool-call transition.
- Reproduction attempt: run `GITHUB_ACTIONS=false bun turbo test --concurrency=2` from the root alongside the required HttpApi gate. This produced the failure once. The focused command `bun test test/session/prompt.test.ts --test-name-pattern 'running task tool preserves metadata'` passed unchanged in 4254.53 ms with three assertions. Reproduction is intermittent, not deterministic.
- Root cause: unknown. Timing or shared test load is a hypothesis; no captured terminal state establishes it.
- Fix: none. No timeout was increased and no assertion was removed. Preserve the failed result even if a later complete gate passes.

## BUG-20261025-010 — Native Plan shell completion timed out once

- Status: unresolved root cause; not claimed fixed. GitHub: [#157](https://github.com/cluster1900/apexo-code/issues/157).
- Scope: `test/e2e/v2-plan-shell-completion.e2e.test.ts`, `background Shell completion waits for native Plan approval without a new user input`.
- Observed: batch 11 timed out waiting for `PLAN_SHELL_DELIVERED`; case duration 21597.06 ms.
- Expected: after the background shell finishes and Plan approval is accepted, the parent consumes its completion without a new user input.
- Reproduction attempt: the same full-gate command above produced the failure once. A focused rerun passed in 612.02 ms; `bun test test/e2e/v2-plan-shell-completion.e2e.test.ts --rerun-each 10` then passed all ten runs with 160 assertions. The exact interleaving remains unconfirmed.
- Root cause: unknown. A passing rerun is not proof of a fix.
- Fix: none. Preserve the failure and the successful controls separately.

## BUG-20261025-011 — Large legacy message limit returned HTTP 400 once

- Status: unresolved root cause; not claimed fixed. GitHub: [#158](https://github.com/cluster1900/apexo-code/issues/158).
- Scope: `test/server/session-messages.test.ts`, `does not truncate large legacy limit requests`.
- Observed: a subsequent unit-only full gate failed in batch 16 after 8m25.211s. The fixture created 520 messages, then `GET /session/<sessionID>/message?limit=510` returned 400 instead of 200; case duration was 1265.91 ms. The original assertion did not retain the response body.
- Expected: HTTP 200 and exactly 510 messages.
- Reproduction attempt: run the root full unit gate. It failed once; a focused first run passed. Replaying the exact 29-file batch in a fresh process passed 185 tests and 767 assertions in 48.23 seconds.
- Root cause: unknown. Added a diagnostic that prints the error body before the unchanged status assertion. No endpoint behavior, limit or assertion was relaxed.
- An attempted in-process `--rerun-each 5` control passed first, then produced four `ManagedRuntime disposed` fixture-reuse failures. Those are not HTTP 400 recurrences and are not counted as endpoint evidence.
- In this second full gate, the OAuth, task metadata and native Plan batches all passed. That is a successful control, not proof that #156 or #157 is fixed.

## BUG-20261025-012 — Joined-resume fixture conflates automatic admission and completion

- Status: fixture correction verified with delayed-response controls; full-gate and CI results are recorded on the follow-up PR linked from [#159](https://github.com/cluster1900/apexo-code/issues/159). This is distinct from the already-fixed epoch invalidation in [BUG-20261015-341](../runtime/native-memory-joined-resume.md).
- Scope: `test/v2/memory-legacy-native.test.ts`, `joining an active explicit resume preserves the drain's automatic idle epoch`.
- Observed: two Linux CI attempts on `6108a2b` failed after 7682.79 ms and 6308.37 ms with `joined resume lost the automatic epoch`; each batch otherwise passed 296 tests. The same revision passed batch 5 locally, plus six focused controls.
- Reproduction: root `GITHUB_ACTIONS=false APEXO_TEST_SHARD=5/6 bun turbo test --filter=apexo --concurrency=2 --log-order=stream --log-prefix=none`. The fixture holds a provider response, forks explicit resume, sleeps 50 ms, releases the response and polls for a finished automatic receipt for five seconds.
- Expected: explicit resume joins the active drain, preserves its epoch, and automatic idle Memory work completes with two total provider calls.
- Investigation: adding a controlled 100 ms delay before resume locally invalidated the fixture's 50 ms readiness assumption and produced a failed Memory receipt. This demonstrates a scheduling weakness, but is not the same error as either Linux timeout and does not establish their cause. The artificial delay was removed.
- Subsequent evidence: all 17 PR checks and the complete local unit gate passed at `fefd250`; PR #155 was merged as `c5e4227`. Its post-merge Linux run reproduced the timeout at 6550.25 ms. The new diagnostic showed a **running automatic legacy flush receipt and exactly two provider requests**: the ordinary turn and Memory flush. Thus admission and epoch preservation succeeded in this observed failure; the completion wait failed. Why that particular worker exceeded the short deadline is not established by the log.
- Root cause of the fixture failure: the five-second poll required the entire automatic provider round trip and durable publication to finish, while its error asserted that automatic admission had been lost. The fixture already uses a separate 20-second `settled` helper for this work elsewhere in the file.
- Deterministic reproduction: parameterize the real local HTTP fixture with immediate and six-second Memory responses. With the original poll, the six-second case fails in 5349.46 ms, reporting the same running receipt and two provider calls. No global clock or production service is mocked.
- Fix: retain a five-second deadline for admission of the automatic legacy flush, then wait for that exact receipt with the existing bounded `settled` helper. Preserve completed-result and exactly-two-calls assertions and the outer 30-second test limit. Keep both immediate and six-second response cases and the failure diagnostic. Production timing and execution are unchanged.
- Verification: from Apexo, `bun test test/v2/memory-legacy-native.test.ts --test-name-pattern 'joining an active explicit resume preserves' --rerun-each 3` passes six cases and 18 assertions in 27.10 seconds. The slow cases each complete in approximately 7.2 seconds. The earlier two Linux failures lacked receipt diagnostics and are not retrospectively assigned a proven cause.

## BUG-20261025-013 — Local batch reaches its watchdog without a test failure report

- Status: unresolved; GitHub [#160](https://github.com/cluster1900/apexo-code/issues/160).
- Scope: final-head macOS full gate at `6108a2b`, batch 10/17, 29 files.
- Observed: 16 batches passed; batch 10 was killed by the existing 600-second watchdog with exit 137. A process sample showed its main thread waiting in `__wait4_nocancel`; unsymbolized Bun frames do not identify the caller or child. The failure-only log did not identify the active test.
- Reproduction: root `GITHUB_ACTIONS=false bun turbo test --concurrency=2`; select the batch alone from Apexo with `APEXO_TEST_SHARD=10/17 bun run script/run-tests.ts`.
- Expected: each test and fixture terminates within its bounded deadline, allowing the batch to report results.
- Verification attempt: unchanged exact batch with per-test output passed 283 tests, one existing skip and 1407 assertions in 85.03 seconds. No hang recurred, so no fix or common cause with #156 is claimed.
- Recurrence: the full local gate at `3b55b85` passed 16/17 batches, including Memory batch 5 in 67.37 seconds, but batch 10 again reached the watchdog (600.05 seconds, exit 137). Overall: 5/6 tasks in 13m28.506s. A separate replay of all 29 batch files stalled in the same `__wait4_nocancel` state with one exiting bash child and was manually stopped after capturing its process sample. That interrupted replay is not a pass. The exact blocking call and root cause remain unknown; no timeout or product behavior was changed for this symptom.

## BUG-20261025-014 — Nested PR Agent retries exhaust the job deadline

- Scope: `.github/workflows/pr-agent.yml`; GitHub [#161](https://github.com/cluster1900/apexo-code/issues/161).
- Observed: two successive PR #155 heads completed automatic review but were cancelled at the 20-minute deadline during suggestion generation. An earlier nominal 300-second model request consumed about 903 seconds before another handler retry; the latest suggestion call remained active from 13:31:24 until cancellation at 13:42:35 UTC.
- Reproduction: synchronize a substantial PR while the configured MiniMax provider is slow, with default client and handler retries and `ai_timeout=300`.
- Expected: timeout failures reach the existing fallback within a bounded budget; both automatic phases complete or report their actual failure.
- Cause: completion-client retries multiply the handler's same-model retry loop. The [upstream configuration](https://github.com/the-pr-agent/pr-agent/blob/main/pr_agent/settings/configuration.toml) and [handler](https://github.com/the-pr-agent/pr-agent/blob/main/pr_agent/algo/ai_handlers/litellm_ai_handler.py) expose both controls.
- Change: disable nested client retries and same-model timeout replay, retain the existing fallback and both automatic phases, allow 30 minutes for all phases, and propagate tool failures. Test checks and branch protection remain intact.
- Verification: source configuration checked against the upstream implementation. At `fefd250`, PR Agent completed both review and suggestion generation, including self-reflection, and published both reports; all 17 PR checks passed. The logs confirm the configured retry controls and error propagation. This successful run needed no timeout/fallback, so it verifies the real phases and configured bounds, not an injected timeout experiment. #161 was closed after verification.

## BUG-20261025-015 — Shell-loop coordination exceeds its local test deadline

- Status: unresolved; GitHub [#162](https://github.com/cluster1900/apexo-code/issues/162).
- Scope: `test/session/prompt.test.ts`, `loop waits while shell runs and starts after shell exits`.
- Observed: the full unit gate overlapping HttpApi at `fefd250` failed this case after 10308.84 ms against its 10000 ms limit. The remaining 16 batches passed. This was a named test timeout, not the watchdog hang in #160.
- Expected: a loop requested during shell execution waits, starts after the shell exits, and completes within the test deadline.
- Reproduction attempt: run the root full unit gate alongside the Apexo HttpApi gate. An unchanged focused control passed in 2192.96 ms with five assertions. A subsequent complete unit run without the concurrent HttpApi workload passed all 6 tasks, 17 batches and 501 files in 9m10.629s.
- Root cause: unknown; load is a hypothesis. No production behavior, test deadline or assertion was changed, and successful controls are not a claimed fix.

See [the regression report](../desktop-cli/2026-10-25-regression.md) and PR #155 for final full-gate and CI outcomes. None of these observations is promoted to a recurring constraint.
