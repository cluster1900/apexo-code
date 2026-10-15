# Ajv validator runtime marker was absent from its declared type

- **Bug ID:** BUG-20261015-035
- **Scope:** Workflow output-schema preflight in an off-tree draft.
- **Status:** Fixed and verified after integration.
- **Occurrences:** One authoring/typecheck episode.

Core typecheck reported TS2339: `$async` does not exist on
`ValidateFunction<unknown>`. Ajv can produce a runtime validator carrying that
marker, while the selected compile overload declares the synchronous validator
shape. Accessing the marker directly was invalid TypeScript.

The preflight now narrows with `"$async" in validator` before examining the
marker. It neither casts away the mismatch nor accepts asynchronous validation
as a truthy successful result. Focused tests reject asynchronous and unavailable
external-reference validators before child work.

Verification: `bun typecheck` from `packages/core` passed after the guard;
`bun typecheck` from `packages/apexo` also passed. The isolated native HTTP test
passed 21 assertions, including unsupported async schema failure with zero
children and zero additional provider requests. After integration, all 21
typecheck tasks and App/Desktop builds passed. The live focused suite passed
29 tests / 194 assertions, including the native HTTP contract cases.
