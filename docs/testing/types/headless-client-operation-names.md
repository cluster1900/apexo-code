# BUG-20261015-239: Nested input endpoints collide with Session client operations

- Status: shared canonical generation, generated consistency and workspace types passed.
- Scope: handwritten Client operation-name contract for native input receipts.

## Observed and expected behavior

`bun run generate` in `packages/client` failed with `Client endpoint name collision: sessions.wait`. The new input receipt wait and interrupt routes share their final path-name segment with existing Session operations. They must generate distinct public Client methods without changing HTTP routes or editing generated files.

## Cause and fix

The generator defaults to the final endpoint-name segment. Add explicit handwritten mappings for `session.input.execution`, `session.input.wait`, and `session.input.interrupt`: `inputExecution`, `inputWait`, and `inputInterrupt`. The legacy SDK retains its existing nested `v2.session.input` structure.

## Verification

Private `bun run generate` completed with exit zero after the mappings. The subsequent real legacy SDK build also completed with exit zero. Generated outputs are excluded from this amendment; integration must run the canonical generators against the combined source.

Shared integration subsequently ran both canonical generators successfully. `bun run check:generated` passed against an isolated index containing the current generated baseline, with the actual Git index unchanged. All 21 workspace typechecks passed. Generated files were not hand-edited.
