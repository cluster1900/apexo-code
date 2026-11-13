# BUG-20261113-F04-004: Initial form integration did not retain service and component contracts

- Scope: F04 Core services, native MCP graph, App dock, and TUI package boundary.
- Observed: Initial package checks rejected an untyped Deferred, numeric-union narrowing after a branch, a missing direct lifecycle dependency, incorrect `DockPrompt` props, a generated non-finite timestamp union used in arithmetic, and the new TUI component without a package export. One App conditional also inferred a boolean instead of an optional request.
- Expected: The feature retains canonical typed replies, explicit service dependencies, finite deadlines and the existing dock/package contracts.
- Reproduction: Run the affected package `bun typecheck` on the initial integration.
- Root cause: The new caller assumed types and exports that its owning APIs did not supply.
- Fix: Type the Deferred with the canonical reply, narrow the string branch explicitly, declare the lifecycle dependency/output, use `DockPrompt`'s `kind/header/footer` contract, use finite timestamp schemas, return an optional request in the conditional, and export the shared TUI component.
- Verification: Subsequent Core, Server, SDK, App, TUI and Apexo package checks passed. The first complete repository check passed all 21 tasks. Final gates are recorded in the implementation checkpoint.
- Occurrences: One implementation episode with distinct type errors; these are not counted as recurring instances of one root cause.
