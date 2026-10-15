# BUG-20261015-281: Recovery regression omitted the canonical note writer's exposure argument

- **Scope:** The private regression for exact clear-action settlement (BUG-20261015-278).
- **Observed:** The ten-file runtime gate passed 82 tests / 525 assertions, but Apexo typechecking reported TS2554: the direct `MemoryV2Notes.remember` call expected three arguments and received two.
- **Expected:** The fixture deliberately stages an exposed pending note through the canonical writer, then proves an old clear cannot publish it.
- **Root cause:** The public capture-store facade defaults `exposed` to true, while the underlying canonical notes writer requires it explicitly. The fixture used the facade's call shape against the direct writer.
- **Fix:** Pass the explicit `true` exposure argument without changing either production API or the scenario's assertions.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the initial exact-action regression.
- **Verification:** Corrected `bun typecheck` in `packages/apexo` passed. The final exact-action and generated-index cases passed 2 tests / 11 assertions; the broader 82-test gate remains the runtime evidence before this explicit fixture argument correction. This writer-arity assumption is distinct from BUG-20261015-276's capture admission fields/result contract.

## Shared integration verification

The reviewed recovery implementation is integrated. Shared `bun test --timeout 30000` over the ten Memory store/lifecycle/controller files passed82 tests/525 assertions; the subsequent retry/recovery two-file gate passed24/162. Core and Apexo typechecks passed. Actual corrected-placement recovery CLI passed six checks with zero provider calls; server-derived retry CLI passed nine checks with zero calls. Both processes exited zero and were reaped. Client and legacy SDK generation passed. Rebuilt Desktop and management UI acceptance remain pending; these results do not close the unrelated timing investigations.

The rebuilt Electron/Node backend now passes recovery six checks and exact retry nine checks, each with zero provider calls, after the independent portable-probe correction [BUG290](../runtime/native-memory-recovery-node-file-probe.md). Both source CLI commands pass again. The corrected shared Dream/recovery gate remains24/162, and Core types pass. Native operation UI is separate work.
