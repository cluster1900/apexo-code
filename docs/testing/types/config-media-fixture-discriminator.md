# BUG-20261015-211: Media configuration fixture widened its output discriminator

- **Status:** Corrected; Apexo package typecheck and all 36 configuration tests pass.
- **Scope:** The added media alias regression in `packages/apexo/test/config/v2-compat.test.ts`. One test-authoring episode; the two assertion diagnostics share one cause.
- **Observed:** The repository typecheck passed 20 packages and failed Apexo with two TS2769 diagnostics. The expected media object inferred `video_output.type` as `string`, which is incompatible with the canonical `provider | s3` discriminator.
- **Expected:** The fixture should preserve the actual provider literal without weakening the production configuration schema or typed assertions.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the unannotated mutable expected media object. The runtime configuration tests pass, but both typed object comparisons fail compilation.
- **Root cause:** The nested discriminator widened before the object reached the typed assertion. This is a fixture typing defect, separate from the runtime alias normalization defect in [BUG-20261015-206](../runtime/config-media-attachment-alias.md).
- **Fix:** Preserve `"provider" as const` at fixture construction. Leave production schema validation and the existing snapshots unchanged.
- **Verification:** From `packages/apexo`, `bun typecheck` exited zero. `bun test test/config/v2-compat.test.ts` passed 36 tests / 112 assertions with exit zero. This fixes the sole package failure in the preceding 21-package type gate; a later complete gate remains separate evidence.
