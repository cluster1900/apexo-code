# BUG-20261014-277: Whole-suite retry-status test returned stop without retained error evidence

- **Scope:** Compatibility SessionProcessor retry-status integration test.
- **Status:** Unresolved; no causal fix has been established.
- **Observed:** The full unit checkpoint reported 3,934 passing tests, 19 skips,
  one todo and one failure. `session.processor effect tests publish retry status
  updates` returned `stop` instead of `continue` after about 78 ms. The original
  failure output did not retain the assistant error, provider requests or status
  events, so it cannot identify which halt path ran.
- **Expected:** A real local provider returns HTTP 503, then a successful empty
  completion. Processing retries once, emits retry attempt 1, makes two provider
  requests, and returns `continue`.
- **Reproduction:** Run the repository unit gate, or the scoped command
  `bun test test/session/processor-effect.test.ts -t 'publish retry status updates'`
  from `packages/apexo`. The original whole-suite failure has not yet reproduced
  in the scoped checks.
- **Root cause:** Unknown. The original duration is shorter than the normal retry
  delay, but that observation alone does not establish an error classification,
  interrupted operation, fixture contamination or production defect. The separate
  unexplained HTTP 501 observation in BUG-20261014-207 is not merged without
  evidence of a shared cause.
- **Diagnostic change:** Preserve the original assertions. On an unexpected stop,
  print `handle.message.error`, the real provider call count and inputs, and every
  matching Session status event. No retry policy, fixture response or expected
  result has been weakened.
- **Verification:** The isolated case passed one test and three assertions, and
  the complete processor file passed 17 tests and 80 assertions. These passing
  reruns do not resolve the original symptom. A further scoped run with
  `--rerun-each 20` passed 20 tests and 60 assertions, with no failure evidence
  emitted. The final complete unit rerun with diagnostics also passed: 3939 passes,
  19 skips, one todo, zero failures and all six Turbo tasks successful. The
  failure diagnostic did not fire. The original symptom remains unresolved;
  retain the diagnostic for a future independent reproduction.
