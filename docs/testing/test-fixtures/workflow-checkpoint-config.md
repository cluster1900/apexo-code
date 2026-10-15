# BUG-20261014-128: Checkpoint fixture omitted native Location configuration

- Scope: New Workflow checkpoint production CLI fixture.
- Observed: The first checkpoint paused correctly, but its resumed child failed with ModelUnavailable for the fixture model.
- Expected: Native child execution uses the isolated fixture provider configuration.
- Root cause: The new script supplied the legacy environment configuration but omitted the project configuration file used by the native Location catalog. Existing native fixtures explicitly write this file.
- Fix: Write the isolated fixture configuration to its project directory before native Session creation.
- Reproduction: Run `bun script/grok-workflow-checkpoint.mjs cli` from packages/apexo with the earlier fixture.
- Verification: Corrected CLI fixture passed four scenarios and one provider call. No production model-resolution change is attributed to this fixture correction.
- Occurrences: Two observed fixture failure.

## Native Plan CLI fixture

The new native Plan CLI script supplied only the shared fixture's legacy environment configuration. Native Session creation succeeded, but the first drain recorded ModelUnavailable for the local test model and made zero provider requests. The script now writes that same isolated configuration to the workspace project file before the first native Location/Session request, matching the existing native fixtures. No model-resolution or product configuration behavior changed.

Verification: `bun run script/grok-plan-native.mjs cli` from `packages/apexo` passed six checks with eight local-provider requests, including actual App question replies and restart persistence. This is the second independent instance of the same missing native project-configuration fixture prerequisite; the passing run does not reclassify the initial timeout as a runtime fix.
