# Background Task management acceptance

The existing App, mini and fullscreen Task rows display a conditional background-mode marker while retaining the existing task type and execution status. The marker reports launch mode, not restart recovery. Both terminal descriptions now describe recent tasks without a foreground-only restriction. No new prompt, Session action, polling strategy or task-management surface is added.

App copy uses `tasks.background`: English Background, Simplified Chinese 后台, and Traditional Chinese 背景. The Simplified Chinese term matches existing reviewed Apexo background execution copy. Traditional Chinese execution terminology was checked against the maintained [VS Code task localization corpus](https://github.com/microsoft/vscode-loc/blob/main/i18n/vscode-language-pack-zh-hant/translations/main.i18n.json), including its task-background and running-background-work settings, and Firefox's [background service wording](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-TW/browser/browser/preferences/preferences.ftl). These support execution context rather than merely visual background color. Existing [Task locale review](native-task-ui-localization.md) supplies the sentence/authority context. The short labels introduce no placeholders; other App locales use English fallback. Terminal strings retain the product's existing English scope. This is corpus review, not native-speaker certification.

## Fixture scope

The existing native UI scripts accept `--background`; their default foreground scenario remains unchanged. The real server creates completed, interrupted and running background children. UI cancellation of the running child must produce no parent wake. With the manager open, additional actual children exercise idle completion after passive list/output reads, a completed child while its parent provider is held, and model-facing wait. Passive UI reads cannot consume a notice; model wait must suppress the duplicate. Final output remains rendered with the same background marker.

The App fixture captures English, Simplified Chinese and Traditional Chinese markers/copy and lifecycle screenshots. Terminal fixtures capture current-buffer text plus actual renderer geometry at 80×24 and normal size. These are real mini/fullscreen panel/action checks, not a claim that every native-only terminal bootstrap route is supported. The native Electron fixture uses its own profile and selected native source server, preserving the user's application profile.

## Current evidence and remaining checks

The helper-only smoke check passed four checks / 22 real provider calls. App, TUI and Apexo package typechecks passed against the private coherent source checkpoint plus this narrow overlay. The corrected classifier is recorded in [BUG109](testing/test-fixtures/task-background-ui-assistant-marker.md). After shared integration and production builds, browser and actual native Desktop windows each passed ten checks / 22 provider calls across en/zh/zht. The strengthened visibility checks and selected screenshots are recorded in [BUG118](testing/test-fixtures/task-background-preview-visibility.md). Actual mini and fullscreen checks each passed seven checks / 22 provider calls at both 80×24 and 120×40. Rendered buffers and geometry were inspected: current copy, background/status rows, selected receipt/output and controls remained visible. These checks include cancellation without a parent wake, passive reads, idle completion, held-active-parent completion and model wait without duplicate delivery. Fixture-only corrections are recorded in [BUG111](testing/test-fixtures/task-background-fullscreen-navigation.md) and [BUG113](testing/test-fixtures/task-background-parent-wait.md). All owned processes were reaped.

Shared App/TUI typechecks and App/Desktop builds passed. Live shared mini/fullscreen 80×24 reruns each passed seven checks / 22 calls; their current buffers and renderer bounds were inspected. The private coherent 120×40 results above remain separately scoped. The final fixed-backend composer comparison is complete: the fresh paired before sample measured 123 ms median / 134 ms p95 and after measured 116 / 126 ms, with zero Long Task entries. The earlier higher-tail sample is retained; no causal speedup or slowdown is established. See [measurement details](testing/performance/native-task-composer.md).

From `packages/apexo`, use pinned Bun1.3.14:

- `bun script/grok-native-task-ui.mjs browser --background --locales`
- `bun script/grok-native-task-ui.mjs native --background --locales`
- `bun script/grok-native-task-tui.mjs --background --narrow`
- `bun script/grok-native-task-tui.mjs --background --fullscreen --narrow`
- Omit `--narrow` for the 120×40 terminal checks.

These checks do not claim support for active child steering, Goal-owned background lifetime, transcript-fork/worktree delegation or automatic post-crash replay.
