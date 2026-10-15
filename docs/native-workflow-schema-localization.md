# Workflow schema recovery localization review

This review covers the two new resume-blocked phrases and the lower-bound usage
hint in the Workflow panel. Existing English labels are unchanged. The App uses
its typed language API; terminal recovery text follows the existing English
terminal interface. It does not claim complete Workflow localization.

| Key                                             | English                                                                  | Simplified Chinese                               | Traditional Chinese                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| `workflow.resumeBlocked.process_restart`        | This Workflow cannot resume after restart. Start a new Workflow run.     | 此工作流无法在重启后继续。请启动新的工作流。     | 此工作流程無法在重新啟動後繼續。請啟動新的工作流程。 |
| `workflow.resumeBlocked.schema_attempt_claimed` | This structured-output attempt cannot resume. Start a new Workflow run.  | 此结构化输出尝试无法继续。请启动新的工作流。     | 此結構化輸出嘗試無法繼續。請啟動新的工作流程。       |
| `goal.usageIncomplete` (shared hint)            | Some requests did not report usage. The recorded total is a lower bound. | 部分请求未返回用量，已记录总量可能低于实际用量。 | 部分請求未回報用量，已記錄的總量是實際用量的下限。   |

The Simplified Chinese usage phrase already existed; Traditional Chinese now has
an explicit translation for that shared key. The new recovery phrases have no
interpolated values or plural branches. Totals remain visible. The hint is absent
when usage is complete, and guidance is selected from the typed reason enum rather
than arbitrary server error text.

## Terminology and contextual checks

The existing repository corpus uses `工作流` in Simplified Chinese and
`重新啟動` in Traditional Chinese. Regional restart wording was checked against
two independently maintained application corpora:
[VS Code Simplified Chinese](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hans/translations/main.i18n.json),
[VS Code Traditional Chinese](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hant/translations/main.i18n.json),
[Firefox Simplified Chinese restart UI](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-CN/browser/browser/aboutRestartRequired.ftl),
and [Firefox Traditional Chinese restart UI](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-TW/browser/browser/aboutRestartRequired.ftl).
Firefox uses `重启` and `重新啟動` respectively, consistent with these phrases.

Developer terminology was checked separately:
[Microsoft's Simplified Chinese Workflow documentation](https://learn.microsoft.com/zh-cn/dotnet/framework/windows-workflow-foundation/pausing-and-resuming-a-workflow)
uses `工作流` and contextual `继续`;
[Microsoft's Traditional Chinese Workflow documentation](https://learn.microsoft.com/zh-tw/projectonline/troubleshoot-project-online-workflows)
uses `工作流程`.
[Google's Simplified Chinese structured-output documentation](https://developers.google.com/ml-kit/genai/prompt/android/structured-output?hl=zh-cn)
and [Microsoft's Traditional Chinese structured-output documentation](https://learn.microsoft.com/zh-tw/azure/foundry-classic/foundry-models/how-to/use-structured-outputs)
support `结构化输出` and `結構化輸出`. These are terminology checks, not sources
for Apexo's execution or recovery semantics.

The [Microsoft style-guide index](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides)
links the Simplified and Traditional Chinese guides. Their general voice and
translation guidance favors clear, concise, natural phrasing in context rather
than literal word substitution. This review used those sections, not a complete
style-guide compliance audit. The Taiwan Ministry of Education's
[dictionary index](https://dict.revised.moe.edu.tw/appendix.jsp?ID=27&la=0&page=51&powerMode=0&ver=4)
includes `下限`; this check confirms the term, not a full dictionary-definition
review. [Unicode CLDR's Chinese plural rules](https://www.unicode.org/cldr/charts/48/supplemental/language_plural_rules.html)
require no additional cardinal category for these count-free phrases.

`尝试` / `嘗試` describes the bounded structured-output attempt; the following
sentence gives the concrete recovery action. This technical phrasing has been
reviewed against the source meaning but has no independent native-speaker
signoff. Existing unrelated Workflow labels may still use English fallback in
Traditional Chinese. Existing token labels and user-authored content are outside
this change. Other locales retain the shared fallback for the new keys.

## Renderer verification

Production browser and actual native Desktop window runs each passed 16 checks
across English, Simplified Chinese, and Traditional Chinese. All six localized
recovery captures were visually inspected after scrolling the real run card into
view: the 120-token total, lower-bound hint, and complete new-run instruction are
readable; Resume is absent. Traditional Chinese unrelated Workflow labels retain
the existing English fallback, as scoped above. No reload error overlays the panel.

Actual mini and fullscreen terminal runs each passed 14 checks. Pre-shutdown
captures retain the same English lower-bound and recovery text; pressing `u`
does not open Resume or issue another provider request. The earlier Source-header overlap was reproduced in the actual renderer and fixed by preventing fixed rows from shrinking. Both retained terminal captures now show intact title and Source rows; see [the layout regression](testing/ui/workflow-terminal-fixed-rows.md).

The fixtures use real native Workflow requests: a correction is held, cancellation
records incomplete usage, and the derived blocked-resume reason is rendered.
They also check that a completed run with exact usage has no lower-bound hint.
No synthetic public Info replaces the runtime result. Initial evidence-capture
framing and lifetime mistakes were corrected and rerun without product changes.
