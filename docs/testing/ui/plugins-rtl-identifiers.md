# BUG-20261014-231: Plugins source identifiers inherited RTL prose direction

- **Type:** UI / bidirectional text
- **Scope:** Plugins trust confirmation, downloaded path, source location, metadata values and source input in RTL locales.
- **Status:** Fixed and verified in the production browser and actual macOS native window.

## Observed and expected behavior

During the five-locale production browser run, the Dhivehi trust confirmation
showed an absolute source path with its leading slash visually displaced to the
right-hand end of the first line. The underlying text still began with `/`.
Translated prose should follow the RTL locale, while paths, Git addresses,
versions and source-entry syntax retain left-to-right identifier order.

## Reproduction and root cause

Select Dhivehi, open Settings → Plugins, download a catalog plugin and choose
Install. Inspect the source path in the trust notice. The inline `code` inherited
the RTL paragraph direction without a bidi isolation boundary. CSS only provided
wrapping, which did not protect punctuation order. The same unisolated identifier
pattern existed in downloaded paths, source locations and metadata.

## Fix

The narrow identifier selectors in `plugins.css` now use `direction: ltr` and
`unicode-bidi: isolate`. This includes the source input, whose values are Git or
filesystem identifiers. Search, headings, descriptions, notices and action labels
retain the locale's direction. No locale-specific branch was added to feature
logic, and no Session/composer source changed.

## Verification

The five-locale fixture now checks computed LTR direction for the source input,
computed LTR/isolate for the confirmation code, the original leading slash, and
RTL direction for adjacent Dhivehi prose. It captures source-entry and trust
screenshots for visual confirmation of ordering and wrapping.

- Before the CSS fix: production browser accepted 13 functional checks across all five locales; screenshot review exposed this issue. Document-wide overflow checks alone did not detect bidi punctuation movement.
- Final production browser: `bun script/grok-native-plugins-ui.mjs desktop --five-locales` from `packages/apexo` passed all 13 checks. All five locales passed input/code direction and isolation checks. Dhivehi retained RTL adjacent prose, and its measured leading slash was at the identifier left edge. Source/trust screenshots confirmed correct ordering.
- Actual macOS native window: from `packages/apexo`, `bun script/grok-native-plugins-ui.mjs native --five-locales` passed all 13 checks, including the additional range-geometry assertion that the leading slash sits at the identifier left edge. All five locale storefront/trust screenshots and Dhivehi source-entry screenshots were inspected. The fixture completed cleanup and exited 0.

See [five-locale localization](plugins-five-locale-fallback.md). Do not count a
functional action pass as visual bidi verification.
