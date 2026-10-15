# BUG-20261015-276: Recovery fixture used the wrong capture admission contract

- **Scope:** Private native Memory recovery store fixture; no production capture contract change.
- **Observed:** Apexo package typechecking rejected `from` and `through` in `store.admit` and rejected `job_id` on its result.
- **Expected:** The negative live-lease case admits a source through the actual canonical API, then proves that clear refuses the claim while its original owner can settle it.
- **Root cause:** The new fixture confused the resulting job range/SQL projection with admission input and its public result. `admit` takes `promptID`, `sourcePromptIndex`, `source`, and `exposed`; its result exposes `jobID`.
- **Correction:** Use the actual admission input, require the discriminated result to be `admitted: true`, and compare the claimed job against `jobID`. Do not weaken production types.
- **Reproduction:** Run `bun typecheck` in `packages/apexo` with the initial recovery fixture.
- **Verification:** The initial typecheck failed with TS2353 and TS2551; the next check exposed the same fixture's missing admitted-result narrowing (TS2769). After the explicit admission guard, `bun typecheck` in `packages/apexo` passed. `bun test --timeout 30000 test/tool/memory-recovery.test.ts test/v2/memory-dream-native.test.ts` passed 22 tests / 140 assertions, including the real held capture-lease negative and original-owner settlement. One fixture-authoring episode is recorded, not a separate recurrence for each diagnostic.

## Shared integration verification

The reviewed recovery implementation is integrated. Shared `bun test --timeout 30000` over the ten Memory store/lifecycle/controller files passed82 tests/525 assertions; the subsequent retry/recovery two-file gate passed24/162. Core and Apexo typechecks passed. Actual corrected-placement recovery CLI passed six checks with zero provider calls; server-derived retry CLI passed nine checks with zero calls. Both processes exited zero and were reaped. Client and legacy SDK generation passed. Rebuilt Desktop and management UI acceptance remain pending; these results do not close the unrelated timing investigations.

The rebuilt Electron/Node backend now passes recovery six checks and exact retry nine checks, each with zero provider calls, after the independent portable-probe correction [BUG290](../runtime/native-memory-recovery-node-file-probe.md). Both source CLI commands pass again. The corrected shared Dream/recovery gate remains24/162, and Core types pass. Native operation UI is separate work.
