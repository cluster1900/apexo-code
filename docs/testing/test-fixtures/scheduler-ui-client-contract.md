# BUG-20261015-228: Scheduler UI fixtures assumed the wrong delete and selector contracts

- Status: Fixed in the private Scheduler UI draft; shared integration pending.
- Scope: New App and TUI Scheduler adapter tests. One authoring episode with two explicit fixture corrections.
- Observed: App expected a deleted result but read `paused`; TUI threw `TypeError: protocol is not a function` before its new assertions.
- Expected: Tests exercise the frozen native API and each actual adapter interface.
- Causes: The fixture handled `POST .../delete`, but the real generated client correctly sends bodyless `DELETE .../:scheduleID`. The new TUI cases copied the App's protocol Promise instead of TUI's async protocol selector function.
- Fix: Dispatch and assert canonical DELETE with no body, preserve POST pause/resume, and provide the actual TUI selector. No production route or adapter contract changed for these failures.
- Verification: App `bun test src/utils/session-tasks.test.ts` passed 26 tests and 114 assertions. Apexo `bun test test/cli/session-tasks-client.test.ts test/tui/native-session-transport.test.ts` passed 38 tests and 152 assertions. Tests use real SDK HTTP requests, preserve independent Task identity, verify passive reads and bodyless controls, and reject raw server causes.

The broader mixed-protocol panel test also needed the additive `/schedule` array endpoint and expected request alongside its existing `/process` fixture. The missing route produced the intended independent schedules-list issue, rather than an empty issue array. The correction preserves the earlier Process fixture fix and explicit native/compatibility selection. Final related batch: 40 tests / 158 assertions, no failures. This is part of the same new adapter fixture authoring episode.
