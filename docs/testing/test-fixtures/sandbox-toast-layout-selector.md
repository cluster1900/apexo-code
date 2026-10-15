# BUG-20261015-100: Sandbox error assertion selected the wrong toast layout

- **Scope:** Browser and native-window sandbox acceptance fixture.
- **Status:** Corrected and verified.
- **Independent occurrences:** One fixture-authoring episode.
- **Observed:** The post-repair screenshot showed the correct single Session-creation error, but the title query returned an empty array and failed its assertion.
- **Expected:** Inspect the actual active toast implementation and reject the redundant prompt-send error in either App layout.
- **Reproduction:** Run `bun script/grok-native-sandbox-ui.mjs browser --locales` from `packages/apexo` with the V2 App layout and a deliberate creation HTTP 503.
- **Root cause:** The fixture selected only legacy Kobalte `toast-title` slots. V2 uses Sonner's `data-title` inside `.toast-v2`.
- **Fix:** Query both actual title selectors. Require the localized creation title and prohibit the generic prompt-send title.
- **Verification:** The corrected assertion detected the duplicate toast in the preserved pre-fix production artifact. Both repaired browser and rebuilt actual native-window runs passed seven checks / three provider calls, with successful process cleanup. The earlier selector failure does not itself prove BUG095; the actual duplicate-toast screenshot and production fallthrough establish that separate defect.
