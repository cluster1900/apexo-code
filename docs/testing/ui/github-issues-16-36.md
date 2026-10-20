# GitHub Issues #16–#36: Detailed Root Cause, Fix, and Retest Report (问题根因、修复方案与复测报告)

- **ID**: `BUG-20261019-501` through `BUG-20261019-521`
- **Status**: Fixed & Verified
- **Branch**: `fix-github-issues` / `grok-cli-parity`

---

## #16 — `apexo run` 在 stdin 仍为打开的管道时会挂起，直到管道关闭 (`BUG-20261019-501`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/src/cli/cmd/run/runtime.stdin.ts`
  - `packages/apexo/src/cli/cmd/run.ts`
  - `packages/apexo/src/cli/native-local.ts`
- **现象与预期 (Observed vs. Expected)**:
  - **Observed**: 当以 `sleep 600 | apexo run "Say hi"` 或子进程默认打开管道（`stdio: ["pipe", "pipe", "pipe"]`）调用 `apexo run` 时，即使命令行已提供位置参数 `message`，进程仍无限期挂起等待 stdin EOF。
  - **Expected**: 位置参数 `message` 或 `--command` 已提供时，若非 TTY stdin 管道无立即可读数据，应立即继续执行而不挂起。
- **根因分析 (Root Cause)**:
  - `readPipedStdin()` 只要检测到 `!process.stdin.isTTY` 就无条件调用 `await Bun.stdin.text()` 等待管道关闭。
- **修复方案 (Fix)**:
  - 为 `readPipedStdin(hasPositionalInput = false)` 增加 `hasPositionalInput` 参数：当已有位置参数或 `--command` 时，对非 TTY stdin 仅等待最多 **50ms** 首包数据；若 50ms 内无数据到达，则调用 `process.stdin.pause()` 与 `process.stdin.unref?.()` 并返回 `""`。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/apexo && bun test test/cli/run/run-process.test.ts`（默认管道 stdin 下 20/20 子进程用例全部通过，无挂起）。

---

## #17 — `Ctrl+C` / `SIGINT` 后子 shell 仍继续执行并写文件（进程泄漏） (`BUG-20261019-502`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/src/cli/cmd/run.ts`
  - `packages/apexo/src/session/processor.ts`
- **现象与预期 (Observed vs. Expected)**:
  - **Observed**: 在 `apexo run` 执行长耗时 `bash` 工具命令期间发送 `SIGINT`，`apexo` 退出但后台子 shell 仍继续运行并写文件，且会话历史中该 tool part 状态停留在 `running`。
  - **Expected**: 收到 `SIGINT` / `SIGTERM` 时应中断会话、杀死工具创建的整个子进程组（`-pid`），并将 tool part 状态更新落盘后以 130/143 退出。
- **根因分析 (Root Cause)**:
  - `run.ts` 的非交互事件循环未注册 `SIGINT`/`SIGTERM` 处理器触发 `session.abort`；且 `processor.ts` 的 `cleanup` 在光纤被中断时未等待 `Deferred.await(call.done)` 完成，导致 `ShellTool` 尚未杀死 `-pid` 进程组及更新数据库状态进程就已退出。
- **修复方案 (Fix)**:
  - 在 `run.ts` 中注册 `SIGINT`/`SIGTERM` 处理器，调用 `client.session.abort({ sessionID })` 并等待最多 3.5s 让循环收敛后以 `130`/`143` 退出；
  - 在 `processor.ts` 的 `cleanup` 中等待 `Deferred.await(call.done)`（上限 3.5s），确保 `ShellTool` 完成进程组清理与状态持久化。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/apexo && bun test test/cli/run/run-process.test.ts -t "SIGINT interrupts an active non-interactive run without leaking the process"`：**PASS（2.35s）**，验证 marker 文件未被创建且进程不泄漏。

---

## #18 — `apexo serve` 默认无密码且不校验 `Host`，DNS 重绑定可创建会话并发送消息 (`BUG-20261019-503`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/src/server/routes/instance/httpapi/server.ts`
- **现象与预期 (Observed vs. Expected)**:
  - **Observed**: 向绑定在 `127.0.0.1` 的 `apexo serve` 发送带 `Host: evil.example.com` 的请求返回 `200 OK`。
  - **Expected**: Loopback 服务收到非本机且不在 `--cors` 白名单内的 `Host` 请求头时应拒绝并返回 `403 Forbidden`。
- **根因分析 (Root Cause)**:
  - 服务端仅校验了 CORS `Origin` 头，未校验 `Host` 头，无法防御不触发 CORS 预检的 DNS Rebinding 请求。
- **修复方案 (Fix)**:
  - 在 `server.ts` 新增全局中间件 `hostHeaderProtection(corsOptions)`，校验 `Host` 头主机名必须为 `localhost`、`127.0.0.1`、`::1`、`[::1]` 或 `--cors` 白名单域名，否则返回 `403 Forbidden: Invalid Host header`。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/apexo && bun test test/cli/run/run-process.test.ts -t "apexo serve blocks non-loopback Host headers with 403"`：**PASS**（`Host: evil.example.com` 返回 403，正常请求返回 200）；
  - `cd packages/apexo && bun run test:httpapi`：346/346 路由契约测试通过。

---

## #19 — 模型不存在时对用户只显示 `UnknownError`，真正原因埋在日志里 (`BUG-20261019-504`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/src/server/routes/instance/httpapi/middleware/error.ts`
  - `packages/apexo/src/session/prompt.ts`
- **现象与预期 (Observed vs. Expected)**:
  - **Observed**: 请求不存在的模型时，HTTP 接口落入兜底 500 返回 `Unexpected server error. Check server logs for details.`，且缺少查看可用模型的提示。
  - **Expected**: 返回 HTTP 400 结构化 `ProviderModelNotFoundError` 错误，并提示运行 `apexo models`。
- **根因分析 (Root Cause)**:
  - `middleware/error.ts` 未匹配 `Provider.ModelNotFoundError` 与 `Provider.InitError`；`prompt.ts` 未附带 `apexo models` 提示。
- **修复方案 (Fix)**:
  - 在 `middleware/error.ts` 中捕获 `Provider.ModelNotFoundError` 与 `Provider.InitError` 返回 HTTP 400 JSON，并在 `middleware/error.ts` 与 `prompt.ts` 错误消息末尾追加 `Run \`apexo models\` to list available models.`。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/apexo && bun test test/cli/run/run-process.test.ts -t "unknown model"`：**PASS**。

---

## #20 — MiniMax-M2 等把 `<think>` 标签直接打印到默认输出 (`BUG-20261019-505`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/src/session/processor.ts`
- **现象与预期 (Observed vs. Expected)**:
  - **Observed**: `MiniMax-M2` / `MiniMax-M2.7` 等模型将思考内容包在 `<think>...</think>` 中通过 `text-delta` 返回，导致 `apexo run` 默认输出直接打印出 `<think>...</think>`。
  - **Expected**: `<think>...</think>` 内容应归入 `reasoning` part，默认输出只打印正式回复（传 `--thinking` 时才显示思考内容）。
- **根因分析 (Root Cause)**:
  - `processor.ts` 将所有 `text-delta` 均视为正文文本写入 `ctx.currentText`。
- **修复方案 (Fix)**:
  - 在 `processor.ts` 的 `text-start`/`text-delta`/`text-end`/`cleanup` 中增加流式前导 `<think>...</think>` 解析状态机，将思考内容路由到独立的 `reasoning` part（`__inline_think__`），仅将 `</think>` 之后的正文写入 `ctx.currentText`。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/apexo && bun test test/cli/run/run-process.test.ts -t "routes leading <think>"`：**PASS**（验证默认 stdout 仅为 `visible answer\n`，不含 `<think>`）。

---

## #21 — 权限被自动拒绝后 `apexo run` 仍以 `exit 0` 退出 (`BUG-20261019-506`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/src/cli/cmd/run.ts`
  - `packages/apexo/test/cli/run/run-process.test.ts`
- **现象与预期 (Observed vs. Expected)**:
  - **Observed**: 非交互 `apexo run` 触发权限请求并打印 `permission requested: ...; auto-rejecting` 后，退出码仍为 `0`。
  - **Expected**: 权限被自动拒绝时应以非零状态码（`1`）退出。
- **根因分析 (Root Cause)**:
  - `run.ts` 在 `permission.asked` 处理分支中仅打印警告并调用 `reject`，未设置 `error`。
- **修复方案 (Fix)**:
  - 在自动拒绝权限时设置 `error = \`permission requested: \${permission.permission} (\${patterns}); auto-rejected\``，使进程以退出码 `1` 结束。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/apexo && bun test test/cli/run/run-process.test.ts -t "rejects requested permissions by default"`：**PASS**（验证退出码为 1）。

---

## #22 — `README` 提到自定义 OpenAI-compatible provider，但缺少任何配置示例 (`BUG-20261019-507`)

- **修改文件 (Affected Scope)**:
  - `README.md`
- **修复方案与验证 (Fix & Verification)**:
  - 在 `README.md` 新增 `Custom OpenAI-Compatible Providers` 章节，给出完整的 `~/.config/apexo/apexo.jsonc` 配置示例（`npm: "@ai-sdk/openai-compatible"`、`options.baseURL`、`env`、`models`）及 `apexo models` 验证命令。

---

## #23 — 系统 Bun 1.4.2 下 SIGINT 单元测试超时失败；钉定的 1.3.14 通过 (`BUG-20261019-508`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/test/lib/cli-process.ts`
  - `packages/apexo/src/cli/cmd/run.ts`
  - `packages/apexo/src/session/processor.ts`
- **根因分析与修复 (Root Cause & Fix)**:
  - `cli-process.ts` 改为使用 `process.execPath` 启动子进程，并配合 `run.ts` 与 `processor.ts` 的 `SIGINT` 中断清理逻辑，消除 Bun 1.4.2 下信号中断时的子进程挂起。
- **复测与验证 (Retest & Verification)**:
  - 在 Bun 1.4.2 下运行 `cd packages/apexo && bun test test/cli/run/run-process.test.ts`：**20/20 全部通过**（SIGINT 用例耗时 2.35s）。

---

## #24 — 桌面端 & CLI：MiniMax-M2/M3 的思考内容作为普通回复显示，无视「Show reasoning summaries」关闭 (`BUG-20261019-509`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/src/session/processor.ts`
  - `packages/apexo/src/cli/cmd/run.ts`
  - `packages/session-ui/src/components/message-part-text.ts`
  - `packages/app/src/utils/message-part-text.test.ts`
- **根因分析与修复 (Root Cause & Fix)**:
  - 服务端 `processor.ts` 将 `<think>...</think>` 拆分为 `reasoning` part；`run.ts` 在 `--format json` 下始终发射 `type: "reasoning"` 事件；前端 `message-part-text.ts` 新增 `stripInlineThink()` 过滤任何残留的内联 `<think>` 块。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（含 `message-part-text.test.ts` 3/3）与 `packages/apexo` `run-process.test.ts` 全部通过。

---

## #25 — 桌面端：关闭「Auto-accept permissions」后编辑文件仍不弹审批，直接写盘 (`BUG-20261019-510`)

- **修改文件 (Affected Scope)**:
  - `packages/app/src/context/permission.tsx`
  - `packages/app/src/components/prompt-input/submit.ts`
- **根因分析与修复 (Root Cause & Fix)**:
  - 原先切换「Auto-accept permissions」仅修改前端本地状态，后端会话仍保持默认 `allow` 规则。现已在 `permission.tsx`（`syncSessionPermissionRules`）与 `submit.ts` 中通过 `sdk.client.session.update` 将会话的 `edit` 与 `bash` 权限规则实时同步为 `"ask"`（关闭时）或 `"allow"`（开启时）。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #26 — 桌面端：输入框清空后再输入会丢字符；多行时首次 `Ctrl+A` 不生效 (`BUG-20261019-511`)

- **修改文件 (Affected Scope)**:
  - `packages/app/src/context/prompt.tsx`
  - `packages/app/src/components/prompt-input.tsx`
- **根因分析与修复 (Root Cause & Fix)**:
  - `prompt.tsx` 的 `withSuspense` 在 `session().ready()` 已就绪时改为同步写入，避免 `queueMicrotask` 与后续按键竞态吞字；
  - `prompt-input.tsx` 在普通单文本节点输入时不再调用 `renderEditorWithCursor` 重建 DOM；
  - 在 `handleKeyDown` 中显式处理 `Ctrl/Cmd+A`，使用 `range.selectNodeContents(editorRef)` 一次性全选多行内容。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #27 — 桌面端：assistant 回复中单词间空格丢失（如 `"make theedit"`）及 `aria-hidden` 焦点警告 (`BUG-20261019-512`)

- **修改文件 (Affected Scope)**:
  - `packages/session-ui/src/components/markdown.tsx`
  - `packages/session-ui/src/components/markdown.css`
  - `packages/app/src/pages/session/timeline/message-timeline.tsx`
- **根因分析与修复 (Root Cause & Fix)**:
  - 在 `markdown.tsx` 的 morphdom 更新钩子与 `markdown.css` 中保护内联 `<code>` 两侧空白；
  - 在 `message-timeline.tsx` 将非激活页面设为 `aria-hidden="true"` 前先对其内部活跃焦点元素调用 `blur()`。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #28 — 桌面端：回复流式显示、`Thinking` 双标题与折叠状态优化 (`BUG-20261019-513`)

- **修改文件 (Affected Scope)**:
  - `packages/app/src/pages/session/timeline/rows.ts`
  - `packages/session-ui/src/components/message-part.tsx`
  - `packages/apexo/src/session/processor.ts`
- **根因分析与修复 (Root Cause & Fix)**:
  - 服务端实时分离 `<think>` 流与正文流；前端 `rows.ts` 在正文或工具卡片出现后自动折叠已完成的 `Thinking` 行；`message-part.tsx` 移除重复的内层 `Thinking` 标题并统一折叠头展示。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #29 — 桌面端：Hooks 面板在会话已运行多轮后仍提示「has not been captured yet」 (`BUG-20261019-514`)

- **修改文件 (Affected Scope)**:
  - `packages/apexo/src/session/prompt.ts`
  - `packages/app/src/components/hooks-dialog.tsx`
- **根因分析与修复 (Root Cause & Fix)**:
  - 移除 `prompt.ts` 第 1324 行仅在 `session.runtimeProfile === "grok-build"` 时才捕获 hooks 快照的判断，使所有会话首次运行 prompt 时均自动捕获 hooks 快照。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/apexo && bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip`（346/346 通过）。

---

## #30 — 桌面端：Linux 上 Command sandbox 面板显示仅限 macOS 且冗余空状态；关闭对话框后首次点击无效 (`BUG-20261019-515`)

- **修改文件 (Affected Scope)**:
  - `packages/ui/src/context/dialog.tsx`
  - `packages/app/src/components/command-sandbox-dialog.tsx`
  - `packages/app/src/i18n/en.ts`
- **根因分析与修复 (Root Cause & Fix)**:
  - 在 `dialog.tsx` 中关闭对话框时立即卸载遮罩层，移除 100ms 延迟与 `startTransition`，解决关闭弹窗后首次点击被吞的问题；
  - 更新 `en.ts` 中 `commandSandbox.scope` 文案同时说明 macOS `seatbelt` 与 Linux `bubblewrap`，并在 `command-sandbox-dialog.tsx` 中当 `profile === "off"` 时隐藏冗余的「No confirmed command execution」卡片。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #31 — 桌面端：Side question / Workflows / Goal 对话框样式未完成与 `[object Object] tokens` (`BUG-20261019-516`)

- **修改文件 (Affected Scope)**:
  - `packages/app/src/components/side-question-dialog.tsx`
  - `packages/app/src/components/workflow-dialog.tsx`
  - `packages/app/src/components/session-goal.tsx`
- **根因分析与修复 (Root Cause & Fix)**:
  - 为三个对话框全部启用 `fit` 紧凑高度与 `pt-2` 间距，美化文本域、下拉选择框、双列数字输入框和隐藏式文件上传按钮，并在 `session-goal.tsx` 中将对象类型的 `entry.tokens` 汇总为数值总和，消除 `[object Object] tokens`。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #32 — 桌面端：设置中没有主题/外观选项；两个分区都叫「General」 (`BUG-20261019-517`)

- **修改文件 (Affected Scope)**:
  - `packages/app/src/components/settings-general.tsx`
  - `packages/app/src/components/settings-v2/general.tsx`
  - `packages/app/src/components/settings-v2/settings-v2.css`
  - `packages/app/src/components/dialog-settings.tsx`
  - `packages/app/src/i18n/en.ts`
- **根因分析与修复 (Root Cause & Fix)**:
  - 将 `AppearanceSection`（Color scheme / Theme / Font）移至 `Settings > General` 顶部；为 `GeneralSection` 添加独立的 `Preferences` 小标题；移除 `General` 顶部标题的 `sticky` 浮动遮挡并恢复可见滚动条。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #33 — 桌面端：`≡` 图标打开应用菜单而非会话列表，「Apexo」项点击无反应，会话入口难以发现 (`BUG-20261019-518`)

- **修改文件 (Affected Scope)**:
  - `packages/app/src/components/windows-app-menu.tsx`
  - `packages/app/src/components/titlebar.tsx`
- **根因分析与修复 (Root Cause & Fix)**:
  - 将 `WindowsAppMenu` 顶部的静态 `Apexo` 标签替换为可点击的 **Projects and sessions** 与 **New Session** 菜单项，并将标题栏 `grid-plus` 按钮的提示文案更新为 `Projects and sessions`。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #34 — 桌面端：slash 菜单中 `/tasks` `/goal` `/hooks` `/sandbox` `/feedback` `/workflow` 缺少描述 (`BUG-20261019-519`)

- **修改文件 (Affected Scope)**:
  - `packages/app/src/components/background-tasks.tsx`
  - `packages/app/src/components/session-goal.tsx`
  - `packages/app/src/components/session-hooks.tsx`
  - `packages/app/src/components/session-command-sandbox.tsx`
  - `packages/app/src/components/session-feedback.tsx`
  - `packages/app/src/components/session-workflow.tsx`
- **根因分析与修复 (Root Cause & Fix)**:
  - 为全部 6 个斜杠命令注册补齐本地化 `description` 字段。
- **复测与验证 (Retest & Verification)**:
  - `cd packages/app && bun run test:unit`（91/91 通过）与 `bun turbo typecheck`（21/21 通过）。

---

## #35 — 桌面端：diff 头部把项目内文件显示为 `/hello.py`（像在根目录） (`BUG-20261019-520`)

- **修改文件 (Affected Scope)**:
  - `packages/session-ui/src/components/message-part.tsx`
- **根因分析与修复 (Root Cause & Fix)**:
  - 新增 `relativizeProjectPath(input, workingDirectory)` 剥离项目根目录前缀与多余的前导 `/`，且当相对目录为空或 `"/"` 时隐藏目录前缀。
- **复测与验证 (Retest & Verification)**:
  - `bun turbo typecheck`（21/21 通过）与 `packages/app` 单元测试通过。

---

## #36 — 桌面端：窄窗口（~350px）下 sticky「Edit」头部遮挡下方文件头 (`BUG-20261019-521`)

- **修改文件 (Affected Scope)**:
  - `packages/session-ui/src/components/message-part.css`
- **根因分析与修复 (Root Cause & Fix)**:
  - 将 `[data-component="tool-Part-wrapper"] [data-slot="Sticky-accordion-header"]` 设为 `position: relative; top: auto;`，消除与外层 sticky 工具头的重叠。
- **复测与验证 (Retest & Verification)**:
  - `bun turbo typecheck`（21/21 通过）与 `packages/app` 单元测试通过。

---

## #37 — Desktop: Reasoning text leaked into "Thinking" row during tool calls when "Show reasoning summaries" is OFF (`BUG-20261020-522`)

- **Affected Scope**:
  - `packages/app/src/pages/session/timeline/rows.ts`
  - `packages/app/src/pages/session/timeline/message-timeline.tsx`
  - `packages/app/src/utils/message-part-text.test.ts`
- **Observed vs. Expected**:
  - **Observed**: With "Show reasoning summaries" disabled, while a tool call or permission request is active (`lastPartType !== "text"`), `TimelineRow.Thinking` rendered `Thinking The user wants me to create a file...` in the timeline.
  - **Expected**: When "Show reasoning summaries" is disabled, only the neutral `Thinking` indicator is rendered and raw chain-of-thought prose is never shown.
- **Root Cause**:
  - `constructMessageRows` extracted `reasoningHeading` even when `showReasoning` was `false`, `reasoningHeading` fell back to `lines.at(-1)` prose, and `TimelineThinkingRow` rendered `reasoningHeading` inside `<Show when={!props.showReasoningSummaries}>`.
- **Fix**:
  - Removed the raw prose fallback from `reasoningHeading`, gated `heading` extraction on `showReasoning`, and changed `TimelineThinkingRow` to `<Show when={props.showReasoningSummaries && props.reasoningHeading}>`.
- **Verification**:
  - `cd packages/app && bun run test:unit` and `bun turbo typecheck --concurrency=2`.

---

## #24 (Follow-up) — Desktop: Reasoning summaries were not collapsible when "Show reasoning summaries" is ON (`BUG-20261020-523`)

- **Affected Scope**:
  - `packages/session-ui/src/components/message-part.tsx`
  - `packages/session-ui/src/components/part-default-open.ts`
  - `packages/session-ui/src/components/message-part.css`
- **Observed vs. Expected**:
  - **Observed**: Reasoning parts rendered as plain muted markdown text without a collapse/expand toggle.
  - **Expected**: Reasoning summaries render inside a `<Collapsible>` block (collapsed by default) with a clickable `Thinking` trigger and arrow.
- **Root Cause**:
  - `PART_MAPPING["reasoning"]` rendered `<PacedMarkdown>` directly without a `<Collapsible>` wrapper.
- **Fix**:
  - Wrapped `PART_MAPPING["reasoning"]` in `<Collapsible>` (defaulting to collapsed via `partDefaultOpen` and controlled by `toolOpen`/`onToolOpenChange`).
- **Verification**:
  - `cd packages/app && bun run test:unit` and `bun turbo typecheck --concurrency=2`.

---

## #38 — Desktop: Permission card file path missing leading `/` in non-Git projects (`BUG-20261020-524`)

- **Affected Scope**:
  - `packages/apexo/src/project/instance-context.ts`
  - `packages/apexo/src/tool/write.ts`
  - `packages/apexo/src/tool/edit.ts`
  - `packages/apexo/src/tool/read.ts`
  - `packages/apexo/src/tool/apply_patch.ts`
  - `packages/apexo/src/agent/agent.ts`
  - `packages/app/src/pages/session/composer/session-permission-dock.tsx`
- **Observed vs. Expected**:
  - **Observed**: In non-Git projects (`instance.worktree === "/"`), permission prompts displayed `home/box/Default Project/qa25.txt` without the leading `/`.
  - **Expected**: Permission prompts display the project-relative path (`qa25.txt`) for project files or a valid absolute path (`/etc/hosts`) with its leading `/`.
- **Root Cause**:
  - Tools called `path.relative(instance.worktree, filepath)` directly; when `instance.worktree === "/"`, `path.relative("/", "/abs/path")` stripped the leading `/`.
- **Fix**:
  - Added `projectRelativePath(filepath, ctx)` in `instance-context.ts` and normalized patterns in `SessionPermissionDock`.
- **Verification**:
  - `cd packages/apexo && bun test test/tool/read.test.ts` and `cd packages/app && bun run test:unit`.

---

## #39 — Desktop: Orphaned follow-up description text above composer while generating (`BUG-20261020-525`)

- **Affected Scope**:
  - `packages/app/src/pages/session/composer/session-composer-region.tsx`
- **Observed vs. Expected**:
  - **Observed**: While generating a reply, the text `"Choose whether follow-up prompts steer immediately or wait in a queue"` appeared above the composer without any associated control.
  - **Expected**: No orphaned settings description text appears above the composer during generation.
- **Root Cause**:
  - `session-composer-region.tsx` rendered `settings.general.row.followup.description` inside `<Show when={controller.working() && ...}>` without any interactive control.
- **Fix**:
  - Removed the orphaned `<Show>` block from `session-composer-region.tsx`.
- **Verification**:
  - `cd packages/app && bun run test:unit` and `bun turbo typecheck --concurrency=2`.

---

## #40 — Desktop: Single newlines in assistant markdown collapsed into spaces (`BUG-20261020-526`)

- **Affected Scope**:
  - `packages/ui/src/context/marked-parser.tsx`
- **Observed vs. Expected**:
  - **Observed**: Single-newline lists (`one\ntwo\nthree\nfour\nfive`) rendered on a single line (`one two three four five`).
  - **Expected**: Single line breaks in markdown responses render as `<br>` line breaks.
- **Root Cause**:
  - `createMarkdownParser` in `marked-parser.tsx` did not enable `breaks: true`.
- **Fix**:
  - Enabled `breaks: true` in `createMarkdownParser`.
- **Verification**:
  - `cd packages/app && bun run test:unit` and `bun turbo typecheck --concurrency=2`.

---

## #33 (Follow-up) — Desktop: `≡` menu top-level `Apexo` item, `DEV` badge toggle in built dev channel, and unified `New Session` shortcut (`BUG-20261020-527`)

- **Affected Scope**:
  - `packages/app/src/components/windows-app-menu.tsx`
  - `packages/app/src/pages/layout-new.tsx`
  - `packages/app/src/pages/layout.tsx`
- **Root Cause & Fix**:
  - Added a clickable top-level `Apexo` item in `WindowsAppMenu` that opens an About Apexo dialog, unified the `New Session` shortcut and handler between the top-level menu item and `File > New Session`, and enabled `debugTools` toggle when `import.meta.env.VITE_APEXO_CHANNEL === "dev"`.
- **Verification**:
  - `cd packages/app && bun run test:unit` and `bun turbo typecheck --concurrency=2`.

---

## #18 (Follow-up) — Server: Reject disallowed cross-origin `OPTIONS` preflight requests with HTTP 403 (`BUG-20261020-528`)

- **Affected Scope**:
  - `packages/apexo/src/server/routes/instance/httpapi/server.ts`
  - `packages/apexo/test/server/httpapi-cors.test.ts`
- **Root Cause & Fix**:
  - Validated `Host` and `Origin` headers (`isAllowedRequestOrigin`) before `HttpMiddleware.cors` so disallowed cross-origin `OPTIONS` preflight requests are rejected with `403 Forbidden: Invalid Origin header` instead of `204`.
- **Verification**:
  - `cd packages/apexo && bun test test/server/httpapi-cors.test.ts`.
