# RULE-20261015-005: Preserve coherent private validation snapshots

- **Status:** Active.
- **Scope:** Off-tree package/workspace validation overlays.
- **Source:** [BUG-20261015-053](../testing/test-fixtures/hooks-preference-private-workspace.md), seven independent overlay-construction failures.
- **MUST:** Copy package sources and the matching package manifests/exports from one coordinated stable checkpoint. Preserve the distinction between actual workspace packages and intentionally vendored dependencies.
- **MUST:** Remap symlinks that resolve to copied workspace packages into the private tree. Keep vendored dependency targets as vendored dependencies; a matching `@apexo` name alone does not make them workspace packages.
- **MUST:** When refreshing an overlay, retain only explicitly owned edits and compose shared-file hunks onto the fresh baseline. Do not combine new consumers with stale unowned schemas, exports or implementations.
- **Verification:** Canonicalize and audit resolved dependency targets, including actual runtime package entrypoints; textual absolute-path comparisons can miss aliases. Typecheck affected packages and exercise the real package-import entrypoint when a feature uses an exported module. Absolute-path component tests alone do not verify package exports. Record the owned-file baselines and exclude privately generated outputs from an integration handoff unless generation itself is explicitly owned.
- This rule addresses demonstrated mixed-revision and dependency-identity failures. It does not infer that every timeout or tool failure is caused by an overlay.
