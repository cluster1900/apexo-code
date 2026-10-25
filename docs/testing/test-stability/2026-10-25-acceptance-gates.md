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

See [the regression report](../desktop-cli/2026-10-25-regression.md) for final full-gate and CI outcomes. None of these observations is promoted to a recurring constraint.
