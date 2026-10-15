# Workflow resume history fixture constructor

- **Bug ID:** BUG-20261015-349
- **Scope:** Private native history-copy test fixture.
- **Status:** Corrected and verified in the focused private tests.
- **Independent occurrences:** One.

The initial history-copy fixture called `Model.ProviderID.make`, but the Model namespace does not export ProviderID. The test failed before behavioral assertions with `undefined is not an object (evaluating 'Model.ProviderID.make')`. The expected behavior was to construct a valid canonical Model.Ref and exercise durable copying.

Reproduction: run `bun test test/v2/history-copy.test.ts --timeout 30000` in `packages/apexo` with the incorrect constructor. The initial run had zero passes and one failure. The fix imports the owning `Provider` namespace and uses `Provider.ID.make`, preserving branded values without casts or production changes.

The corrected initial fixture passed one test and 22 assertions. The expanded copy and real-runner tests subsequently passed two tests and 43 assertions. This namespace error is not counted as a new occurrence of the separate unbranded-value bug.
