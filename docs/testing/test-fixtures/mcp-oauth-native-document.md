# BUG-20261015-068: OAuth Native Fixture Assumed a Browser Session URL

- Status: integrated and verified. Corrected native and browser fixtures each passed nine checks.
- Occurrences: one fixture authoring episode.
- Scope: native MCP OAuth acceptance after connecting the rebuilt Electron renderer to its isolated backend.

## Observed and expected behavior

The production renderer loaded the fixture Session and its settings controls, but
the test stopped before any authentication action because no CDP tab URL contained
`/session/`. The retained screenshot showed the intended Session. A native
renderer should be identified independently of its internal navigation route.

## Root cause and correction

The browser fixture reused its pathname-based tab lookup for Electron. Desktop
keeps the Session route inside its renderer rather than exposing it as the
document URL. The fixture now captures the current document URL before consent,
requires exactly one matching tab, and retains that tab's stable CDP target ID.
It never guesses consent-tab order. This is separate from BUG-20261015-065, where
the correct browser tab existed but the fixture remained focused on consent.

## Verification

From `packages/apexo`, run
`bun script/grok-native-mcp-oauth-ui.mjs native --locales` and the `browser`
variant. The original native run failed on `owned app tab identity` with no
completed OAuth checks. The corrected native run passed nine checks across both entrypoints and all
three locales; the browser rerun also passed nine. All six localized native
screenshots were inspected. See [the feature notes](../../native-mcp-oauth-feature.md). No product code changed,
and no recurring-rule promotion is claimed.

Integrated verification on 2026-10-15: Corrected native and browser fixtures each passed nine checks. Reproducible commands and evidence limits are recorded in [native MCP OAuth](../../native-mcp-oauth-feature.md). This does not add another occurrence.
