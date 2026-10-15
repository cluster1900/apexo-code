# BUG-20261015-060: Native Task E2E provider object was malformed

- **Type:** Test fixture; one authoring episode.
- **Scope:** New native Task provider E2E fixture.
- **Observed:** Bun reported `Expected "}" but found ")"` at the nested provider configuration. No application assertions ran.
- **Expected:** Validate and format the real fixture before executing it.
- **Cause:** The nested providers object lacked one closing brace. A formatter invocation against an external draft path skipped the file, so its successful command exit did not establish syntax validation. This is distinct from BUG-20261015-055's extra parenthesis in another fixture.
- **Fix:** Close the object and format using the repository configuration and repository-equivalent stdin filepath, inspecting the parsed output. No model behavior or assertion was weakened.
- **Verification:** The corrected fixture reached six real native provider calls and exposed the separate descending-message-order assertion recorded in BUG-20261014-143. After that correction, the initial foreground/follow-up/output checkpoint passed with 16 assertions; the combined three-file checkpoint passed 44 assertions. Later admission/cancellation checks remain separately tracked.

The expanded admission fixture also initially expected HTTP 409 for the existing
Workflow invalid-request channel. Inspection and the actual response established
its declared HTTP 400 plus the managed-child message. The assertion now checks
both, preserving rejection and zero-state/provider expectations. This status
expectation was fixture authoring, not a product remapping. The final mixed HTTP
case passed 1 test/24 assertions; the combined Task gate passed 6/90.

The mixed real HTTP admission case later exceeded Bun's implicit five-second
whole-test budget during a combined run, after only early setup assertions.
Running that case alone completed its unchanged assertions in 1.66 seconds, which
does not prove a load cause or a product fix. Its explicit whole-test deadline is
now thirty seconds, matching its existing twenty-second provider-operation
polls. Rejection, inbox/transcript, zero-provider and process-side-effect
assertions remain unchanged. This is a harness budget adjustment.

The deadline's first call used `instance(name, body, {}, 30000)`. The fixture
helper treats the empty third object as Bun options, so the fourth argument did
not set the deadline. Passing 30000 as the third argument establishes the actual
whole-test bound. The expanded real permission fixture also corrected its
expected ReadTool error to the observed safe `Unable to read` envelope; it still
asserts private-file rejection, public exception success and ten provider calls.
The final composed runtime suite passed 10 tests/162 assertions.

## Canonical delimiter record

The provider-object missing-brace observation above is consolidated into [BUG-20261014-082](side-question-native-provider-config.md), which records four independent side-question, LSP, Task, and Memory episodes and links [RULE-20261015-013](../../rules/fixture-provider-config-syntax.md). Count the Task delimiter once in that canonical record. This mapping does not reclassify or delete this record's separate HTTP-status, test-deadline, helper-argument, or ReadTool-envelope observations.
