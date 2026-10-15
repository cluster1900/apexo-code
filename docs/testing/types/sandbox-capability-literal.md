# BUG-20261015-067: Frozen sandbox capability widened its private brand

- **Scope:** Off-tree native command sandbox Core draft; no released runtime failure.
- **Observed:** The first package typecheck rejected `Object.freeze({ [capability]: true })` because the inferred symbol property was `boolean`, while the opaque capability requires the literal `true`.
- **Expected:** The private frozen capability satisfies its deliberately narrow brand without weakening the exported interface.
- **Root cause:** The object argument's property widened before the `Object.freeze` result was assigned to the annotated capability.
- **Fix:** Preserve the literal at construction with `true as const`. Keep the private symbol and WeakMap authority unchanged.
- **Reproduction:** Run `bun typecheck` in `packages/core` with the original capability construction.
- **Verification:** The corrected isolated Core package typecheck completed successfully. The earlier failing diagnostic is retained in the authoring evidence; no runtime behavior or integration gate is inferred from a typecheck alone.
- **Occurrences:** One draft typecheck episode; no recurring constraint promoted.
