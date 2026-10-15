# BUG-20261014-091: Native permission fixture queried a different Location

- **Scope:** Native Hooks permission and Memory recovery/retry acceptance fixtures.
- **Observed:** The real native read requested approval and emitted Notification, but the fixture timed out waiting for the pending request. Logs showed it opened a second Location at the backend working directory.
- **Expected:** Query the permission service scoped to the created Session's Location.
- **Reproduction:** Use the global native permission listing endpoint with only the legacy `directory` query added by the shared shell fixture helper.
- **Root cause:** The native Location query contract differs from the legacy directory query. The global endpoint resolved the backend default Location instead of the fixture Session's Location.
- **Fix:** Use the native Session-scoped permission listing endpoint, which resolves placement from the Session.
- **Verification:** Native CLI and production Desktop reruns passed all six lifecycle scenarios using Session-scoped listing. The real notification and permission denial payloads were asserted.
- **Occurrences:** Two independent fixture-authoring episodes; the copied recovery/retry scripts belong to the second episode.

## Memory recovery placement (2026-10-15)

The integrated recovery CLI failed when its discard preview was unavailable. The fixture seeded a released prepared plan, but used `/api/project/current?directory=...` to select its project. Native Location middleware reads `location[directory]`, so the old parameter selected the backend working directory instead of the actual Session's Location. The retained fixture store contained its unchanged released plan; the operator Session used a different workspace scope. The private non-Git snapshot had masked this error because both project resolutions used the global project fallback. The new retry script copied the same query; that is the same authoring episode, not a third independent recurrence.

The recovery fixture now resolves `/api/location?location[directory]=...`, checks its canonical directory against the created operator's Location, and seeds the returned directory/project identity. Unavailable-preview assertions retain their actual bounded response for diagnosis. No product placement or recovery policy changed.

Verification: from `packages/apexo`, corrected `bun script/grok-memory-recovery-native.mjs cli` passed six checks with zero provider requests and joined cleanup. Shared Memory regression passed82 tests/525 assertions and Core typechecking passed. The two focused recovery HTTP scenarios also passed. The copied retry fixture now also passes nine checks with zero provider calls in both private and shared source CLI runs; all owned processes were reaped.
