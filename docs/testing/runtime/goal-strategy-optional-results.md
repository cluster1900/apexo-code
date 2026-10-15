# Optional strategy result fields rejected during internal validation

- **Bug ID:** BUG-20261014-165
- **Type:** Runtime schema boundary
- **Scope:** Native Goal strategy persistence and internal Workflow mutation validation
- **Status:** Verified
- **Independent occurrences:** 2

## Observed and expected behavior

The first strategy state suite passed 67 tests and failed one: a valid advisory
result without optional execution or file metadata became a failed advisory.
Its recommendation was absent. Valid internal results should persist advice
whether or not optional metadata is supplied.

## Reproduction and root cause

Run the `strategy advised preserves durable usage and owner safety` case in
`test/session/goal.test.ts`. The constructed result included explicit undefined
optional fields. The wire decoder expects optional keys to be omitted, whereas
the service accepts the decoded Type representation. A validation error was
caught by advisory failure handling, obscuring the successful result.

## Fix and verification

The service validates `Schema.toType(Goal.Strategy)`, matching other internal
Goal mutation boundaries. Result construction also omits absent metadata.
From `packages/apexo`, `bun test test/session/goal.test.ts test/session/goal-files.test.ts` passed 68 tests and 455 assertions after the correction. The real CLI strategy fixture also passed six scenarios and 71 provider requests.

## Workflow projection write boundary occurrence (2026-10-15)

An independent off-tree Workflow draft repeated this internal-Type versus wire
schema mismatch while stripping a derived recovery-guidance field before writes.
The focused gate passed three cases and failed fifteen, including transition
waiters whose expected work never started. A scoped causal trace identified
`SchemaError(Expected string, got undefined at ["message"])`: existing internal
transitions deliberately carry `message: undefined` before JSON storage omits it.

The draft now validates `Schema.toType(StoredInfo)` at that internal write
boundary. The encoded schema remains appropriate when decoding stored JSON.
Temporary diagnostics were removed. A regression deliberately passes the public
projection through an ordinary mutation and reads real SQLite data to prove the
derived field is stripped, while the independent owner/task checks still refuse
resume. The full scoped draft gate passed 18 tests and 118 assertions after this
correction. This is one authoring episode, not fifteen separate occurrences.
Live integration and packaged verification remain pending.
