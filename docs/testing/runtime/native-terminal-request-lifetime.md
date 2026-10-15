# BUG-20261015-155: Native facade erased terminal request cancellation

- **Scope:** Off-tree native terminal HTTP facade. One verified implementation episode.
- **Observed:** A real local HTTP request issued through a terminal SDK configured with its owner AbortSignal did not reject when that owner was aborted. The unchanged focused test timed out at 5 seconds; a diagnostic run reached request received and owner abort, then also timed out. The original output is retained as failed evidence, not relabeled a passing run.
- **Expected:** Calls without a separate per-call signal inherit the terminal client's cancellation. Closing the terminal must not leave its HTTP reads detached from the owner.
- **Cause:** Every facade call constructed `{ signal: undefined, throwOnError: true }` when no per-call signal was supplied. The generated SDK merges request options after client config, so the explicit undefined erased the configured AbortSignal.
- **Fix:** Omit the signal option unless a real per-call signal is supplied. This preserves client ownership while keeping explicit operation cancellation intact. The terminal facade also accepts an explicit owner and combines it with each per-call signal. Fullscreen supplies its SDK-provider owner; mini scopes its facade to the runtime and aborts it in finally. Protocol-probe timeouts remain separate. No generated SDK code changed.
- **Verification:** From packages/apexo, `bun test test/tui/native-session-transport.test.ts -t 'lifetime cancellation'` passed the same real HTTP cancellation assertion in 84.6 ms after only this options fix. No timeout was increased. The final five-file gate passed 60 tests / 142 assertions, including both explicit owner and per-call cancellation directions while confirming the other controller was not aborted. Typecheck results are in the native terminal feature document.
- **Occurrences:** One. The initial timeout and diagnostic rerun are the same unrepaired episode.

## Shared integration verification

The integrated eleven-file Memory/terminal gate passed 96 tests / 371 assertions, and all 21 workspace typechecks passed. The actual shared mini/fullscreen matrix passed fresh creation, Plan, reconnect, permission, Stop, media paths, managed-child viewing, Tasks management and compatibility regression. The two initial permission-fixture backend startup timeouts remain a separate unresolved investigation (BUG163); unchanged single-mode reruns passed. All owned runs were reaped.
