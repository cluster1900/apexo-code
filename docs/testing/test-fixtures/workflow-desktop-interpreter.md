# BUG-20261014-064: Direct Desktop backend fixture omitted the interpreter resource environment

- Scope: Production Desktop backend acceptance fixture; actual Desktop startup already sets the resource path.
- Observed: Deep Research completed six native children, but the first saved Rhai run failed with “Apexo workflow script interpreter is not installed,” before reserving or starting children.
- Expected: Direct backend acceptance uses the same staged interpreter resource as the real Electron sidecar launch.
- Reproduction: Run the Workflow Desktop fixture against the rebuilt bundled backend without the sidecar environment injection.
- Root cause: The fixture imports the bundled backend directly in Electron's Node mode and bypasses createSidecarEnv. A relocated bundle has no source-checkout-relative interpreter fallback, and Electron's executable directory does not contain the helper.
- Fix: The fixture's Desktop branch sets APEXO_WORKFLOW_SCRIPT to the staged Desktop resources helper, matching the unpackaged application's createSidecarEnv. Production resolution remains fail-closed. Packaged resource resolution still requires packaging-specific acceptance.
- Verification: `bun script/grok-workflow-native.mjs desktop` from `packages/apexo` passed all five lifecycle scenarios with 11 provider calls after the fixture correction.
- Occurrences: One fixture failure; no change to the product resolver.
