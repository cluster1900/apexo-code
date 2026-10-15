# BUG-20261014-233: MCP acceptance assumes the opt-in status trigger is visible

- Type: Test fixture / UI setup
- Scope: `packages/apexo/script/grok-native-mcp-ui.mjs`
- Status: Verified in production browser and actual native window.

## Observed and expected behavior

The first production browser run completed native connection controls and
failure recovery in the MCP dialog, then could not find the Status button.
A fresh profile intentionally defaults `general.showStatus` to false. The
fixture must enable this user preference before testing the status popover.
This was not a missing MCP control or a production visibility regression.

## Reproduction and root cause

Run `bun script/grok-native-mcp-ui.mjs desktop --locales` from `packages/apexo`
with a fresh isolated profile and an unconditional Status-button lookup.
The fixture assumed the opt-in header action was enabled by default.

## Fix

Open General settings through the real UI, turn on Show status, close settings,
and then exercise both MCP entry points. Do not change the application default
or pre-populate a fabricated component state.

## Verification

The corrected production browser command passed ten checks, including both
entry points in en/zh/zht. The actual native-window command also passed ten checks with en/zh/zht, and
owned processes were reaped. Earlier
native action PTYs and actual mini/fullscreen compatibility terminals already
passed their separate control checks; those do not verify this browser setup.
