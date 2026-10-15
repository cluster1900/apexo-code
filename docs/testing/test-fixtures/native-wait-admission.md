# BUG-20261014-131: Native wait fixture assumed a resume route

- Scope: New native Session wait production fixture.
- Observed: The fixture called an unregistered POST /api/session/:id/resume route and received 404, then waited for a provider that could never start.
- Expected: The fixture starts work through an actual native public admission route and tests wait independently.
- Root cause: The internal SessionExecution.resume method was mistaken for a public HTTP endpoint.
- Fix: Reconcile the previously admitted exact prompt ID with resume enabled through the public prompt route. The idle wait still proves admit-only input is not promoted. Terminate and reap the failed fixture's owned processes.
- Reproduction: Run `bun script/grok-session-wait.mjs cli` from packages/apexo with the earlier fixture.
- Verification: Corrected CLI acceptance passed four scenarios with one provider call. This is not a production wait failure.
- Occurrences: One observed fixture failure.
