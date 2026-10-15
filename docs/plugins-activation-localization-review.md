# Plugins Activation Localization Review

## Scope and status

The scope is the eleven `plugins.activation.*` values in 54 existing locales: 594
complete phrases. The original 41 storefront values, English source, Chinese
variants and the completed Faroese, Dhivehi, Turkmen, Amharic and Dzongkha bodies
are outside this edit. These are engineering translations supported by source
review, not native-speaker sign-off. All 594 values are applied. Static coverage and placeholder checks passed;
production browser acceptance passed 62 checks including all 54 locales.
Actual native-window acceptance also passed the same 62 checks.

The semantic review preserves four distinctions: enabling a plugin does not
apply it to a project; applying changes affects that project; work already
running keeps its snapshot; invalid, load and unsupported failures preserve the
previous active snapshot. `{{generation}}` remains an unchanged interpolation
identifier. The unsupported explanation names no component, so it remains true
when a server's capabilities change.

## Source review

The review uses existing locale terminology, maintained [Firefox add-on
management](https://github.com/mozilla-l10n/firefox-l10n), Firefox developer-tools
`memory.properties`, [KDE Discover](https://github.com/KDE/discover/tree/master/po),
[VS Code](https://github.com/microsoft/vscode-loc), and, where KDE is absent,
[MediaWiki](https://github.com/wikimedia/mediawiki/tree/master/languages/i18n).
Sources were inspected for complete failure and action instructions as well as
terms. English fallback, empty translations and fuzzy or obsolete PO entries
were excluded as translation evidence. A retrieved file is not proof that every
entry in it is translated or correct: for example, one Bengali Firefox
incompatibility message has reversed polarity and was not reused.

[Microsoft localization style guides](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides)
were retrieved for 51 of the 54 locales. Selected pronoun, imperative, error and
punctuation sections informed the review. Existing Apexo tone takes precedence
where product guidance differs. The index did not offer Lao, Sinhala or Tajik
at review time. The guides identify language-specific normative references;
this does not mean every external dictionary they cite was independently read.

Direct authority checks included:

- [Duden: Momentaufnahme](https://www.duden.de/rechtschreibung/Momentaufnahme), for German spelling and feminine agreement.
- [Bokmålsordboka: øyeblikksbilde](https://ordbokene.no/bm/42946), for Norwegian form and neuter agreement.
- [Latvian National Terminology Portal: momentuzņēmums](https://termini.gov.lv/kolekcijas/16/skirklis/107091), for the stored-state term.
- [Czech Language Institute: aktivní](https://ssjc.ujc.cas.cz/search.php?heslo=aktivn%C3%AD&hsubstr=no), for active-state wording.
- [Fran: posnetek](https://fran.si/iskanje?IsAdvanced=True&Query=posnetek), for Slovenian noun form.
- [Bulgarian Language Institute: активен](https://ibl.bas.bg/rbe/lang/en/%D0%B0%D0%BA%D1%82%D0%B8%D0%B2%D0%B5%D0%BD), for active-state wording.
- [Gramota: конфигурация](https://gramota.ru/poisk?dicts%5B0%5D=42&mode=slovari&query=%D0%BA%D0%BE%D0%BD%D1%84%D0%B8%D0%B3%D1%83%D1%80%D0%B0%D1%86%D0%B8%D1%8F&simple=0), for Russian spelling and feminine agreement.
- [Macedonian official dictionary: конфигурација](https://makedonski.gov.mk/corpus/l/konfiguracija-zh), for configuration spelling and feminine agreement.
- [Centre for the Greek Language](https://www.greek-language.gr/greekLang/modern_greek/tools/lexica/triantafyllides/search.html?dl=%CE%9F42&page=28), for στιγμιότυπο and neuter agreement.
- [Dewan Bahasa dan Pustaka: aktif](https://prpm.dbp.gov.my/Cari1.aspx?d=105584&keyword=aktif), including the derived activation noun pengaktifan.
- [Ukrainian orthography](https://mon.gov.ua/osvita-2/zagalna-serednya-osvita/ukrainskiy-pravopis), alongside the existing dictionary's проєкт spelling.

Other authority searches did not consistently yield readable term entries.
The Sinhala Dictionary Office and Tajik language committee were located, but
index visibility alone was not counted as verification of snapshot terminology.
The Sinhala ICT glossary's extracted text has font-mapping corruption and its
rendered PDF could not be fetched, so those apparent spellings were not copied.
A Lao education download index was discoverable but could not be opened.
These limits remain review work; they are not claims that no authoritative
resources exist.

## Language groups and terminology decisions

| Group | Locales | Review focus |
| --- | --- | --- |
| Western and Northern Europe | de fr es br it ca nl da no sv fi is | Existing plugin names, informal/formal address, snapshot gender and compounds; `br` is Brazilian Portuguese, not Breton. Dutch retains `plug-in`; Icelandic retains `tengiforrit`. |
| Slavic | pl cs sk sl hr bs sr bg mk ru uk | Noun/adjective agreement, aspect and negative failure sentences; Serbian uses Cyrillic; Ukrainian retains проєкт. |
| Baltic and other European | et lt lv el ro sq hu | Existing polite address where applicable, case endings and stable snapshot names. |
| West/Central Asian | ar fa ur az tr uz tg hy ka | Enabled versus project-active semantics, Arabic-script punctuation/joining, Armenian and Georgian prose, Cyrillic Tajik. |
| South/Southeast/East Asian | bn hi ne pa si id ms vi th km lo my ja ko mn | Complete instructions, native script integrity, deliberate technical borrowings, conservative state-copy descriptions where snapshot terminology is unsettled. |

Firefox supports instantané, instantánea, istantanea, instantània, momentopname,
snímek, posnetek, snimka/snimak, снимок, знімок, στιγμιότυπο, instantaneu,
pillanatkép, momentinė kopija, momentuzņēmums and Armenian ճեպապատկեր in
snapshot UI. It also uses borrowed snapshot forms in Brazilian Portuguese,
Danish, Bengali, Hindi, Nepali, Punjabi, Indonesian, Malay, Thai, Japanese and
Korean. Borrowing a technical noun does not leave the surrounding English
sentence untranslated. Finnish tilannevedos and Turkish anlık görüntü were also
cross-checked in current [Apple Numbers documentation](https://support.apple.com/fi-fi/guide/numbers-ipad/tandce4782b0/ipados)
and [Microsoft configuration snapshot documentation](https://learn.microsoft.com/tr-tr/azure/azure-app-configuration/howto-create-snapshots).

The translation of a runtime snapshot is not an instruction to take a screen
capture. Some older developer corpora use screenshot-like wording; the drafts
prefer an established state term or an explicit state-copy description instead.
Native-speaker review should focus on those descriptions in Azerbaijani, Uzbek,
Tajik, Georgian, Khmer, Lao, Burmese and Mongolian, plus Sinhala technical
register and regional Bengali/Nepali usage. No machine-generated fallback is
counted as completed translation.

## Direction and verification plan

[CLDR likely subtags](https://github.com/unicode-org/cldr/blob/main/common/supplemental/likelySubtags.xml)
maps `pa` to Gurmukhi Punjabi. The existing App `pa.ts` is Gurmukhi, but the
shared direction table selects RTL. A separate minimal correction is tracked as
BUG-20261014-232: remove `pa` from the RTL set, keeping ar/ur/fa/dv unchanged.
Arabic-script Punjabi would require its own locale variant.

Temporary structural checks passed for 54 locales and 594 values: exact
`{{generation}}` preservation, NFC text, no replacement characters, and no
embedded bidi overrides. The package command `bun script/grok-plugins-locale-audit.mjs --activation`
passed all 54 locales, 52 Plugins keys per locale and all 594 new values with no
unexplained English. Production browser and native-window acceptance passed as recorded below.
The real native-server browser fixture will render every locale's activation
panel, active/inactive badges and actual unsupported-LSP error, assert the
snapshot interpolation and computed prose direction, and capture screenshots.
Other failure phrases receive static semantic/placeholder review; the fixture
does not pretend to exercise every backend failure in every language.


## Production browser and native-window evidence

`bun script/grok-native-plugins-ui.mjs desktop --activation-locales` passed
62 checks. All 54 activation panels rendered with the actual native server's
unsupported-LSP response, translated active/inactive labels, exact snapshot
interpolation and expected computed direction. The run also verified successful
recovery and zero provider work, then cleaned up its processes. All 54 screenshot
layouts were reviewed in contact sheets; Punjabi, Arabic and Burmese received
additional full-size inspection. No horizontal document overflow was detected.
Existing Punjabi settings outside Plugins contain Arabic-script strings; this
activation slice does not claim to rewrite that broader dictionary.

`bun script/grok-native-plugins-ui.mjs native --activation-locales` also passed
62 checks against the coordinated Desktop renderer, with all 54 locales and
owned-window cleanup. All 54 native screenshot layouts were reviewed in contact
sheets. Both surfaces retain Arabic/Persian/Urdu RTL and now render Gurmukhi
Punjabi LTR. The same real unsupported-LSP diagnostic and successful recovery
were verified; this does not claim native LSP support.
