# BUG-20261014-116: Invalid Cold-Location Regression Configuration

- **Scope:** The new native Location readiness regression fixture.
- **Status:** Fixed; corrected focused regression passed.
- **Occurrences:** One fixture construction mistake, observed across the initial red/green attempt. Repeated assertions of that mistake are not separate occurrences.

## Symptom and reproduction

The first readiness test omitted the required `capabilities.tools` field from its configured model. Native config decoding ignored the invalid document, so the model remained unavailable even after the readiness barrier. Run `bun test test/v2/location-readiness.test.ts --timeout 30000` from `packages/apexo` to exercise the fixture.

## Expected behavior, root cause and fix

The fixture must supply a valid native configuration before testing boot timing. It now supplies `tools: true` and decodes the complete object with the actual `Config.Info` schema before writing it. Invalid future fixture changes fail at construction instead of imitating a startup race.

The original invalid-fixture failures are withdrawn as evidence of the production race. With the corrected configuration, removing the Location readiness barrier reproduced `SessionRunnerModel.ModelUnavailableError`; restoring the barrier is the separate production fix tracked in [BUG-20261014-115](../runtime/location-plugin-readiness.md).

## Verification

- Corrected configuration, barrier removed: reproduced the model-unavailable failure.
- Corrected configuration, barrier restored: the combined native regression passed seven tests and 104 assertions, including the cold-Location fixture. Core and Apexo package typechecks passed.

No recurring constraint is warranted.
