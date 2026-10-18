# BUG-20261018-401: Edit newString `$` sequences were interpreted as replacement patterns

- Scope: Compatibility edit tool `replaceAll` path and both native V2 edit paths (single and `replaceAll`).
- Observed: `String.prototype.replace`/`replaceAll` were called with `newString` as a string, so `$&`, `$1`, `$$`, `` $` `` and `$'` in the model's replacement text were expanded instead of written literally. A direct probe on the previous expressions returned `a$1-a$1` for `"a-a".replaceAll("a", "$&$1")` and `price total` for `"price".replace("price", "$& total")`.
- Expected: Edit writes `newString` byte-for-byte (for example shell, regex, PHP or template code containing `$&`).
- Root cause: String replacement arguments are replacement templates in JavaScript; only a replacer function is literal.
- Fix: Both runtimes now share `packages/core/src/tool/edit-replace.ts`. Single replacements splice by index and `replaceAll` uses a replacer function. The same change gives native V2 the compatibility fuzzy correction chain and Grok Build's nearest-match and Unicode-typography guidance on misses. An exact multi-match is reported as ambiguous instead of falling through to fuzzier strategies.
- Reproduction: In `packages/apexo`, `bun test test/tool/edit-replace.test.ts` (cases "replaceAll counts replacements and keeps $ patterns literal" and "single replacement keeps $ patterns literal").
- Verification: `bun test test/tool/edit-replace.test.ts` 16/16, `bun test test/v2/edit-fuzzy-native.test.ts` 1/1, `bun test test/tool/edit.test.ts` 29/29; `bun typecheck` in `packages/core` and `packages/apexo` pass.
