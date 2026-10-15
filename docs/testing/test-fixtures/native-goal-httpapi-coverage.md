# Native Goal HTTP API Coverage

- **ID:** BUG-20261014-077
- **Category:** Test fixtures / API coverage
- **Scope:** The ten native Goal routes in Protocol and the shared HTTP API exerciser.
- **Status:** Fixed and verified.
- **Independent occurrences:** 1.

## Observed and expected behavior

The first `bun run test:httpapi` run passed 237 existing scenarios but failed because all ten new `/api/session/:sessionID/goal` routes lacked exerciser scenarios. Native Goal integration tests did not satisfy the separate route coverage gate. Every declared public route must participate in coverage, authorization and Effect-handler checks.

## Reproduction and root cause

From `packages/apexo`, run `bun run test:httpapi` after registering the native Goal Protocol group without adding its ten route keys to `test/server/httpapi-exercise/index.ts`. The gate prints ten `MISS` entries and exits with status 1. The implementation added native integration tests but omitted the shared gate's explicit route inventory.

## Fix

Add scenarios for native Goal admission, empty lookup/report catalog, absent Goal controls, absent Session report access, and idempotent empty report cleanup. Payload-free controls continue to send no body. The native runner integration tests independently cover successful execution and lifecycle controls.

## Verification

The corrected `bun run test:httpapi` completed successfully: coverage, authorization and Effect-handler phases each passed 247 scenarios with zero failures, skips or missing routes. A separate native Goal-only Effect run also passed all ten cases. This is one observed omission, not three independent recurrences, so no constraint has been promoted.
