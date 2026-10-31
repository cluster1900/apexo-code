# Stagehand CDP compatibility fallback

## Bug ID

`BROWSER-COMPUTER-USE-002`

## Affected scope

The Core Browser Service provider adapter and the CLI/Desktop `/browser` acceptance flows that attach to an existing Chrome CDP endpoint.

## Observed behavior

The first provider migration used Stagehand's `localBrowser.connect({ cdpUrl })` path for every CDP endpoint. The browser session opened against the test Chrome process, but Stagehand failed before a page could be selected because the endpoint did not implement the `Extensions.getExtensions` CDP method. The CLI acceptance script then waited for the browser action to complete and timed out.

## Expected behavior

Browser Use should prefer Stagehand when the attached Chrome exposes the provider's extension CDP domain. An existing Chrome endpoint that supports ordinary Playwright CDP operations must remain usable through the same Apexo Browser protocol when that optional Stagehand domain is unavailable. The adapter must not launch an unrelated browser or change the public session and action schemas.

## Reproduction

1. Start the repository's Chromium fixture with a CDP endpoint.
2. Run `bun script/browser-slash-ui.mjs cli` from `packages/apexo`.
3. Observe Stagehand's `Method not available` failure for `Extensions.getExtensions` before page selection.

## Root cause

Stagehand loads its bundled extension while connecting to a local browser. The fixture Chromium instance intentionally exposes the normal page, runtime, and input CDP domains but does not expose the optional extension domain. Treating that provider-specific capability as mandatory made a valid existing-CDP session appear unavailable.

## Fix

The Browser Service now has one `PageAdapter` protocol. It first creates a Stagehand session and wraps its Page APIs. When the provider reports the specific `Extensions.getExtensions` or `Method not available` compatibility error, the service closes over the same CDP URL with the third-party `playwright-core` adapter, selects the requested existing page, and continues through the same navigation, accessibility, input, screenshot, stale-target, artifact, and event code. No direct browser automation implementation remains in Core.

## Verification

- Direct Stagehand probe against the fixture endpoint reproduces the provider-specific `Extensions.getExtensions` `Method not available` error.
- `bun script/browser-slash-ui.mjs cli` passes with autocomplete, structured actions, screenshot artifact, durable replay, and the Playwright CDP compatibility adapter.
- `bun script/browser-slash-ui.mjs desktop` passes through the Desktop Playwright flow with the same existing browser endpoint.
- `bun typecheck` from `packages/core` passes after the fallback and provider dependency changes.

## Remaining limitations

Stagehand's richer agent and extension features are available only when the target Chrome exposes the required extension domain. The compatibility adapter intentionally preserves the existing Apexo action contract and does not emulate Stagehand-only features. Provider disconnect detection and semantic target planning remain bounded by the current session protocol.
