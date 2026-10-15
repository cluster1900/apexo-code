# BUG-20261015-273: Existing side-question HTTP regression timed out during text validation

- Status: unresolved timeout observation; no product cause or repair established.
- Scope: the existing native side-question HTTP regression in a private combined text-conversion/headless test run.

The combined four-file run passed 21 tests, including the new text converter/native service cases and existing headless runner cases. `answers from a native snapshot and cancels separately from the main Session` then exceeded its existing 30-second test deadline (reported 32,984.82 ms), followed by an unnamed beforeEach/afterEach hook exceeding 5 seconds. The run reported 21 pass / 2 fail / 165 assertions and exited 1 after cleanup. It did not record the exact blocking phase.

A new direct native service test independently passed text snapshot delivery, unchanged main transcript and invalid-text rejection before side-question row creation. That result does not establish why the older HTTP test timed out. Other type/runtime work was active on the host, but timing overlap does not prove causality.

The follow-up diagnostic preserves the same test and deadlines and adds private phase markers only. No timeout increase, assertion weakening, product change or broad repeated aggregate run is claimed as a fix. Final diagnostic results are appended when available.

The single isolated unchanged test, with temporary phase logging only, passed 1 test / 13 assertions in 4.77 seconds. It reached Session creation, main completion, completed side answer, held-provider arrival, joined cancellation and body completion. The instrumentation was then restored byte-for-byte and is not part of the product patch. This establishes scoped functionality; it does not locate the earlier blocking phase or close the original timeout observation.

The integrated shared four-file command, using `bun test --timeout 30000` and the uninstrumented test, passed all 22 tests / 178 assertions in 6.86 seconds. The original explicit HTTP deadline was unchanged. See [the reproducible command](../../native-headless-cli.md#shared-integration-checkpoint). This confirms the shared functionality but does not establish a cause or timing repair for the private failure.
