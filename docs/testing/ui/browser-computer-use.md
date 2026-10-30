# Browser and Computer Use regression record

## Bug ID

`BROWSER-COMPUTER-USE-001`

## Affected scope

The Playwright-backed Browser Service adapter, the fixture Computer Use backend, and the CLI/Desktop acceptance scripts for `/browser` and `/computer`.

## Observed behavior

The Browser Service worked in the CLI and Desktop fixture flows, but the Desktop production build failed while bundling `playwright-core` because its Chromium BiDi bridge imports were unresolved. The Computer fixture accepted click, type, press, and scroll actions but returned the same snapshot after every action, so an acceptance test could verify that an event was written without proving that the desktop state changed.

## Expected behavior

The Desktop build must include all runtime modules required by the Playwright CDP adapter. A fixture Computer session must expose a changed snapshot and snapshot hash after a mutating action, allowing CLI and Desktop tests to assert the same observable state transition that a native accessibility backend would produce.

## Reproduction

1. Install the workspace dependencies and run `bun run build` from `packages/desktop` after adding the `playwright-core` Browser adapter.
2. Run `bun run script/computer-slash-ui.mjs cli` with `APEXO_COMPUTER_BACKEND=fixture`.
3. Open a Computer session and issue `/computer type`, `/computer click`, or `/computer press`.
4. Compare the `computer.action_completed` snapshots before and after each action.

## Root cause

`playwright-core` contains a statically reachable Chromium BiDi bridge that requires the `chromium-bidi` package even when Apexo only calls `connectOverCDP`. The workspace did not install that package, so Electron Vite's SSR bundler stopped on the unresolved import. Separately, the fixture snapshot was a constant value and the fixture action branches called `observe()` without carrying any action state forward.

## Fix

Added `chromium-bidi@0.8.0` as a Core runtime dependency alongside `playwright-core`, so the Desktop main bundle can resolve Playwright's CDP support. The fixture Computer service now owns a small mutable fixture state and derives its snapshot hash from the active app, window, and visible text. Fixture click, type, press, and scroll actions update that state before returning the next snapshot. The acceptance script now drives those actions through the actual terminal or Desktop editor and asserts the resulting snapshot text for every action.

## Verification

- `bun typecheck` from `packages/core` passes.
- `bun typecheck` from `packages/app` passes.
- `bun typecheck` from `packages/tui` passes.
- `bun run build` from `packages/app` passes.
- `bun run build` from `packages/desktop` passes after installing `chromium-bidi`.
- `bun run script/computer-slash-ui.mjs cli` passes twice, including autocomplete, type/click/press state changes, screenshot artifact, close, and automatic Computer tool trigger.
- `bun run script/computer-slash-ui.mjs desktop` passes twice through Playwright, including the same state changes and automatic trigger.
- `bun run script/browser-computer-use.mjs cli` and `bun run script/browser-computer-use.mjs desktop` each pass twice while asserting real CDP page input and button output changes.
- `bun run script/browser-slash-ui.mjs cli` and `bun run script/browser-slash-ui.mjs desktop` each pass twice with `/browser` autocomplete, structured actions, screenshots, durable event replay, and Browser child-session routing.
- `bun run test:httpapi` passes all 357 scenarios with 0 failures, skips, missing routes, or extra routes, including the Browser and Computer V2 endpoints.

## Remaining limitations

The Computer fixture models observable state for deterministic tests; macOS production behavior still depends on Accessibility permission and the installed `cliclick` executable. The acceptance provider is deterministic and does not measure live-provider planning quality.

The isolated app slash-route unit harness is currently blocked before test collection by Bun's Solid loader resolving `jsxDEV` from `solid-js/dist/solid.js`; the built Desktop Playwright flow remains green. Generated client and SDK checks regenerate successfully but report the existing uncommitted `parentID` generated diffs until those generated files are committed together.
