# BUG-20261015-160: Native terminal dependency was locked but not installed

- **Scope:** Shared native CLI integration and its local validation environment.
- **Independent occurrences:** One integration episode; type diagnostics and the test import failure share this cause.
- **Observed:** The workspace typecheck reported TS2307 for `@apexo/schema/permission` and `@apexo/schema/question`; the native transport test file could not load the same dependency. Other dependent diagnostics followed from those missing imports.
- **Expected:** TUI's declared direct Schema dependency resolves to the actual workspace package before validation.
- **Reproduction:** Apply the native terminal package manifest and run `bun install --lockfile-only --ignore-scripts`, then run the affected checks without materializing the new dependency link.
- **Root cause:** Lockfile-only installation updated the workspace dependency record but did not create the absent `packages/tui/node_modules/@apexo/schema` link. The package manifest itself declared the correct dependency. This was not stale source or a product type-contract defect.
- **Correction:** Run pinned Bun's `bun install --frozen-lockfile --ignore-scripts` from the repository root and verify the dependency resolves to `packages/schema`. The lockfile still differs from its previous candidate only by TUI's Schema workspace entry. No source casts or import-path workarounds were added.
- **Verification:** The corrected `bun turbo typecheck --concurrency=2` passed all 21 workspace tasks. The combined eleven-file Memory and terminal regression passed 96 tests / 371 assertions, including the previously unloadable transport file. The unrelated Memory-context timeout is tracked in [BUG161](../test-stability/native-memory-context-timeout.md).
