# BUG-20261014-005: Missing Explicit Service Layer Exports for Goal Callers

- **Status**: Fixed & Verified; **Verified Occurrences**: 2; **Linked Rule**: None (below threshold).
- **Scope**: `AppProcess` and `Global` services in Goal HTTP handlers, and `ChildProcessSpawner` service in Git evidence test fixtures.
- **Observed**: Typecheck reported missing services on Server routes, and 6 Git evidence tests failed during temp directory initialization with `Service not found: effect/process/ChildProcessSpawner`.
- **Expected**: HTTP routes and test fixtures can resolve all directly yielded services from their provided Layer.
- **Reproduction**: In `packages/apexo`, run `bun typecheck` or `GITHUB_ACTIONS=false bun test test/session/goal-changes.test.ts test/session/goal-files.test.ts`.
- **Root Cause**: Assumed that services used internally by dependent layers (`Git.node` using `AppProcess`, `AppProcess.node` using `ChildProcessSpawner`) are automatically re-exported to callers that yield them directly.
- **Fix**: Explicitly include `AppProcess.node` and `Global.node` in the Server layer group, and provide both `AppProcess.node` and `CrossSpawnSpawner.node` in the test layer group.
- **Verification**: 11 targeted unit tests passed (0 failed), full-repo typecheck passed 21/21, and the 332-test affected regression suite passed.
