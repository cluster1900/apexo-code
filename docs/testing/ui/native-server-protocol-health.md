# BUG-20261014-123: App classified the native-only server as legacy

- Scope: App server protocol detection and protocol-specific management panels.
- Observed: an actual isolated production native router returned 404 from `/global/health` and 200 with `{healthy:true}` from `/api/health`; the App detector returned `v1`.
- Expected: absence of legacy health plus a successful native health response selects V2 APIs.
- Reproduction: serve `packages/server/src/routes.ts` through its production web handler, then call the App's real `detectServerProtocol` with that loopback URL. The probe uses isolated state and disposes its server.
- Root cause: the detector recognizes an older native `pid` response as V2, but maps the current native `healthy:true` response back to V1.
- Fix: applied after the shared source freeze; change the native healthy response branch to V2 while retaining the successful legacy health branch as V1. Goal controls and reports now use the selected protocol API.
- Verification: original production detector reproduced the mismatch. Real socket regression tests passed for legacy, current native, and historical native health (3 tests, 6 assertions); App typecheck passed. The subsequent native Goal browser acceptance is recorded below.

- Production browser acceptance: `bun ./script/grok-native-goal-ui.mjs desktop` (from `packages/apexo`, pinned Bun 1.3.14) passed all 7 checks against the actual native-only Core server: passive empty panel, create/start, pause/resume, independent verification, report preview/download, confirmed cleanup, and clear preserving transcript. The fixture verified legacy health returns 404 and native health succeeds. Browser, server, and fixture processes were cleaned up. Native macOS window acceptance is tracked separately pending the refreshed Desktop artifact.

## Native macOS window follow-up

`bun script/grok-native-goal-ui.mjs native` from `packages/apexo` passed all seven checks using the shared built Electron renderer and actual native-only source server after the independent fixture-registration and CORS fixes (BUG-20261014-158 and BUG-20261014-159). The flow covered passive open, create/start, pause/resume, independent verification, report preview/download and confirmed removal, and Goal clear preserving the transcript. The report screenshot was inspected and owned processes were reaped.
