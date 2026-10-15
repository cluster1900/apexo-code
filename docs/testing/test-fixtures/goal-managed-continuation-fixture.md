# BUG-20261015-087: Goal continuation fixture did not reach its intended second round

- **Scope:** `packages/apexo/test/session/goal-managed-admission.test.ts`.
- **Status:** Fixture corrected and verified in the composed isolated implementation.
- **Independent occurrences:** One fixture-authoring episode; its setup, response-order and typed-assertion corrections are not separate recurring product bugs.

## Observed and expected behavior

The expanded native Goal admission fixture initially put a bracketed case array directly after a semicolon-free function call, creating unintended indexing. After separating the case array, the first verifier still returned `achieved: true`; the continuation variant then waited for a child that successful completion did not create and timed out. The intended scenario requires another worker round and legitimate reuse of the first verifier. Runtime success then exposed an assertion-only type error: a conditional object spread widened the literal admission status used in a typed expected array.

## Root cause and correction

Use a named case array. Make the first verdict negative with a concrete unmet requirement only in the continuation variant, leaving subsequent provider responses in actual execution order. Assert role titles separately from the predicate requiring Failure and zero durable inbox rows; preserve the implementation's types rather than casting or weakening the contract. No production runtime change is attributed to these fixture errors.

## Verification

With pinned Bun 1.3.14 from `packages/apexo`, `bun test test/session/goal-managed-admission.test.ts --timeout 30000` passed two tests / 16 assertions with clean shutdown. Core and Apexo `bun typecheck` passed. The observed flow includes planning, verifying, repeated verifying for the continuation case, and closing summary. The previous one-pass/one-timeout run was a fixture failure, not evidence of a product deadlock. Shared acceptance is tracked in the managed-child feature record.
