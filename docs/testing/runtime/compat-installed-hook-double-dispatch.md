# BUG-20261014-171: Compatibility dispatched installed hooks twice

- **Status:** Fixed and verified.
- **Scope:** Compatibility `HostHookSnapshot` after native installed bundle sources were added to shared captured registries.
- **Observed:** The new regression wrote `PPH`: the installed plugin's UserPromptSubmit hook ran twice and the host hook ran once. Expected trace: `PH`.
- **Expected:** Compatibility dispatches an installed hook once through its existing ordinary plugin loader; the snapshot adapter dispatches only host sources. Native consumers retain installed sources in their immutable captured registry.
- **Reproduction:** In `packages/apexo`, run `GITHUB_ACTIONS=false bun test test/plugin/host-hook-snapshot.test.ts`. The fixture installs a real local bundle through PluginStore, loads its ordinary hooks through `loadBundleHooks`, captures installed and host sources, then invokes both compatibility paths.
- **Root cause:** Both the ordinary installed-plugin loader and the compatibility snapshot adapter consumed installed sources after the shared native registry gained those sources.
- **Fix:** Filter to `source.host` at the compatibility adapter boundary, without modifying the shared registry or native dispatch.
- **Verification:** Before the filter, two existing tests passed and the new test failed with `PPH` instead of `PH`. After the filter, `GITHUB_ACTIONS=false bun test test/plugin/host-hook-snapshot.test.ts test/v2/plugin-runtime-guard.test.ts test/v2/plugin-bundle-runtime.test.ts` passed 10 tests and 47 assertions, including the `PH` trace and both sources retained in the native registry. Core and Apexo package typechecks exited 0.

This is one observed occurrence. The compatibility installed-plugin loader retains its existing Instance lifecycle; this fix does not claim that compatibility installed bundles adopt native per-Session snapshot reload semantics.
