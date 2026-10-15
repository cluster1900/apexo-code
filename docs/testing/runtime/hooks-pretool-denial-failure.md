# BUG-20261014-071: Pre-tool hook denial was reported as tool execution failure

- **Scope:** Host `PostToolUseFailure` observer and parity fixture.
- **Observed:** The earlier CLI/Desktop eight-scenario fixture used a denied `PreToolUse` read to satisfy its failure-event assertion. Static comparison showed that the reference distinguishes pre-dispatch denial from actual dispatch failure.
- **Expected:** Denied tools do not emit `PostToolUseFailure`; failed executed tools do.
- **Reproduction:** Configure both `PreToolUse` exit-two denial and a failure observer, then request a matching read.
- **Root cause:** The observer treated every projected tool error as an execution failure, including hook denial.
- **Fix:** Share denied call identities across loaded hook sources and exclude their terminal error events. Update the fixture to execute an allowed missing-file read and assert the denied call produces no failure event.
- **Verification:** Updated CLI eight-scenario fixture passed, including a real allowed missing-file dispatch failure and absence of a failure event for the denied call. Focused host/Stop suite passed 12 tests/45 assertions. Updated production Desktop lifecycle fixture also passed all eight scenarios.
- **Occurrences:** One previously observed fixture flow; the contract distinction was found through static audit.

## Permission-boundary extension

The subsequent real V1 CLI fixture configured both PermissionDenied and PostToolUseFailure and explicitly checked that rejection/policy denial emitted only the former. It failed: both pre-dispatch permission outcomes also reached the generic tool-error observer. This is the same classification defect beyond the earlier hook-denial case, not a distinct bug record. The correction tags the real tool part when its permission request fails and filters that durable marker at the failure observer. The strengthened V1 CLI six-scenario fixture passed, including explicit absence of PostToolUseFailure for user rejection and policy denial. The focused host hooks, Stop, permission, and session-tool suite passed 99 tests / 187 assertions, and the Apexo package typecheck passed. The isolated installed-reference comparison passed all 13 scenarios with the same negative assertion. The refreshed production Desktop artifact passed all six scenarios in both V1 and native V2, including the stronger negative failure-event assertions. This supersedes the earlier Desktop result that predated the correction.
