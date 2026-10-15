# Native strategy request broadened the compatibility review input type

- **Bug ID:** BUG-20261014-169
- **Type:** Type boundary
- **Scope:** Compatibility Goal review adapter
- **Status:** Verified
- **Independent occurrences:** 1

Core typecheck passed, but the Apexo package check rejected the compatibility
review adapter. Its input kind was derived from the shared transport Request
union; adding the native strategy role unintentionally advertised a kind that
the compatibility review orchestrator does not execute.

The adapter now explicitly excludes `strategizing` from that input. Native
strategy execution retains its separate method and active worker ownership.
No compatibility runtime behavior is changed or claimed as implemented.
Verification: `bun typecheck` from `packages/apexo` passed after the correction.
