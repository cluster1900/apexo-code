# BUG-20261015-265: AI SDK tool completion returned stop in the complete unit gate

- **Scope:** Compatibility SessionProcessor's real local-provider tool completion test.
- **Status:** Investigating; no causal repair has been established.
- **Observed:** The complete unit gate reported 4,313 passes, 19 skips, one todo and two failures. `session.processor effect tests complete AI SDK tool calls when native flag is off` returned `stop` instead of `continue` after about 136 ms. The original output did not retain the assistant error or actual request and tool state.
- **Expected:** One provider request produces the `lookup` call; the real tool completes with its expected result and processing returns `continue`.
- **Reproduction:** From `packages/apexo`, run `bun test test/session/processor-effect.test.ts -t 'complete AI SDK tool calls when native flag is off'`, or run the repository unit gate.
- **Root cause:** Unknown. The failure does not yet identify a provider, fixture, lifecycle, permission or execution defect.
- **Diagnostic change:** Preserve all existing assertions and print the assistant error, real provider call count/inputs and saved parts only when the result unexpectedly stops. No timeout, retry or expected result has been weakened.
- **Verification:** The shared `bun test test/event-manifest.test.ts test/session/processor-effect.test.ts` command passed 21 tests/104 assertions; the complete processor file passed unchanged behavior assertions and the diagnostic did not fire. The original cause remains unknown. A passing rerun alone must not be described as a fix.
- **Related evidence:** [BUG-20261014-277](../runtime/processor-retry-status-unexplained-stop.md) observed an earlier unexpected stop in a different retry-status scenario. There is no evidence of a common root cause; these observations do not establish a recurring constraint.
- **Occurrences:** One independent observation with unknown root cause.
