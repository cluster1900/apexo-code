# BUG-20261112-003: Review service environments escaped their intended boundary

- Scope: initial F01 Core service and mixed HTTP host composition.
- Observed: Core typechecking rejected a worker requiring `CodeReviewCapture.Service` where `FiberSet` accepted an environment-free effect. A subsequent Apexo check rejected startup database/schema error channels at the existing mixed-host layer boundary. The first runner edit also omitted its `Schema` import.
- Expected: the worker uses its captured service, and the host retains its declared construction contract.
- Reproduction: run `bun typecheck` from `packages/core` and `packages/apexo` on the initial service integration.
- Root cause: final report validation still required an uncaptured service; startup reconciliation exposed unchecked storage/decode errors through the layer instead of treating unrecoverable startup corruption consistently with database initialization.
- Fix: provide the already constructed capture service to report validation, fail startup reconciliation as a defect on storage/schema corruption, and import `Schema` in the runner. Ordinary request failures retain the typed domain/HTTP boundary.
- Verification: subsequent package checks passed for Core, Protocol, Server and Apexo. Native execution plus real CLI/HTTP fixtures also constructed the public service graphs successfully. This record describes one implementation episode, not recurring historical occurrences.

## BUG-20261112-013: Initial presentation types crossed package or narrowing boundaries

- Scope: new App/TUI review presentation.
- Observed: App could not resolve a direct Pierre type import, a repeated accessor lost anchor narrowing, and a TUI target expression widened its discriminator to `string`.
- Expected: presentation code consumes its owning package's exported contract and retains discriminated target/anchor types.
- Reproduction: run package `bun typecheck` after the initial interface integration.
- Root cause: the App does not directly depend on Pierre, accessor calls are separate reads, and an uncontextualized object expression widened the target literal.
- Fix: derive the range type from the existing exported preview props, narrow one captured anchor value, and contextualize the target with the generated input contract.
- Verification: the subsequent root `bun turbo typecheck --concurrency=2` passed all 21 tasks. Final gate results are recorded in the implementation checkpoint.
