# BUG-20261015-078: Task UI uses the domain type for an encoded query value

- Status: corrected and verified in the isolated Task UI integration workspace; shared integration remains pending.
- Scope: App and terminal native Task list adapters.
- Independent occurrences: one initial UI integration episode.

The first App typecheck rejected `limit: 100` with `TS2322: Type 'number' is not assignable to type 'string'`. The native Protocol decodes the HTTP query through `Schema.NumberFromString`; the legacy JavaScript SDK represents the encoded query as a string. The UI had used the decoded domain type at the SDK boundary.

Both adapters now pass `limit: "100"`. The request still asks for the newest 100 Task summaries. No generated source or public schema was changed, and no cast bypasses the SDK contract.

Verification in the isolated workspace:

- From `packages/app`, `bun test src/utils/session-tasks.test.ts`: 6 tests, 32 assertions passed. The HTTP fixture observes the emitted native `?limit=100` query and bodyless cancellation, compatibility routing, and safe cancellation error handling.
- From `packages/apexo`, `bun test test/cli/session-tasks-client.test.ts`: 6 tests, 32 assertions passed, including mixed-server compatibility preference and native fallback selection.
- From `packages/app` and `packages/tui`, `bun typecheck`: passed after correction.
- From `packages/apexo`, `bun typecheck`: passed after incorporating the Task agent's separately owned fixture assertion correction. That test helper error is not another occurrence of this wire-type bug.


Shared verification: App and terminal adapters each passed six tests / 32 assertions, all 21 typecheck tasks passed, and both live native mini/fullscreen narrow PTYs passed three checks / eight provider calls. Production browser and actual rebuilt Desktop window each passed six checks / eight calls. These reruns add no independent bug occurrence.
