# BUG-20261112-003: Review service environments escaped their intended boundary

- Scope: initial F01 Core service and mixed HTTP host composition.
- Observed: Core typechecking rejected a worker requiring `CodeReviewCapture.Service` where `FiberSet` accepted an environment-free effect. A subsequent Apexo check rejected startup database/schema error channels at the existing mixed-host layer boundary. The first runner edit also omitted its `Schema` import.
- Expected: the worker uses its captured service, and the host retains its declared construction contract.
- Reproduction: run `bun typecheck` from `packages/core` and `packages/apexo` on the initial service integration.
- Root cause: final report validation still required an uncaptured service; startup reconciliation exposed unchecked storage/decode errors through the layer instead of treating unrecoverable startup corruption consistently with database initialization.
- Fix: provide the already constructed capture service to report validation, fail startup reconciliation as a defect on storage/schema corruption, and import `Schema` in the runner. Ordinary request failures retain the typed domain/HTTP boundary.
- Verification: subsequent package checks passed for Core, Protocol, Server and Apexo. Native execution plus real CLI/HTTP fixtures also constructed the public service graphs successfully. This record describes one implementation episode, not recurring historical occurrences.
