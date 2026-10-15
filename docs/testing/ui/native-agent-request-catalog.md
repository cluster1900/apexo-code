# BUG-20261014-126: Native agent request shape prevented selection

- Scope: App normalization of current native agent, provider, and model catalogs.
- Observed: after catalog default compatibility was fixed, the real native-only Goal UI created a Goal but start failed. Native logs rejected an empty `agent` payload. Agent catalog requests themselves returned 200.
- Expected: native agent identifiers remain selectable, and current native request and API fields retain their settings in App controls.
- Root cause: normalization assumed an older client response with `request.settings`, dereferencing its temperature field. Current native agents use `request.body` and `request.headers`. Audit also found older provider/model settings, model API identity, and variant settings assumptions.
- Fix: accept both catalog shapes explicitly. Normalize current request bodies, headers, model API identity/package/URL, and variant bodies while retaining older settings behavior. Existing selection precedence is unchanged.
- Verification: focused current-shape tests passed for agent selection/settings and provider/model API/headers/variants. Typecheck caught readonly fixture permissions and optional variant-body handling; fixtures and normalization were corrected. Final App typecheck passed, and the combined protocol/default/catalog suite passed 8 tests and 18 assertions. The subsequent native browser lifecycle acceptance is recorded below.

- Production browser acceptance: `bun ./script/grok-native-goal-ui.mjs desktop` (from `packages/apexo`, pinned Bun 1.3.14) passed all 7 checks against the actual native-only Core server: passive empty panel, create/start, pause/resume, independent verification, report preview/download, confirmed cleanup, and clear preserving transcript. The fixture verified legacy health returns 404 and native health succeeds. Browser, server, and fixture processes were cleaned up. Native macOS window acceptance is tracked separately pending the refreshed Desktop artifact.

## Native macOS window follow-up

`bun script/grok-native-goal-ui.mjs native` from `packages/apexo` passed all seven checks using the shared built Electron renderer and actual native-only source server after the independent fixture-registration and CORS fixes (BUG-20261014-158 and BUG-20261014-159). The flow covered passive open, create/start, pause/resume, independent verification, report preview/download and confirmed removal, and Goal clear preserving the transcript. The report screenshot was inspected and owned processes were reaped.
