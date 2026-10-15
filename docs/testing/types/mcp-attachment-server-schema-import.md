# BUG-20261015-331: Server handler imported an undeclared Schema package

- Scope: Native MCP attachment HTTP handler.
- Observed: Server typecheck reported TS2307 for the direct Schema Session ID import.
- Expected: Handler imports resolve through declared package dependencies.
- Root cause: Server did not declare a direct Schema dependency; the draft assumed transitive workspace visibility.
- Fix: Use the existing Core SessionSchema ID export for this Core-consuming handler. The public Protocol contract continues to depend directly on Schema.
- Reproduction: Run `bun typecheck` from `packages/server` with the direct Schema import.
- Verification: Server and Apexo package typechecks pass after the import correction; real pure and mixed HTTP snapshot tests pass.
- Occurrences: One authoring episode.
