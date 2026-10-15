# BUG-20261014-129: Checkpoint CLI fixture construction error

- Scope: Checkpoint CLI fixture.
- Observed: Stopping the repeatedly paused run returned HTTP 404.
- Expected: The fixture reaches the intended lifecycle check.
- Root cause: The fixture helper defaults to GET when no body is supplied; the new call omitted explicit POST.
- Fix: Send an explicit POST with no body, matching the public no-payload endpoint.
- Reproduction: Run `bun script/grok-workflow-checkpoint.mjs cli` from packages/apexo with the earlier fixture.
- Verification: Corrected CLI fixture passed four scenarios and one provider call. No product failure is inferred.
- Occurrences: One observed fixture failure.
