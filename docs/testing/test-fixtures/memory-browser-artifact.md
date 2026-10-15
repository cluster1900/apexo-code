# Memory Browser Fixture Used an Outdated Web Build

- **Bug ID:** BUG-20261015-019
- **Scope:** Production-browser acceptance artifact preparation.
- **Status:** Corrected and verified; no product logic change.
- **Independent occurrences:** 1.

## Observed and expected behavior

The historical-ownership browser fixture received a completed conflict but showed
the old generic retry message instead of the new guidance. Its bounded wait failed.
The native Desktop renderer contained the new localization key, while
`packages/app/dist` did not. The browser fixture serves that separate web output.
It must use a web build produced after the App source change.

## Reproduction and root cause

After changing `MemoryWorkDialog`, build only `packages/desktop`, then run
`bun script/grok-memory-owner-ui.mjs cli` from `packages/apexo` while an older
`packages/app/dist` remains. Desktop compilation rebuilds its own renderer and
does not refresh the web artifact served by this fixture. The failed screenshot
and captured dialog text show the generic conflict message.

## Correction and verification

Run `bun run build` from `packages/app` before production-browser acceptance;
continue to build Desktop separately for its packaged renderer/backend. No
assertion or production message was weakened.

After the web build, the unchanged browser fixture passed six checks across
English, Simplified Chinese and Traditional Chinese. The actual Desktop window
also passed six checks using its rebuilt renderer and backend. Both verified
zero extraction calls and unchanged historical ledger/notes. All owned processes
were reaped, and the localized message screenshots were inspected.
