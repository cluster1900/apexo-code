# BUG-20261014-115: Cold Location Services Exposed Before Plugin Boot

- **Scope:** Native Location service publication, configured model resolution, agent selection, and Workflow children.
- **Status:** Fixed; focused, rebuilt backend and complete repository unit/type verification passed.
- **Occurrences:** One full-suite observation followed by a deterministic reproduction during the same investigation. Different assertions of that reproduction are not independent recurrences.

## Observed and expected behavior

The full repository unit run failed the native Deep Research integration with `SessionRunnerModel.ModelUnavailableError` for its configured provider/model. An isolated rerun passed, as did a 443-test configuration/plugin/Workflow/native integration combination, so rerunning alone did not explain the failure.

A controlled cold-Location regression, with catalog I/O delayed and schema-validated configuration, reproduced the configured model reported unavailable. Consumers should receive the completed initial configuration and built-in plugin catalog before resolving agents, permissions or models. The test also checks the configured agent's deny rule after initialization.

## Reproduction

From `packages/apexo`, run `bun test test/v2/location-readiness.test.ts --timeout 30000`. The test creates a real Location and configuration, executes the actual plugin boot and catalog transforms, and models catalog I/O latency through the `ModelsDev` service seam. Before the fix, model resolution fails before the configured provider transform commits. The original whole-suite trigger is `GITHUB_ACTIONS=false bun turbo test --concurrency=2` from the repository root.

## Root cause and fix

`PluginInternal` starts its initial transform batch in a scoped fiber. `LocationServiceMap` previously published the constructed services before this fiber completed. The model catalog and agent registry could therefore still contain their empty initial state. Individual handlers that awaited plugin readiness did not protect direct Session execution or Workflow child startup.

The Location service map now awaits the existing `PluginInternal.ready` signal before publishing a Location. This preserves the existing Location lifecycle and configuration snapshot, and covers all consumers without adding model retries, sleeps, or another execution coordinator. External plugin background activity retains its existing separate lifecycle.

## Verification

- The corrected regression failed with the readiness barrier removed, reproducing the same model-unavailable error. Earlier invalid-fixture results are excluded; see [BUG-20261014-116](../test-fixtures/location-readiness-config.md).
- `bun test test/v2/location-readiness.test.ts test/e2e/v2-session.e2e.test.ts test/e2e/v2-goal.e2e.test.ts test/e2e/v2-feedback.e2e.test.ts test/e2e/v2-side-question.e2e.test.ts test/e2e/v2-workflow.e2e.test.ts --timeout 30000` from `packages/apexo`: seven tests and 104 assertions passed.
- `bun typecheck` from `packages/core` and `packages/apexo`: passed.
- Rebuilt CLI and Desktop backend Workflow ownership/lifecycle acceptance: six scenarios each; compatibility bridge: five checks each. These exercise cold native hosts and configured models through actual application backends.
- Frozen-source `GITHUB_ACTIONS=false bun turbo test --concurrency=2`: 3835 passed, 19 skipped, one todo, zero failures and 11990 assertions across 308 files; all six Turbo tasks passed. The earlier 3814-pass/three-failure result is superseded, not reclassified.
- Frozen-source `bun turbo typecheck --concurrency=2`: all 21 tasks passed.

No recurring constraint is promoted from this single investigation.
