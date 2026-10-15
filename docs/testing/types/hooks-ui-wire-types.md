# BUG-20261014-156: Hooks UI used a decoded domain type for wire data

- Scope: App/TUI Hook snapshot management UI.
- Observed: App typecheck rejected generated snapshot responses because the schema-domain generation is a number while the generated JSON wire type also represents nonfinite values as strings. TUI could not import the Schema package through its declared dependencies. The initial mini PTY also failed loading the new Hooks browser because its package subpath was not exported.
- Expected: UI state and action contracts accept the generated snapshot response, and the mini terminal resolves the shared browser through the TUI package export.
- Reproduction: run App/TUI `bun typecheck` using `typeof HostHooks.Snapshot.Type` for SDK response state; run `bun script/grok-hooks-tui.mjs` from `packages/apexo` before adding the browser's package export.
- Root cause: the UI used the decoded domain representation at a generated SDK wire boundary. The shared browser's new public subpath was omitted from the explicit TUI package export map.
- Fix: use generated `HostHooksSnapshot` response types in App/TUI state and action contracts, and export `component/hooks-browser` through the existing package map.
- Verification: App and TUI `bun typecheck` passed after switching to the generated response type. The first mini PTY failure is recorded rather than counted as acceptance; after the package export and separately recorded footer-height correction, mini and fullscreen PTY acceptance each passed seven checks.

## Related package export evidence

The package-subpath omission is distinct from this record's wire-type diagnostics. The original Hooks browser and the Feedback export diagnostics in [BUG-20261014-044](feedback-ui-wire-types.md) document two authored export omissions. The later Memory integration produced the same module-resolution symptom, but its private implementation already contained the export: its handoff traversal omitted package manifests. That different packaging cause is recorded in [BUG-20261015-323](../test-fixtures/memory-operation-handoff-manifest.md), not counted as a third occurrence here. No recurring constraint is justified by that symptom alone.
