# Native Task UI localization review

The Task panel keeps its existing English source strings unchanged. New native copy distinguishes recent foreground tasks, the running count within the returned list, restart interruption, and safe cancellation failures. It does not claim a total count of all running tasks or imply automatic continuation after a restart.

Simplified Chinese retains existing product terms 任务, 会话, 子智能体, and 输出. Traditional Chinese follows existing 工作階段 and 子代理程式 terminology and supplies the previously missing Task panel strings as a coherent group. Shell remains the established developer-facing borrowing. Dynamic count and limit placeholders are preserved.

Terminology and sentence review used the maintained [VS Code localization corpus](https://github.com/microsoft/vscode-loc), the [Firefox localization corpus](https://github.com/mozilla-l10n/firefox-l10n), existing reviewed Apexo copy, and Taiwan's Ministry of Education [中斷 entry](https://dict.concised.moe.edu.tw/dictView.jsp?ID=31132&la=0&powerMode=0). VS Code's crash-recovery wording supports 中断/中斷 as an interrupted execution state; its localized foreground/background and restart strings provide developer UI context. Firefox supplies independent established server, session, refresh, and output terminology. The Firefox support article explicitly marked as unreviewed machine translation was excluded from language-review evidence.

Review covers complete phrases and placeholder parity, not native-speaker certification. 前景 for foreground execution and 子代理程式 are regional developer terms deserving native-speaker review. Other App locales retain their existing fallback behavior for the new keys. Terminal Task controls remain in the terminal product's existing English language scope.

The private production browser passed all three locales with inspected interruption and long-output screenshots. Native-window acceptance remains pending coordinated integration/build. Terminal acceptance includes actual current-buffer inspection and renderer bounds for the running count, interruption guidance, long output, and cancellation feedback.

## Background extension review

The background extension changes only the native summary adapter and the existing recent-task description. `background: true` is retained for row presentation, explicit false remains false, and an omitted flag defaults to false for older servers. Existing App and terminal adapter tests cover all three wire states. No composer entry, polling strategy or new surface is introduced.

The English description now says “Manage recent subagent tasks in this session (up to {{limit}}).” Simplified Chinese removes only 前台 from the reviewed phrase; Traditional Chinese removes only 前景. Existing terminology, sentence structure and the `{{limit}}` placeholder remain unchanged. This scope reuses the corpora documented in the localization review; it makes no new native-speaker certification or claim about other locales.

Background mode is not a promise of restart recovery. Interrupted guidance remains unchanged and no UI action automatically starts provider work. Shared generation/build and visual acceptance of this additive mode remain separate integration checks.
