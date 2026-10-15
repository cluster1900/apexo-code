# BUG-20261014-203: Summary request admission omitted unknown-usage guard

- **Scope:** New terminal Goal summary claim and provider admission.
- **Status:** Verified; one source-audit occurrence.
- **Observed:** The initial implementation checked remaining numeric budget but did not
  reject `usageIncomplete`, which a late receipt failure can set after verified completion.
- **Expected:** Optional new model work must fail closed when prior Goal usage is unknown.
- **Reproduction:** Complete a Goal, claim its summary, then record missing usage for its
  verifier before subscribing to `SessionGoalUsage.trackTerminal`.
- **Root cause:** Terminal admission reused the numeric exhaustion check without the
  separate missing-usage condition used by active Goal execution.
- **Fix:** Settle a pre-existing unknown-usage claim as failed/usage without a child request;
  recheck unknown usage and numeric budget immediately before invoking the provider.
  Completion remains durable in either case.
- **Verification:** Focused tests assert zero source invocations when missing usage or
  budget exhaustion arrives between claim and request, and preserve completed status.
  From `packages/apexo`, `bun test test/session/goal.test.ts test/session/goal-cleanup.test.ts test/effect/runtime-flags.test.ts` passed 121 tests and 721 assertions. Core `bun typecheck` exited zero.
