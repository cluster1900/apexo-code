# Plugins Localization Review

The storefront reads visible copy through shared `language.t(...)` keys. Product
names, author-provided descriptions, Git addresses, versions, paths and protocol
names remain unchanged. Existing English keys were preserved.

## Coverage

The Plugins namespace currently has 52 keys, explicitly defined in all 62
locale dictionaries. The latest addition supplies eleven activation values in
54 dictionaries (594 values); its static audit and App typecheck passed.
Production browser and actual native-window acceptance each passed 62 checks
including all 54 added activation locales. See the separate
[activation localization review](plugins-activation-localization-review.md)
for terminology sources, language-specific review limits and current evidence.
No native-speaker sign-off is claimed.

The original 41-key pass covered 57 languages. At that checkpoint fo/dv/tk/am/dz
only translated the title; the five-locale completion below replaces that known
gap rather than counting fallback as translated text.

Static checks cover duplicate keys, counts, interpolation and retained English.
Established borrowed terms such as Plugins, Hooks, Git, MCP and URL, alongside
`owner/repo` and path examples, are intentional. Third-party metadata is outside
the application dictionary.

## Reference corpus and limits

The previous terminology review consulted successfully retrieved content from:

- [Firefox localization](https://github.com/mozilla-l10n/firefox-l10n), especially add-on management copy.
- [VS Code localization](https://github.com/microsoft/vscode-loc), for developer tools and installation terms.
- [KDE Discover](https://github.com/KDE/discover/tree/master/po), for storefront operations and sources.
- [Microsoft localization style guides](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides), for locale distinctions.
- [Språkrådet](https://sprakradet.no/godt-og-korrekt-sprak/ordlister-og-ordboker/pa-godt-norsk-avloserord/), for Norwegian technical vocabulary.

Attempts to consult Duden timed out, and the Finnish dictionary's dynamic pages
did not provide verifiable entries; neither was treated as reviewed evidence.
Not every language had two usable maintained corpora. Retrieving an index is not
the same as reading every guide or verifying every sentence.

A later review examined actual fo/dv/tk/am/dz entries in
[MediaWiki localization](https://github.com/wikimedia/mediawiki/tree/master/languages/i18n).
Those entries supported generic search, download and version labels, but did not
validate complete trust, running-session and Hook compatibility explanations.
Attempted GNOME corpus URLs returned 404; that does not show that no other corpus
exists. No word-by-word assembly was accepted as complete sentence translation.

## Remaining review

Complete sentences avoid assembling grammar in the UI. Hooks, Agent and Skill
terminology differs across developer products; browser-era plugin terminology
is not always suitable for a coding-tool bundle.

Native-speaker review remains desirable, particularly for South/Southeast Asian
scripts, Mongolian, Armenian, Georgian and translated Hook terminology. Existing
coverage is engineering translation supported by reference terminology, not a
claim of human native-speaker sign-off.

Browser acceptance has covered English, Simplified and Traditional Chinese,
German, Japanese, Arabic, Hindi, Polish, Thai and Turkish. It checks the Plugins
name, own installation/source controls, absence of Marketplace branding, RTL
layout and narrow-width overflow. See the implementation record for accepted
runs; dictionary coverage alone does not prove visual or linguistic quality.

## Native activation copy (2026-10-14)

The native activation panel adds eleven keys, bringing the Plugins namespace to 52 keys. English, Simplified Chinese, and Traditional Chinese now cover all 52. The other 54 dictionaries that covered the original storefront retain those 41 keys and use English fallback for the eleven new activation keys. The five incomplete dictionaries (fo, dv, tk, am, dz) still define only `plugins.title`, so each now falls back for 51 keys: the original 40 body keys plus the eleven activation keys. No fallback is counted as translated coverage.

All eleven Chinese values differ from English and retain the same interpolation placeholders. Production browser and native macOS acceptance covered both Chinese activation-failure panels and successful recovery. Backend diagnostic messages and MCP/LSP capability identifiers are server data; the surrounding failure explanation is localized. See [BUG-20261014-180](testing/ui/native-plugins-routing.md) for verified corpora, terminology choices, and limits.

The next five-locale slice needs maintained source text for complete trust, removal, running-work, activation, and failure explanations, alongside locale-specific terminology and language-authority checks. Generic search/download/version glossary hits alone are insufficient. After translation, audit all 51 values per locale, preserved placeholders, and deliberate identifiers, then verify the rendered storefront and activation panel, including Dhivehi RTL layout. No new translations for these five locales were added during the native activation source freeze.

## Five-locale completion (2026-10-14)

Faroese (`fo`), Dhivehi (`dv`), Turkmen (`tk`), Amharic (`am`), and Dzongkha (`dz`)
now each define all 52 Plugins keys. This supersedes the five-locale fallback
counts above. At that checkpoint, the other 54 dictionaries retained eleven
activation fallbacks; the later activation review now supersedes that count. English Plugins copy
and keys are unchanged.

The complete phrases preserve three separate operations: downloading files,
enabling an installed plugin, and applying the enabled set to a project. Trust
copy retains all three capabilities (commands, service connections, and file
access). Removal copy distinguishes retaining installed plugins after source
removal from removing an uninstalled plugin from future sessions. Activation
failures explicitly retain the previous snapshot. The shared Install button
used by the storefront now uses a consistent installation verb in fo/dv/tk;
Dhivehi's Plugins title is consistent in its storefront and status tab.

The following retrieved material informed terminology and sentence review:

| Locale | Maintained localization material read | Authority/style material and limitations |
| --- | --- | --- |
| fo | [MediaWiki Faroese](https://github.com/wikimedia/mediawiki/blob/master/languages/i18n/fo.json), [WordPress Faroese export](https://translate.wordpress.org/projects/wp/dev/fo/default/export-translations/?format=po): source, activation, search and complete failure/retry phrasing | [Málráðið computer terms](https://www.malrad.fo/ordalistar-teldord-en-fo-da): activate/active, access and authorization; existing Apexo uses Tilskot and ambætari. Hooks stays a technical component identifier rather than a newly invented literal hook name. |
| dv | [MediaWiki Dhivehi](https://github.com/wikimedia/mediawiki/blob/master/languages/i18n/dv.json), [WordPress Dhivehi export](https://translate.wordpress.org/projects/wp/dev/dv/default/export-translations/?format=po): installed state and complete update/error instructions; English entries in the export were excluded | [Dhivehi Academy](https://dhivehiacademy.edu.mv/book-list) access timed out, so it is not claimed as verified terminology. [Unicode CLDR](https://github.com/unicode-org/cldr/blob/main/common/main/dv.xml) confirms right-to-left character order. Existing technical borrowings are retained in Thaana script. |
| tk | [MediaWiki Turkmen](https://github.com/wikimedia/mediawiki/blob/master/languages/i18n/tk.json): source, server, availability and complete busy/retry sentences | [Magtymguly Institute](https://www.demgi.gov.tm/?change_language=tm): Turkmen orthography and prose about computer programs and terminology. A second usable software corpus was not retrieved; attempted WordPress/VLC paths returned 404. This is a review limitation, not proof that no corpus exists. |
| am | [MediaWiki Amharic](https://github.com/wikimedia/mediawiki/blob/master/languages/i18n/am.json), [LibreOffice Amharic extension UI](https://github.com/LibreOffice/translations/blob/master/source/am/desktop/messages.po), [GLib Amharic](https://github.com/GNOME/glib/blob/main/po/am.po): installation, configuration, files and failure phrasing; fuzzy PO entries were excluded | [Microsoft Amharic style guide](https://download.microsoft.com/download/6/2/a/62a993f1-d3b2-4f28-b3e7-22965eb91426/amh-eth-styleguide.pdf): command verbs, audience, tone and complete sentence order. Some embedded glyph extraction was damaged, so unreadable examples were not used as evidence. |
| dz | [MediaWiki Dzongkha](https://github.com/wikimedia/mediawiki/blob/master/languages/i18n/dz.json), [LibreOffice Dzongkha extension UI](https://github.com/LibreOffice/translations/blob/master/source/dz/desktop/messages.po), [GLib Dzongkha](https://github.com/GNOME/glib/blob/main/po/dz.po): enable/disable, installation, configuration and source vocabulary; fuzzy PO entries were excluded | [Dzongkha Computer Terms, GNU Dzongkha-GNOME mirror](https://download-mirror.savannah.gnu.org/releases/dzongkha-gnome/dzongkha_computer_terms.pdf): plugin spelling was checked against the rendered dictionary page, with download/install/activate entries also inspected in extracted text. The newer direct government download timed out. |

These are engineering translations supported by corpus and style review, not
native-speaker sign-off. Snapshot and lifecycle-hook terminology in all five
languages, Dhivehi technical borrowing register, and Turkmen configuration
phrasing deserve native-speaker review. A dictionary word does not validate an
entire sentence; the complete notices were reviewed against the English
operation and the target locale's existing sentence patterns. Third-party
plugin descriptions and backend diagnostic text remain source data.

`bun script/grok-plugins-locale-audit.mjs` from `packages/apexo` checks the actual
dictionaries for all 52 keys, duplicates, exact interpolation names, preserved
Git/MCP/path syntax, unexplained English equality, hidden bidi controls and
replacement characters. Faroese `Hooks` is the sole equal-to-English value and
is explicitly classified as a technical component identifier. The three code
examples in the source placeholder stay unchanged while their conjunction is
translated. Dhivehi direction comes from the shared language context; no
feature-local grammar or direction branches were added.

The production browser/native fixture accepts `--five-locales` and exercises
storefront text, source syntax, download, installation trust, apply, real LSP
activation failure, recovery, and removal notices in each locale. It also
checks document direction and horizontal overflow. The first production browser run passed 13 checks and all five storefront/trust
screenshots were inspected. That visual review found and fixed
[RTL identifier ordering](testing/ui/plugins-rtl-identifiers.md); the rebuilt production browser then passed the same 13 checks with identifier
isolation verified. The actual macOS native window also passed all 13 checks, including leading-slash
range geometry. All five storefront/trust screenshots were inspected in both
surfaces; Dhivehi source-entry screenshots confirmed mixed-script placeholder
order. Both runs completed their owned process/window cleanup. Static coverage alone is
not visual or native-speaker acceptance. See [BUG-20261014-230](testing/ui/plugins-five-locale-fallback.md).
