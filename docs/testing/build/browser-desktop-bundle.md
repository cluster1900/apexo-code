# Desktop Browser Bundle Acceptance Record

## Bug ID

`DESKTOP-BROWSER-BUNDLE-001`

## Affected scope

The Desktop sidecar bundle used by `packages/apexo/script/grok-shell-fixture.mjs` and the Browser HTTP API.

## Observed behavior

The first Desktop Browser acceptance run returned `404 Not Found` for `POST /api/session/:sessionID/browser` while the same source passed through the CLI server.

## Expected behavior

Desktop and CLI must expose the same Server HTTP API for a Session, including the Browser endpoints.

## Reproduction

1. Start the Desktop fixture with `bun script/browser-computer-use.mjs desktop` after changing the Server source.
2. Call the Browser open endpoint.
3. Observe the stale sidecar response `404 Not Found`.

## Root cause

Desktop bundles `packages/apexo/dist/node/node.js` through the `virtual:apexo-server` alias. The checked-out source had changed, but the packaged node bundle and Desktop output still contained the previous API surface.

## Fix

Rebuilt the node bundle and Desktop output before acceptance. The repository prebuild wrapper is gated on Bun 1.4.4 while this environment has Bun 1.3.14, so the verification used the equivalent direct `Bun.build` node command and `electron-vite build`.

## Verification

`bun script/browser-computer-use.mjs desktop` passes after rebuilding. The test uses the real Desktop worker, Playwright Chromium, an external CDP port, and the Browser open/observe/type/click/screenshot/events/close flow.

## Remaining limitations

The Bun version mismatch remains an environment limitation for the full `bun run build` wrapper. It does not block the generated Desktop bundle or the acceptance result in this workspace.
