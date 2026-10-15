# BUG-20261015-323: Memory handoff traversal omitted its modified package manifest

- Scope: Private-to-shared native Memory operation UI integration.
- Observed: The 35-file handoff included `MemoryOperations` and its mini consumer, but the shared workspace type gate failed with `TS2307` for `@apexo/tui/component/memory-operations`.
- Expected: A handoff includes every required source and package export amendment used by its successful private validation.
- Reproduction: Apply the frozen 35-file manifest to the matching shared baseline and run the workspace type gate. App/TUI components compile, but the Apexo consumer cannot resolve the new subpath.
- Root cause: The freeze traversal included `src`, `script` and `docs` paths but excluded package manifests. The private `packages/tui/package.json` contained the export, which explains its successful private types and mini runs. A subsequent checkpoint audit found no other changed package manifest, TypeScript configuration or lockfile omitted from that handoff.
- Fix: Add the exact `component/memory-operations` export to the shared explicit TUI map. Future handoff inventories must compare all tracked/untracked source, manifest and configuration paths against their baseline, then exclude artifacts explicitly; they must not select only familiar source directories.
- Verification: The corrected shared workspace type gate passes all 21 tasks, with 19 cache hits. The first gate failed and is not reclassified as passing. Actual shared source mini/fullscreen at both sizes and rebuilt Desktop mini/fullscreen at 80×24 each pass nine checks / three provider calls.
- Recurrence: One verified packaging episode. Earlier authored TUI export omissions have a different cause; see [BUG-20261014-156](../types/hooks-ui-wire-types.md). No three-occurrence rule is created.
