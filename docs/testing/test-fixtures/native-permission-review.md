# BUG-20261113-002: Permission review acceptance fixture corrections

- **Scope:** New F02 native runner, Git scope, PTY, browser and Desktop acceptance fixtures.
- **Observed:** Early development runs exposed several independent fixture failures: missing nested provider braces prevented parsing; a pure V2 configuration was rejected by the mixed host's V1 config route; Git commits inherited global signing and failed in GPG; and a terminal asserted provider activity before scope capture reached the provider.
- **Expected:** Fixtures parse before startup, use the host's supported config dialect, never depend on personal signing keys, and observe the held reviewer before testing a manual reply.
- **Reproduction:** Run the new `permission-review` scripts or Git scope tests before their corresponding fixture corrections. These failures occurred before the intended assertions or against incorrect fixture expectations; they were not evidence of successful acceptance.
- **Root causes and fixes:**
  - Correct the nested provider object, then format and syntax-build the actual script before running it.
  - Use a pure V2 document for the native host and one consistent V1 document for the compatibility routes used by mixed/Desktop UI boot. This is a pure V2 document rejected by a compatibility route, distinct from silently mixing dialect fields described in BUG-20261014-252.
  - Disable signing only in fixture Git commands with `-c commit.gpgsign=false`; supply isolated fixture identity.
  - Poll for the actual held provider request after the pending UI becomes visible; pending registration deliberately precedes scope capture and model I/O.
  - Send two correctly indexed SSE tool calls for the sibling test. The generic single-tool reply builder uses index zero for each call and does not represent a parallel batch.
  - Rejection intentionally interrupts the native drain. Inspect its exit and pending/event evidence rather than expecting a successful `wait` result.
- **Verification:** Corrected pure/mixed/Desktop UI scripts passed 6/7/7 checks; mini/fullscreen passed 5 each. The sibling/provider-failure command passed 2 tests/6 assertions. Corrected Git scope tests passed 3 tests/39 assertions. The retained F02 implementation report records the final aggregate and exact commands.
- **Recurrence:** No new historical recurrence count or rule promotion is inferred from these different fixture causes.

## Complete-gate route coverage correction

The first complete unit gate passed 17 of 18 batches and failed the Location-lifetime regression because the new GET/PUT mode routes were absent from the HTTP exerciser inventory (`missing=2`). Register both protected scenarios and retain the zero-missing assertion. A subsequent focused run performed alongside repository-wide typechecking timed out at 60 seconds; its timing cause is unconfirmed. The serial rerun passed 1 test/2 assertions in 11.81 seconds, with all three original prompt scenarios and zero missing routes. This rerun proves the inventory correction, not a fix for the separate concurrent timeout. The final complete gate is recorded in the implementation report.

The final mini rerun exposed a fixture readiness race: an old `PERMISSION_DONE` marker let the script type the next `/auto` while the second permission view was still closing. The fixture now observes backend idle state and the restored composer before typing. The corrected mini run passed all 5 checks; no production code change was made for this symptom.

## Final verification

The final browser, mixed-host and rebuilt Desktop runs passed 8, 10 and 8 checks respectively. Mini and fullscreen PTY runs each passed 5 checks. The focused native regression command passed 41 tests / 244 assertions; the complete unit gate passed all 18 batches. These results supersede the earlier partial fixture totals above while preserving their original failures and causes. The [implementation report](../../development/f02-implementation.md) records the full gates and production benchmark.

## 2026-11-14 remediation verification

Two rebuilt Desktop runs reached an automation wait timeout: first waiting for the review element while other verification ran, then waiting for the controlled provider's fallback reason in a serial run. Saved final screenshots showed live manual fallback: the first timed out in Core as designed; the second ultimately displayed the exact fixture reason. No production root cause was established for the automation timing. A passing rerun alone is not claimed as a runtime fix.

The acceptance script now removes redundant selector waits and captures its screenshot after releasing the held stream, reducing work inside the bounded 20-second reviewer window. It still verifies reviewing text, all manual actions enabled, reload with exactly one backend evaluation, the exact live fallback reason and manual settlement. The next own-sidecar Desktop run passed all 8 checks. The production reviewer timeout was not increased, and no App/Desktop business code was changed to satisfy the fixture.
