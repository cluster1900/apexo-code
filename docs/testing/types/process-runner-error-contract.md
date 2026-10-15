# Process completion failure was absent from the runner error contract

- **Bug ID:** BUG-20261015-133
- **Scope:** Private native Shell completion integration.
- **Status:** Corrected and verified.
- **Independent occurrences:** Three (Shell, Memory and history-copy domain integrations).

The first composed Core typecheck reported TS2322 in `session/runner/llm.ts`: completion receipt reads introduced `SessionProcessStore.Failure`, but `SessionRunner.RunError` did not include that real typed channel. The implementation was not made infallible by a cast or broad cause conversion.

The runner error union now includes the process-store failure alongside its existing Task/Workflow domain failures. Corrected Core and Server package typechecks passed. The composed Apexo typecheck passed after the independent host service-output correction in BUG062. Actual provider tests passed six tests / 55 assertions; real CLI acceptance passed nine checks / 26 provider calls.

Shared integration verification: all 21 workspace typechecks passed, and the combined native Shell/media/Plan suite passed 68 tests / 623 assertions. Shared CLI and freshly rebuilt Desktop passed Shell nine checks / 26 calls each and media-options five checks / eight calls each. These are scoped gates; the earlier full-unit checkpoint is not claimed for the later integration.

## Independent native Memory integration occurrence

The new Memory materialization call introduced `SessionMemoryModeNative.Failure`, but `SessionRunner.RunError` omitted that domain failure. `bun typecheck` in `packages/core` reported TS2322 in `session/runner/llm.ts`, identifying `NativeMemoryFailure` as outside the declared union. Adding the actual failure member preserved the typed channel without casts or broad cause conversion. This is a second independently authored domain integration; it is not another run of the Shell failure.

The corrected Core package typecheck passed. The frozen Memory gate passed 36 tests / 229 assertions across six files, including real native tool and HTTP execution. Its pure-native and mixed HTTP cases passed 2 tests / 36 assertions. These are Memory draft results; the earlier shared Shell aggregate above is not reused as Memory verification.

## Independent native history-copy integration occurrence

The third independently authored integration added the history-copy readiness check before native input promotion. Its real `SessionHistoryCopy.Conflict` failure was initially absent from `SessionRunner.RunError`; the Core typecheck reported TS2322 at the runner implementation. The correction adds that precise failure member, preserving the typed channel. This is one authoring episode, independent of the prior Shell and Memory integrations, not a repeat of their verification runs.

Pinned `bun typecheck` in `packages/core` passed after the correction. The focused history-copy and real-provider runtime suite passed two tests and 43 assertions. Apexo's remaining new-event union errors await coordinated client generation and do not prove a problem in this corrected runner error contract.

The recurring constraint is [RULE-20261015-022](../../rules/runner-domain-error-contract.md).
