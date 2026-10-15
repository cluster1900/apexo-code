# BUG-20261014-232: Gurmukhi Punjabi selects right-to-left layout

- Type: UI / localization
- Status: Verified in production browser and actual native window.
- Scope: App shared language direction, including Plugins storefront.

## Observed and expected behavior

The `pa` dictionary contains Gurmukhi Punjabi, but `RTL_LOCALES` includes `pa`.
Selecting Punjabi therefore requests an RTL application layout. Gurmukhi Punjabi
must use LTR; Arabic-script Punjabi is a separate locale/script variant.

## Reproduction

1. Select Punjabi in the App language settings.
2. Inspect the document direction and the Plugins panel direction.
3. Compare the Gurmukhi dictionary with the selected RTL layout.

Source inspection confirmed the mismatch. Corrected rendering is verified in
both production browser and actual native window.

## Root cause

The shared direction table assigns RTL to the language code without matching the
script actually used by its dictionary. Unicode CLDR maps `pa` to `pa_Guru_IN`;
`pa.xml` inherits the root LTR orientation. `pa_Arab.xml` explicitly selects RTL.

- [CLDR likely subtags](https://github.com/unicode-org/cldr/blob/main/common/supplemental/likelySubtags.xml)
- [CLDR Punjabi](https://github.com/unicode-org/cldr/blob/main/common/main/pa.xml)
- [CLDR root orientation](https://github.com/unicode-org/cldr/blob/main/common/main/root.xml)
- [CLDR Arabic-script Punjabi](https://github.com/unicode-org/cldr/blob/main/common/main/pa_Arab.xml)

## Fix

Remove `pa` from the shared RTL set. Preserve Arabic, Urdu, Persian and Dhivehi RTL.
No new locale or script selection behavior is introduced.

## Verification

Static locale audit passed 54 locales / 594 activation values. App
`bun typecheck` passed. From `packages/apexo`, both commands passed 62 checks:

- `bun script/grok-native-plugins-ui.mjs desktop --activation-locales`
- `bun script/grok-native-plugins-ui.mjs native --activation-locales`

Both runs assert computed document and activation-prose direction, exact
interpolation and no horizontal overflow. Punjabi selects LTR; Arabic, Persian
and Urdu retain RTL. Screenshots of the Gurmukhi Plugins panel were reviewed.
The pre-existing Punjabi dictionary has Arabic-script strings outside Plugins;
this correction matches the Gurmukhi Plugins corpus and CLDR default script,
not a claim of complete Punjabi dictionary consistency.
