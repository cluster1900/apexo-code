# BUG-20261014-058: Readonly JSON arrays were not narrowed by Array.isArray

- Scope: First-party Workflow stage fanout selection.
- Observed: Core typecheck rejected dynamic property access on the JSON object/readonly-array union (TS7053). The first check also ran before the coordinated explicit Ajv dependency was installed.
- Expected: Type-safe JSON object selection and an explicitly declared validator dependency.
- Reproduction: Run `bun typecheck` from `packages/core` after the initial Workflow engine addition.
- Root cause: Array.isArray does not eliminate the readonly JSON-array alternative from Effect's JSON union. The validator package was initially available only transitively.
- Fix: After the runtime non-array object guard, select through an explicit readonly record view. Core declares Ajv directly through the shared dependency update.
- Verification: Core package `bun typecheck` passed on Bun 1.3.14 after the correction and dependency synchronization.
- Occurrences: One initial implementation failure; no recurring constraint.
