# Native Saved-Permission Service Boundary

- **Bug ID:** BUG-20261014-144
- **Type:** Types / service integration
- **Scope:** Native Server permission handlers and native-only HTTP server composition
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

Native-only Feedback HTTP fixtures failed package type checking with an
unfulfilled `Service` requirement, although their runtime scenarios passed.
The native server should resolve process-global services when constructing its
handler groups and leave only Location-scoped services to request middleware.

## Reproduction and root cause

Run `bun typecheck` from `packages/apexo` with the native-only Feedback fixtures.
Tracing the remaining layer requirement identified `PermissionSaved.Service`.
The saved-permission handlers resolved this process-global service inside each
request, so the native HTTP layer retained the requirement rather than consuming
it during group construction. A transitive runtime service masked the problem
in less restrictive server compositions.

The fixtures also now provide `HttpServer.layerServices` explicitly and infer
their composed layer types instead of assigning an incomplete service annotation.

## Fix

Capture `PermissionSaved.Service` once inside the permission handler-group
construction effect. Both saved-permission endpoints use that service. Resolve
`Location.Service` inside the list request so the requested project's placement
continues to come from its middleware.

## Verification

- `bun typecheck` from `packages/apexo`: exit 0.
- `bun test test/e2e/v2-feedback-management.e2e.test.ts test/e2e/v2-feedback.e2e.test.ts`
  from `packages/apexo`: 3 tests, 38 assertions, zero failures. These compose the
  actual native-only server and verify management plus permitted/denied tools.
- `bun run script/httpapi-exercise.ts --mode effect --include v2.permission.saved --fail-on-missing --fail-on-skip`
  from `packages/apexo`: both saved-permission scenarios passed, with no skips,
  missing routes or extras.

This focused verification does not establish a complete HTTP or repository gate.
