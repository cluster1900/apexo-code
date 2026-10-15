# Goal progress localization review

The new read-only Goal progress panel uses four complete phrases through the
typed language API. Existing English copy and keys are unchanged. Task numbers
are one-based in the UI and remain zero-based in the wire contract.

| Key | English | Simplified Chinese | Traditional Chinese |
| --- | --- | --- | --- |
| `goal.planProgress` | Plan progress | 计划进度 | 計畫進度 |
| `goal.planTaskComplete` | Task {{number}} complete | 任务 {{number}} 已完成 | 任務 {{number}} 已完成 |
| `goal.planDeviations` | Plan changes | 计划调整 | 計畫調整 |
| `goal.planProgressHint` | Goal completion requires independent verification. | 目标是否完成需独立验证。 | 目標是否完成需獨立驗證。 |

Terminology was cross-checked against the maintained
[VS Code localization corpus](https://github.com/microsoft/vscode-loc) and
[KDE Discover corpus](https://github.com/KDE/discover/tree/master/po), including
progress, completion and plan labels. VS Code uses `任务已完成` for a completed
task; its Traditional Chinese corpus also uses `工作` in some contexts. This
panel retains Apexo's `任務` for consistency with task concepts elsewhere.
The Taiwan Ministry of Education's
[dictionary editorial guide](https://dict.mini.moe.edu.tw/Home/Intro?Intro_id=9)
uses `完成任務` in a complete example sentence. The Ministry's published
[digital-content operations manual](https://pads.moe.edu.tw/download_file.php?file=_upload_e00059504c8f589e6cfae05d69ee680e.pdf&old=upload)
has official UI labels for `計畫` and `進度`; this check used its indexed excerpt,
not a full manual review. These are terminology and contextual checks, not
native-speaker approval of every phrase.

`{{number}}` is preserved in both translations. No plural branching or locale
inspection is added to the component. User-authored deviation text is displayed
as text without translation. Other locales retain the shared English fallback
for these new keys; this does not claim a full translation of Goal in all locales.

The eight translated values passed a static completeness and placeholder check.
Production browser and actual native-window fixtures each passed 15 checks across
English and both Chinese locales, including real worker updates, task completion,
deviation copy, the advisory verification hint, and unchanged original-plan and
report hashes. The final native screenshots were visually inspected for both
Chinese progress panels. The new phrases are readable in context and no workspace
reload error is present. Other Goal phrases still use their existing translations
or English fallback; this slice does not claim complete Goal localization.
