# Native MCP preference localization review

Scope: the changed runtime hint and four new preference labels in English,
Simplified Chinese and Traditional Chinese. Other languages retain the existing
English fallback for these new keys. This is terminology/corpus review, not
native-speaker signoff. Scoped visual acceptance is recorded below.

Reviewed on 2026-10-15:

- Maintained [VS Code Simplified Chinese corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json)
  and [Traditional Chinese corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hant/translations/main.i18n.json).
  MCP connection/configuration commands and saved-value messages support the
  existing Apexo terminology: 连接/連線, 配置/設定, 保存/儲存, 启用/啟用.
- Maintained [Firefox Simplified Chinese preferences corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-CN/browser/browser/preferences/preferences.ftl)
  and [Traditional Chinese preferences corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-TW/browser/browser/preferences/preferences.ftl).
  Enable/disable and preference-setting text supplies a second product corpus.
- The Taiwan Ministry of Education's [連線 entry](https://dict.revised.moe.edu.tw/dictView.jsp?ID=64020&la=1&powerMode=0)
  supports the existing Traditional Chinese connection term.

The hint is a complete sentence that distinguishes persistent Connect/Disconnect
choices from Retry. Saved enabled/disabled labels describe a user choice rather
than promising that a transport is connected. Use configuration removes an
explicit choice; it does not claim to discover changed configuration files.
Storage feedback mentions access and preference repair without exposing a path,
server command or credential.

Existing project terms are preserved: 项目/專案. The new messages contain no
interpolation placeholders. Existing tool-count placeholder `{{count}}` remains
unchanged. The root task's concurrent memory labels are preserved by rebasing
only the MCP dictionary keys.

Production browser and actual native-window acceptance passed 16 checks each on
2026-10-15, covering both dialog and status-popover entry points in all three
languages. The `mcp-<locale>-preferences-storage-error.png` and corresponding
`storage-recovered.png` captures were inspected on both surfaces. The saved
choice/reset controls remain readable; the storage message wraps within the
active row and clears after exact-byte repair. Connected/tools-one state is
retained, and no provider work is triggered. A prior action toast can still be
visible briefly after the inline error clears.

The new copy is limited to en/zh/zht; other locales retain English fallback.
This visual and terminology review does not assert native-speaker approval.
