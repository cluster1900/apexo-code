# BUG-20261112-010: Review provider schema omitted referenced definitions

- Scope: F01 native provider response-format construction.
- Observed during a direct schema probe: `Schema.toJsonSchemaDocument(CodeReview.Output).schema` contained only a reference to `CodeReview.Output`; its definition was stored separately on the document.
- Expected: the provider receives a self-contained JSON Schema while host validation continues using the canonical Effect schema.
- Reproduction: inspect the document returned by `Schema.toJsonSchemaDocument(CodeReview.Output)`, then inspect the actual model request in the native owned-review fixture.
- Root cause: the initial response-format adapter selected the document's `schema` member without its `definitions`.
- Fix: include the document definitions under `$defs` in the provider response schema.
- Verification: `bun test test/v2/code-review.test.ts --test-name-pattern 'native owned review'` from `packages/apexo` passed one test / 13 assertions, including an assertion that the real provider request includes `$defs`. The fixture proves the wire construction, not acceptance by every live provider.
