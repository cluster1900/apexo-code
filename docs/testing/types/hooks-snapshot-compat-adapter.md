# BUG-20261014-111: Compatibility snapshot adapter contracts

- Scope: Compatibility host-hook adapter and Session service layer.
- Observed: The initial integrated Apexo typecheck rejected an Effect passed directly to `InstanceState.make`, the undeclared global snapshot dependency, a typed capture failure escaping the legacy loop, and incompatible legacy SDK message summary/file-source types.
- Expected: Scoped state uses the repository factory contract; service dependencies and failure boundaries are explicit; the host adapter receives the actual durable user message.
- Root cause: The new adapter crossed the Effect state factory, legacy no-error loop, and plugin SDK boundaries without expressing their contracts.
- Fix: Supply the state factory, declare dependencies, convert capture failure explicitly at the legacy execution boundary, and keep the durable domain message through the host adapter with a narrow SDK boundary assertion. Host handlers inspect text parts; no user message is fabricated or admitted by this conversion.
- Reproduction: Run `bun typecheck` from `packages/apexo` with the initial snapshot adapter.
- Verification: Integrated Apexo typecheck passed after these corrections. Later deletion dependency checks are tracked separately. One observed initial typecheck episode; the second occurrence is recorded below. No recurring constraint promoted.

## Persistent preference adapter occurrence

The new typed preference failure extended Stop gating beyond the legacy loop's no-error contract. The isolated Apexo typecheck rejected that error escaping the established compatibility boundary. The adapter now converts it explicitly at that boundary, as existing capture failures do; the Core runner retains its typed failure. Apexo package typechecking passed after the correction. A related draft edit referenced a snapshot variable outside its scope in StopCancelled and was corrected by capturing that callback's actual snapshot. These are draft integration corrections, not evidence of a shipped execution defect. No recurring rule is promoted.

The two independently observed adapter-boundary episodes are counted as two occurrences; multiple diagnostics within one episode are not separate recurrences. Live integration again passed all twenty-one typecheck tasks.
