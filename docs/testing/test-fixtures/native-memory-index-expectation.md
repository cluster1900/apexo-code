# Native Memory Index Assertion

- **Bug ID:** BUG-20261014-135
- **Type:** Test fixture
- **Scope:** Native Memory Context Source regression
- **Status:** Verified
- **Independent occurrences:** 1

## Observed and expected behavior

The first native context regression expected a manually saved observation's body
in the automatic context. The real catalog supplied a generated index containing
the observation's filename instead. The fixture must validate the index selected
by the product, not assume full observation bodies are automatically injected.

## Reproduction and cause

Run `bun test test/v2/memory-context.test.ts` from `packages/apexo` with a saved
observation whose body is `NATIVE_FIRST_MEMORY`. The original assertion searched
for that body and failed while the returned index correctly listed the saved
observation. The assertion confused direct note preview with automatic context.

## Fix and verification

Assert the real path returned by `MemoryV2Catalog.remember`, including stable
selection after a second note and disappearance after forgetting the first.
The combined native context, compatibility context/backend and permission run
passed **88 tests / 190 assertions / 0 failures**:

```sh
bun test test/v2/memory-context.test.ts test/tool/memory-backend.test.ts test/tool/memory-context.test.ts test/permission/next.test.ts
```

This was a fixture correction, not a change to the product's memory rendering.
