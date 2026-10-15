# BUG-20261015-196: Workspace lifetime observer fixture violated typed contracts

- **Status:** Corrected and integrated; shared package typecheck and the five-file 48-test/169-assertion workspace/cancellation gate passed.
- **Scope:** New child-isolated HTTP workspace-owner regression fixture. One authoring episode; no production service failure is claimed.
- **Observed:** Package typechecking rejected assignment to the readonly `AppRuntime.runPromise` property, inferred untyped callback parameters from that invalid assignment, and reported missing `include`, `startAt` and `stopAt` fields in the exercise `Options` value.
- **Expected:** Observe the actual runtime without changing its execution behavior or weakening types, and construct the complete existing options contract.
- **Root cause:** The test treated a readonly typed runtime surface as directly assignable and treated required keys whose values permit `undefined` as optional keys.
- **Fix:** Use reversible property-descriptor instrumentation with a callback explicitly typed as the existing method; delegate to the original method and restore the exact descriptor in `finally`. Supply the three required option keys as `undefined`. No casts, production API changes, mocks of Core service behavior or relaxed compiler settings are introduced.
- **Verification:** From `packages/apexo`, `bun typecheck` passed after the corrections. `bun test test/server/httpapi-workspace-owner.test.ts test/effect/bridge-abort.test.ts` passed two tests/four assertions. The actual workspace regression also failed against original product code, demonstrating that instrumentation observes the unwanted global runtime rather than replacing it.
