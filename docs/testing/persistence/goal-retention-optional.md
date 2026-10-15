# BUG-20261014-027: Optional report retention rejected its absent default

- Status: Fixed and verified. One observed implementation failure; no recurring constraint.
- Scope: Internal Goal report-policy backfill.
- Observed: The first retention test run failed all 7 cleanup tests with `SchemaError(Expected number, got undefined)`. Expected: omitting `goal.report_retention_days` retains historical reports indefinitely and does not prevent execution.
- Reproduction: Backfill a Goal with no retention setting.
- Root cause: Decoding an optional struct field's underlying schema as a standalone value does not accept an absent field represented by `undefined`.
- Fix: Validate the bounded integer only when the option is present; retain the absent internal property otherwise.
- Verification: `bun test test/session/goal-cleanup.test.ts` passed 7 tests and 42 assertions after the correction, covering indefinite default, zero-day expiry, future deadline, current-plan protection and terminal ownership. `bun script/grok-goal-retention.mjs cli` passed both checks against the real CLI backend after three independent verification rounds: the superseded first report was deleted, while the plan, current panel and previous gatekeeper remained downloadable.
- Final verification: The full four-file Goal/report suite passed 75 tests and 500 assertions, including explicit cleanup after the durable deadline passes. `grok-goal-retention.mjs desktop` passed both checks again against the refreshed production backend containing the final cross-job barrier correction.
- Policy: This is explicit Apexo retention configuration, not an asserted Grok default. No time/count report-expiry policy was found in the pinned official Goal tracker; default deletion was deliberately not introduced.
