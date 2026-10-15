# BUG-20261015-057: Native Task draft type boundaries

- **Type:** Types; one draft authoring episode, no live production regression.
- **Observed:** Core typechecking reported comparisons between separate catalog and LLM branded IDs, an unbranded variant string, and the wrong `Schema.isBetween` argument shape.
- **Expected:** Resolve native models without weakening the existing branded contracts or bounded input schema.
- **Cause:** The new leaf treated independently branded transport/catalog identifiers as one TypeScript type and used a range helper signature from a different API shape.
- **Fix:** Compare their string representations only at the explicit transport-to-catalog lookup boundary, construct the selected variant through its canonical brand, and pass the current minimum/maximum options object.
- **Verification:** `bun typecheck` from `packages/core` passed in the isolated draft after these corrections. No casts to unknown/any and no bounds removal were used.

The expanded settlement fixture initially typed its result-inspection helper as
the concrete cancellation Detail result. Reusing it for a void receipt latch
produced two incompatible Result diagnostics. The helper now accepts
`Result<unknown, unknown>` and still narrows the actual typed Task failure.
Final composed Apexo `bun typecheck` passed, and the unchanged boundary semantics
passed 2 tests/39 assertions. This is part of the draft authoring episode, not a
claimed historical recurrence or production failure.
