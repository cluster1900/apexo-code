# BUG-20261031-001: Browser and Computer provider resources outlived failed runs

## Affected scope

The Core Browser and Computer services used by the V2 CLI, TUI, Desktop, and HTTP API routes.

## Observed behavior

Browser CDP connections were retained by the service until an explicit close request. The Browser service had no scope finalizer, so an open browser session could keep a Stagehand or Playwright CDP connection alive after the owning Location was disposed. A failed initial navigation or page snapshot could also leave a connected browser behind the failed request. Computer startup had equivalent partial-resource paths: a Cua reader could fail after the driver started, Lume readiness could fail after a sandbox was created, and a runtime that resolved after the startup timeout had no owner to close it.

## Expected behavior

Every Browser or Computer provider resource must have one service-owned cleanup path. Explicit close, failed open, provider startup failure, startup timeout, and Location disposal must release the underlying browser connection, Cua sessions, or Lume sandbox. A failed request must not leave an entry that retains provider resources in the in-memory session map.

## Reproduction

1. Start the V2 server with the Browser or Computer HTTP API enabled.
2. Repeat provider opens, including invalid CDP endpoints and provider startup failures.
3. Close only some successful sessions, then dispose the owning Location or server.
4. Inspect provider processes, CDP targets, and the service session map after the request sequence.

## Root cause

Browser sessions were stored in a Location-scoped map without a finalizer. Browser close started the asynchronous connection close without joining it, and Browser open did not close a connection when the first page state failed. Computer startup did not clean partially initialized Cua/Lume resources, and a timeout interrupted the Effect wrapper while the underlying provider promise could still resolve later.

## Fix

- Register a Browser service finalizer that closes every remaining connection before clearing the session map.
- Make Browser close remove the map entry before awaiting idempotent connection cleanup.
- Close Browser connections on initial page-state failure and on all Stagehand/Playwright fallback setup failures.
- Clean up partially initialized Cua driver/reader sessions and Lume sandboxes.
- When Computer startup times out, attach cleanup to the still-running provider promise so a late runtime is closed.
- Remove Computer session-map entries before provider shutdown and remove failed observation runtimes after cleanup.
- Keep per-session Browser directory routing metadata bounded by deleting it on session deletion and directory disposal.
- Keep the new-session `/browser` command separate from the live-session command so route transitions cannot shadow structured Browser actions.

## Verification

- `bun typecheck` from `packages/core` passed.
- `bun typecheck` from `packages/app` passed.
- `bun typecheck` from `packages/apexo` passed.
- `bun run build` from `packages/app` passed.
- `bun run build` from `packages/desktop` passed, rebuilding the Electron sidecar used by the Desktop acceptance fixture.
- `bun script/browser-slash-ui.mjs cli` passed with Browser autocomplete, CDP actions, screenshot artifact, main-session routing, and close.
- `bun script/browser-slash-ui.mjs desktop` passed with structured `/browser open`, CDP actions, screenshot artifact, main-session routing, and close.
- `bun script/computer-slash-ui.mjs cli` passed with manual and automatic Computer Use, mutation, screenshot, and close.
- `bun script/computer-slash-ui.mjs desktop` passed with the same checks.
- Browser-focused HTTP API exercise passed 6/6 scenarios; Computer-focused HTTP API exercise passed 5/5 scenarios.
- Three repeated CLI Browser and Computer acceptance runs completed before the UI routing fix, and post-run process inspection found no residual Apexo acceptance, Electron, or provider test processes.
- A final sequential CLI/Desktop Browser and Computer acceptance pass completed after the routing and directory-cache fixes; every run reported autocomplete and the expected Browser/Computer mutation evidence.
- The targeted Solid unit test could not start because the current Bun/Solid test fixture resolves `solid-js/dist/solid.js` without the `jsxDEV` export; production builds and the Playwright-backed acceptance scripts still pass.

## Remaining limitations

The provider SDKs own some subprocess and browser internals beyond Apexo's direct control. Cleanup is therefore best-effort when an upstream shutdown call itself fails; the service still drops its owning map entry and reports the provider failure instead of retaining the resource indefinitely.
