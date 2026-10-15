# BUG-20261014-230: Five Plugins dictionaries fell back for their entire body

- **Type:** UI / localization
- **Scope:** Plugins storefront and native activation panel in fo, dv, tk, am, dz.
- **Status:** Fixed and verified: static audit, App typecheck, production browser and actual macOS native window passed.

## Observed and expected behavior

Each locale defined only `plugins.title`. The remaining 51 keys used the English
fallback, including trust, removal, source errors and activation failure copy.
The title appeared localized while the operation itself remained English.
Expected behavior is complete translated phrases with preserved identifiers and
interpolation, including distinct downloaded, enabled and active states.

## Reproduction and cause

Select any affected locale, open Settings → Plugins, and inspect installation
or native activation. Compare its dictionary's Plugins namespace to English:
one key existed out of 52. The initial storefront pass deliberately deferred
these five dictionaries; the later eleven activation keys increased the known
fallback gap. This is one coverage root cause, not five independent occurrences.

## Fix

Each dictionary now defines all 52 keys. Complete trust/removal/activation
sentences retain the English semantics. The storefront's shared Install label
was aligned in fo/dv/tk, and the Dhivehi Plugins title was made consistent in its
two existing surfaces. English remains unchanged. A reusable audit classifies
retained English rather than treating code tokens or a technical Hook label as
untranslated prose. Browser/native acceptance covers actual actions and notices,
including right-to-left Dhivehi, not a synthetic translation page.

[Localization review](../../plugins-localization-review.md#five-locale-completion-2026-10-14)
records the corpora, authority checks, unavailable material and native-speaker
review limits. In particular, this is not a claim of expert linguistic approval.

## Verification

Run from the indicated package directories with the pinned Bun version:

- `packages/apexo`: `bun script/grok-plugins-locale-audit.mjs` — passed all five locales, 52 keys each; exact placeholders and identifiers, no duplicate keys, no unexplained English equality.
- `packages/app`: `bun typecheck` — passed, exit 0.
- Production browser before the RTL identifier fix: 13 checks passed, including all five locales, real download/install/trust/apply/removal actions and recovery; screenshots inspected. Bidi review found [BUG-20261014-231](plugins-rtl-identifiers.md).
- Final production browser after the RTL fix: `packages/apexo`: `bun script/grok-native-plugins-ui.mjs desktop --five-locales` — 13 checks passed. Computed identifier/prose directions and inspected screenshots confirm the correction.
- Actual macOS native window: `packages/apexo`: `bun script/grok-native-plugins-ui.mjs native --five-locales` — 13 checks passed, including all five complete workflows and identifier geometry. Storefront/trust screenshots for every locale were inspected; source-entry and removal screenshots were also retained. The owned window, browser session and servers were closed and the process exited 0.

The fixture uses a real native Server and a local plugin catalog. Unsupported
activation uses LSP, since native bundle MCP is now supported. The expected
failure preserves the active snapshot and a subsequent valid apply must clear
it. No model request is required for localization acceptance.
