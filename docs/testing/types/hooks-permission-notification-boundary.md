# BUG-20261014-090: Permission notification used an unavailable plugin event

- **Scope:** Hook lifecycle extension typecheck.
- **Observed:** Package typecheck rejected the `permission.asked` comparison in the legacy plugin callback because its public event union does not expose that event.
- **Expected:** Emit the observer from the real permission service boundary without inventing a public plugin event.
- **Reproduction:** Typecheck the initial notification adapter branch in `packages/apexo`.
- **Root cause:** The implementation assumed the permission bus event was included in the public plugin callback union.
- **Fix:** Schedule the host Notification observer from the permission service immediately after it publishes its actual pending request, scoped to the instance lifetime.
- **Verification:** Package typecheck passed after moving the boundary. New lifecycle fixture passed six scenarios in CLI V1 and V2 and production Desktop V1 and V2. An added independent execution-failure classification assertion exposed BUG-20261014-071 and is tracked there.
- **Occurrences:** One observed typecheck failure.
