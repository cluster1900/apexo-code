# Native Scheduler management localization

The new management copy is authored in English and translated as complete phrases for Simplified Chinese (`zh`) and Traditional Chinese (`zht`). Existing English values are unchanged. Other locales retain the typed English fallback for these new keys; this is not a claim that all locales are translated.

## Terminology review

Existing Apexo `tasks.scheduler` supplies 定时任务 / 排程任務. The new copy retains those terms rather than introducing a second label for the same domain. [Microsoft's Simplified Chinese Task Scheduler documentation](https://learn.microsoft.com/zh-cn/windows/win32/taskschd/task-scheduler-start-page) and [Traditional Chinese documentation](https://learn.microsoft.com/zh-tw/windows/win32/taskschd/task-scheduler-start-page) provide independent developer-product context for schedules, triggers, and execution. Their platform names are not substituted for Apexo's established labels.

The maintained [Firefox Simplified Chinese Downloads corpus](https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/zh-CN/browser/browser/downloads.ftl) and [Traditional Chinese corpus](https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/zh-TW/browser/browser/downloads.ftl) support the action vocabulary 暂停 / 暫停, 继续 / 繼續, and 删除 / 刪除. Taiwan's Ministry of Education dictionary service uses 暫停 and distinct interrupted-service wording in its [maintenance notice](https://dict.revised.moe.edu.tw/news.jsp?ID=68&la=1&powerMode=0) and [service migration notice](https://dict.revised.moe.edu.tw/news.jsp?ID=73). This is authority usage evidence, not a claim of a dictionary definition for the product's Scheduler concept.

The durability flag is presented as an option value. It does not assert that the flag alone determines restart retention. Actual paused/restart-required status supplies future-only Resume guidance. Pause/Delete copy distinguishes future intent from the separately controllable admitted Task. `Task` identity, `/loop`, `$ARGUMENTS`, tool identifiers, and dynamic IDs are preserved where they are code tokens.

## Review limits and validation

These are source- and corpus-reviewed translations, not native-speaker signoff. The developer-facing translation of the `durable` option (持久选项 / 持久選項) remains an explicit review focus because it is a specific backend option, not a general promise of persistence. No plural-category logic is embedded in components. Placeholders remain named and complete phrases carry the grammar.

Private real browser and rebuilt native-window en/zh/zht runs each passed seven checks. Reviewed screenshots show translated actions, restart guidance, localized dates and the narrow layout without horizontal overflow. The focused locale tests verify named-placeholder equality and that new Chinese values do not silently equal English; App typechecks also pass without duplicate-key diagnostics. Terminal interfaces retain their existing English presentation convention.
