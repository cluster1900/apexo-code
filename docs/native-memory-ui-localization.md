# Native Memory management localization review

The App's existing English Memory strings remain unchanged. New native capability, unsupported-operation and safe-error copy uses typed translation keys. Simplified Chinese and Traditional Chinese translations cover the new copy; Traditional Chinese also supplies the previously missing passive-browser labels. Other App locales retain the normal English fallback. The existing shared terminal components use English; this slice does not claim terminal localization.

Terminology follows the existing repository corpus: Simplified Chinese uses 会话 / 记忆 / 笔记 / 预览, while Traditional Chinese uses 工作階段 / 記憶 / 筆記 / 預覽. The native capability explanation describes the implemented actions and explicitly excludes capture, review and background operations. It does not imply that an unavailable native action is available through compatibility routing.

Review sources:

- Microsoft’s maintained [Simplified Chinese VS Code corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json) and [Traditional Chinese corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hant/translations/main.i18n.json) for developer UI vocabulary and complete action/error phrases.
- Mozilla’s independent [Simplified Chinese permissions corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-CN/browser/browser/preferences/permissions.ftl), [Traditional Chinese permissions corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-TW/browser/browser/preferences/permissions.ftl), and [Traditional Chinese style guide](https://mozilla-l10n.github.io/styleguides/zh-TW/) for authorization wording and spacing around retained identifiers.
- Taiwan Ministry of Education’s [dictionary interface instructions](https://dict.concised.moe.edu.tw/page.jsp?ID=9&la=0&powerMode=0) and [learning-note instructions](https://dict.mini.moe.edu.tw/Account/Login) for note/browsing terminology in a maintained language-authority interface. A direct dictionary word-query request was unavailable; no successful entry lookup is claimed.

The retained `/memory` command and `KiB` unit are code/unit tokens. The existing `{{name}}` placeholder is preserved. Native terminal commands and keyboard legends remain English by their existing terminal contract. “Managed session” is an ownership restriction, translated in context rather than as an ordinary account administrator role; native-speaker review can focus on that uncommon phrase.

Production browser/native-window and real terminal results are recorded in the feature contract after execution; source review and typechecks alone are not renderer acceptance.

Final private production browser and rebuilt native window each passed eighteen checks across en/zh/zht. Their disabled, preview and conflict screenshots were inspected. Actual mini/fullscreen each passed six checks at both 120×40 and 80×24, retaining English terminal copy. Shared integration and its paired performance check remain separate.
