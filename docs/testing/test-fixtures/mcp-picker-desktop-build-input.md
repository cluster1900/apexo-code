# BUG-20261015-339: Private Desktop build omitted the server build prerequisite

- Scope: private MCP picker Desktop validation command.
- Observed: direct `electron-vite build` failed to resolve `virtual:apexo-server`.
- Expected: Desktop bundles the matching Node server artifact before renderer acceptance.
- Reproduction: invoke the direct bundler in a coherent private source checkpoint with no `packages/apexo/dist/node` artifact.
- Root cause: the direct command skipped the normal prebuild server-generation step.
- Fix: run `bun script/build-node.ts` in `packages/apexo` before the direct Desktop bundler, with explicit build metadata and the fixed models snapshot.
- Verification: Node server generation succeeded. The next Desktop bundler reached source transformation, then was intentionally stopped and joined to relieve concurrent-build memory pressure. The subsequent serialized Desktop build completed successfully, including its renderer; actual window acceptance is tracked in the feature document.
