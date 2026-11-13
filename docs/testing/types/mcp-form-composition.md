# BUG-20261113-F04-004: Initial form integration did not retain service and component contracts

- Scope: F04 Core services, native MCP graph, App dock, and TUI package boundary.
- Observed: Initial package checks rejected an untyped Deferred, numeric-union narrowing after a branch, a missing direct lifecycle dependency, incorrect `DockPrompt` props, a generated non-finite timestamp union used in arithmetic, and the new TUI component without a package export. One App conditional also inferred a boolean instead of an optional request.
- Expected: The feature retains canonical typed replies, explicit service dependencies, finite deadlines and the existing dock/package contracts.
- Reproduction: Run the affected package `bun typecheck` on the initial integration.
- Root cause: The new caller assumed types and exports that its owning APIs did not supply.
- Fix: Type the Deferred with the canonical reply, narrow the string branch explicitly, declare the lifecycle dependency/output, use `DockPrompt`'s `kind/header/footer` contract, use finite timestamp schemas, return an optional request in the conditional, and export the shared TUI component.
- Verification: Subsequent Core, Server, SDK, App, TUI and Apexo package checks passed. The first complete repository check passed all 21 tasks. Final gates are recorded in the implementation checkpoint.
- Occurrences: One implementation episode with distinct type errors; these are not counted as recurring instances of one root cause.

## Audit repair composition follow-up

The descendant-list implementation initially requested global `SessionV2` and `LocationServiceMap` inside a request callback. Server's leaf check inferred the unresolved requirements, while Apexo's complete typecheck exposed them through local hosts, CORS and end-to-end fixtures. The group now captures these global services during handler construction, following the existing production composition pattern; only the Location-provided form service is resolved per request. Public graph placement is unchanged. A fixture also required literal property types and copying readonly reply arrays at the SDK boundary. The subsequent Apexo package typecheck passed; complete gates are recorded in the implementation checkpoint.

The new mixed/native HTTP fixture initially combined differing route-layer requirements in one conditional and did not narrow the nested completed-tool state before accessing its content. Complete typechecking rejected both assumptions; the fixture now uses the established separately served host layers and explicitly checks completed state. The final root typecheck passes all 21 tasks and the native/mixed HTTP cases pass in the full 522-file suite.
