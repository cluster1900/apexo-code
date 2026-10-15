# BUG-20261015-279: Native clear omitted its generated Memory index

- **Scope:** Private native Memory recovery draft; not shared at discovery.
- **Observed:** Explicit clear returned completed while the old `MEMORY.md` still existed.
- **Expected:** Clearing a scope removes its captured generated index under the same permission, hash and durable action authority as its other managed files.
- **Root cause:** The canonical directory scan enumerates topics, observations and archives; the derived root index is outside that walk. The native recovery action did not run broad reconcile and therefore neither deleted nor regenerated the old index.
- **Fix:** Add an existing `MEMORY.md` fingerprint to clear's complete bounded target inventory and durable receipt. Settle it by its exact hash; do not regenerate unrelated content as part of old-action recovery. Discard semantics are unchanged.
- **Reproduction:** The real store writes an indexed note, captures a clear preview, commits and settles it, then checks physical index absence. Against the omitted-index branch, the action completed and the final absence assertion failed.
- **Verification:** The static review concern was reproduced by the `captured generated index` case. The corrected ten-file Memory store/controller/crash gate (`bun test --timeout 30000` with the recovery, Dream, migration, lifecycle and operation files) passed 82 tests / 525 assertions. Final Core and Apexo package typechecks passed. The final two focused review regressions passed 2 tests / 11 assertions; real CLI recovery passed six checks with zero provider calls. Shared integration and Desktop verification are pending. This omission is distinct from BUG-20261015-278's overbroad settlement.

## Shared integration verification

The reviewed recovery implementation is integrated. Shared `bun test --timeout 30000` over the ten Memory store/lifecycle/controller files passed82 tests/525 assertions; the subsequent retry/recovery two-file gate passed24/162. Core and Apexo typechecks passed. Actual corrected-placement recovery CLI passed six checks with zero provider calls; server-derived retry CLI passed nine checks with zero calls. Both processes exited zero and were reaped. Client and legacy SDK generation passed. Rebuilt Desktop and management UI acceptance remain pending; these results do not close the unrelated timing investigations.

The rebuilt Electron/Node backend now passes recovery six checks and exact retry nine checks, each with zero provider calls, after the independent portable-probe correction [BUG290](../runtime/native-memory-recovery-node-file-probe.md). Both source CLI commands pass again. The corrected shared Dream/recovery gate remains24/162, and Core types pass. Native operation UI is separate work.
