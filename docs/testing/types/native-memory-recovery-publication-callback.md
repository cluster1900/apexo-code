# BUG-20261015-277: Recovery publication callback lost its Effect environment

- **Scope:** Private native Memory recovery publication callback and its controller consumer.
- **Observed:** Core typechecking rejected the controller worker as `Effect<void, never, unknown>` where its scoped fork required no environment. Apexo typechecking also reported dependent unknown environments in the recovery fixtures.
- **Expected:** The short publication wrapper preserves the actual commit result, errors and environment without leaking `unknown` or discarding requirements.
- **Root cause:** A higher-rank callback generic over arbitrary success/error/environment channels also introduced outer inferred error/environment parameters. Inference left the outer environment unknown at the real callback and identity fixture call sites.
- **Correction:** Type the wrapper input against the actual recovery commit Effect, preserving its success type and inferring the callback's complete error/environment result. The wrapper does not need to accept arbitrary unrelated Effects. No casts or service requirements are discarded.
- **Reproduction:** Run `bun typecheck` in `packages/core` and `packages/apexo` with the initial recovery callback signature.
- **Verification:** Both initial package checks failed. After the callback correction, `bun typecheck` passed in `packages/core` and `packages/apexo`. `bun test --timeout 30000 test/tool/memory-recovery.test.ts test/v2/memory-dream-native.test.ts` passed 22 tests / 140 assertions, including real post-COMMIT crash recovery and native controller publication. Results are private validation; shared integration is pending.
- **Classification:** This is a higher-rank callback inference failure, not another independent conditional-branch occurrence of BUG-20261015-005. Its count and RULE-20261015-008 are unchanged.

## Shared integration verification

The reviewed recovery implementation is integrated. Shared `bun test --timeout 30000` over the ten Memory store/lifecycle/controller files passed82 tests/525 assertions; the subsequent retry/recovery two-file gate passed24/162. Core and Apexo typechecks passed. Actual corrected-placement recovery CLI passed six checks with zero provider calls; server-derived retry CLI passed nine checks with zero calls. Both processes exited zero and were reaped. Client and legacy SDK generation passed. Rebuilt Desktop and management UI acceptance remain pending; these results do not close the unrelated timing investigations.

The rebuilt Electron/Node backend now passes recovery six checks and exact retry nine checks, each with zero provider calls, after the independent portable-probe correction [BUG290](../runtime/native-memory-recovery-node-file-probe.md). Both source CLI commands pass again. The corrected shared Dream/recovery gate remains24/162, and Core types pass. Native operation UI is separate work.
