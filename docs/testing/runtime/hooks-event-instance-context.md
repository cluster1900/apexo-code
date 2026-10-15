# BUG-20261014-152: Native event dispatch lost compatibility hook instance context

- Scope: Compatibility plugin listener receiving native Session EventV2 publications.
- Observed: A native Session prompt through the combined HTTP application failed before provider traffic with `InstanceRef not provided`; the pure native Server application did not reproduce it.
- Expected: Compatibility plugin listeners run against their registered instance while native Session execution remains Location-scoped.
- Reproduction: From `packages/apexo`, run `bun test test/e2e/v2-compaction.e2e.test.ts` against the initial snapshot consumer wiring; the first normal native prompt failed.
- Root cause: The plugin listener newly calls the instance-scoped host snapshot adapter. Event publishers invoke listeners in their own context, and native execution does not carry a legacy InstanceRef. The listener already captures and filters its registered directory but did not provide the captured instance to the adapter.
- Fix: Provide the captured InstanceRef around the registered listener effect after checking the event directory.
- Verification: The combined native compaction, Goal, Workflow, Session, coordinator, and deletion batch passed 16 tests with 159 assertions through the mixed HTTP application, including real provider traffic. Core package typecheck exited 0.
- Occurrences: One reported runtime reproduction; no recurring constraint promoted.
