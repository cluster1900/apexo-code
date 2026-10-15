# Reversed Effect assertion widened a Workflow driver test error

- **Bug ID:** BUG-20261015-036
- **Scope:** Isolated Workflow attempt-claim test fixture.
- **Status:** Fixed and verified after integration.
- **Occurrences:** One authoring/typecheck episode.

Apexo typecheck rejected the test driver with TS2322 because its Effect error
channel contained `void` instead of only `WorkflowStore.Failure`. The test used
`Effect.flip` on an `Effect<void, Failure>` inside the constrained driver: flipping
success and error also makes the old void success type a possible error.

The assertion now uses `Effect.result` and checks an explicit Failure result
whose payload still has `code: "stale"`. The product callback contract and the
behavioral assertion are unchanged; no error cast or weakened expectation was
introduced.

Verification: `bun typecheck` from `packages/apexo` passed in the isolated copy.
The focused store/engine/script test command passed 17 tests and 97 assertions.
After integration, all 21 typecheck tasks passed and the live focused gate
passed 29 tests / 194 assertions across eleven files.
