# BUG-20261112-006: Explicit local compatibility review failed during bootstrap

- Scope: F01 CLI dispatch into the existing generic headless runner.
- Observed: `review --session-protocol compatibility` failed with `--session-protocol requires --attach; local terminal bootstrap uses compatibility` before reaching the generic review provider.
- Expected: explicit compatibility review retains its generic target prompt, plain-text export and ephemeral cleanup.
- Reproduction: run the compatibility top-level review case in `bun test test/cli/run-review-options.test.ts` from `packages/apexo`.
- Root cause: the generic runner's local bootstrap represents compatibility with its `auto` selector, and rejects an explicit non-auto selector without an attached server. The new review dispatcher forwarded the public selector unchanged.
- Fix: translate explicit local compatibility into that existing internal bootstrap representation, while leaving guardrail rejection and attached-server protocol selection intact.
- Verification: `bun test test/cli/run-review-options.test.ts test/cli/code-review.test.ts` from `packages/apexo` passed 8 tests and 54 assertions, including the explicit compatibility review and default native review. The dedicated native CLI suite is separately covered in `structured-review-fixtures.md`.

The previous default-review fixture asserted the old generic implementation. It now explicitly selects compatibility, while the new native CLI fixture covers the new default behavior. Native local review resolves its default directory from the actual process cwd, so an inherited stale `PWD` cannot redirect capture.

## BUG-20261112-026: Compatibility priority rejection named an absent flag

- Scope: CLI argument diagnostics.
- Observed: `review --session-protocol compatibility --fail-on P1` reported a conflict with `--output-schema` even when that flag was absent.
- Expected: explain that priority thresholds require native structured review and conflict with the selected compatibility mode.
- Reproduction: run that command before any provider work.
- Root cause: both compatibility dispatch branches shared the output-schema-specific message.
- Fix: choose the error message from the actual compatibility selector.
- Verification: the CLI/compatibility command passes eight tests / sixty assertions; the explicit case asserts the compatibility selector is named and `--output-schema` is absent.
