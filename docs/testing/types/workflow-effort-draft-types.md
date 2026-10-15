# BUG-20261015-072: Workflow Effort Draft Type and Fixture Diagnostics

- **Scope:** Initial isolated Workflow effort implementation and its new test fixture.
- **Occurrences:** One authoring episode; the distinct diagnostics below are not claimed as recurring instances of one root cause.
- **Status:** Integrated and verified; the live focused gate passed 14 tests / 70 assertions and all 21 repository typecheck tasks passed.

The first Core `bun typecheck` reported `TS2571: Object is of type 'unknown'` in the nested effort-field reader. Repeated indexed access did not retain the record guard's narrowing. Binding the indexed value once before the guard provides a stable narrowed value; no cast bypasses validation.

The first Apexo typecheck also rejected the variant test helper's `Record<string, unknown>` body. Native model request bodies are JSON values, so the fixture now derives its body type from `Model.Info["request"]["body"]`.

The additional credential-collision test initially called the nonexistent Effect 4 `DateTime.unsafeFromDate`. Both its runtime test and typecheck reported that API error before reaching the behavior assertion. The fixture now uses the installed `DateTime.makeUnsafe(0)` constructor. These two fixture corrections are distinct from the production narrowing diagnostic. The branded expected-value mismatch is tracked separately as the third occurrence of [BUG-20261014-117](location-model-id.md).

Verification in the isolated copy: `bun typecheck` from `packages/core` and `packages/apexo` passed. `bun test test/workflow/effort.test.ts test/workflow/script.test.ts test/workflow/model-selection.test.ts --timeout 30000` from `packages/apexo` passed 14 tests and 70 assertions, including the real canonical native model resolver with conflicting credential metadata.
