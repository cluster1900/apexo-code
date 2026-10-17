# Legacy SDK types stale after media config fields

- Bug ID: BUG-20261018-389
- Scope: `packages/sdk/js/src/v2/gen/types.gen.ts` (legacy JavaScript SDK `Config` type)
- Observed: the committed legacy SDK lacked `grok_media.image_gen_model_override`, `image_edit_model_override`, `disable_zdr_incompatible_tools`, `team_blocked_reasons`, `zdr_video_output_s3.zdr_only`, and the same ZDR fields under `media`, although `packages/core/src/config/media.ts` defines them (BUG-20261017-388 media policy work). Running the repository test graph (`apexo#test` depends on `^build`) rewrote the file, leaving the worktree dirty.
- Expected: committed generated output matches the source schema.
- Reproduction: on a clean checkout run `GITHUB_ACTIONS=false bun turbo test --concurrency=2`, then `git status`.
- Root cause: the legacy SDK was not regenerated after the media config schema changed; `check:generated` only covers `packages/client`.
- Fix: committed the regenerated output (`./packages/sdk/js/script/build.ts` path via `^build`).
- Verification: all 21 typecheck tasks pass; `bun run check:generated` in `packages/client` passes.
