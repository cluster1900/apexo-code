# Profile CLI Session Execution Layer

## BUG-20261014-043 — CLI profile acceptance fails before its provider request

- **Status:** Integrated runtime restored; profile regression verified.
- **Verified recurrence count:** 1.
- **Affected scope:** CLI server prompt admission/execution used by native profile acceptance.
- **Observed behavior:** `prompt_async` accepts a request, but no provider request arrives. The backend records `Die(Error: Unbound layer node: @apexo/v2/SessionExecution)` during the first provider loop. The acceptance fixture times out waiting for its initial Apexo-profile request.
- **Expected behavior:** The CLI can resolve its runtime services and send the selected profile's tool contracts to the provider.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-profile-desktop.mjs`; inspect the fixture backend log after the `PROFILE_CLI_APEXO` timeout.
- **Root cause:** The missing `SessionExecution` binding is confirmed in the backend diagnostic. The specific composition change causing it has not yet been established. This is separate from BUG-20261014-042's open stdin fixture problem.
- **Fix:** The owning Goal/runtime integration restored its service-layer bindings. This profile work did not modify runtime composition; retain the owning integration record for the detailed correction.
- **Verification:** Full `bun script/grok-profile-desktop.mjs` acceptance subsequently passed on Bun 1.3.14, including source CLI provider requests and real native Desktop selection/relaunch. No missing-layer error occurred in that verified snapshot.
