# Plugins：插件商城与三端管理

更新：2026-10-14。产品名称统一为 **Plugins**，简体中文为“插件”。这是用户新授权的范围，取代此前 Marketplace 暂缓的决定。

此前阶段 CI 同款全仓回归为 3665 pass、19 skip、1 todo、0 fail；类型检查 21/21、HTTP API 三组各 222 项与 Client 生成校验通过，包含插件存储和 Hooks 既有测试。日志 `/tmp/apexo-goal-all-tests.log`；这不是最新全部增量的全仓验收，后续变更证据见实施记录。商城与实际推荐下载仍以下方专项验证为准。

## 已实现

Desktop 提供独立商城、设置页入口和命令面板入口。采用卡片列表、搜索、来源筛选、“发现 / 已安装 / 来源”三个视图，以及插件详情、能力清单和安装确认。可以安装自己的 Git 仓库或本地目录，也可以下载推荐插件。

CLI、迷你终端、全屏终端和 Desktop 通过同一插件库管理状态。Desktop 与 CLI 指向同一本地服务数据目录时共享安装结果；连接远程服务时，插件安装在该服务所在机器，下载路径也是服务端路径。

| 功能       | 行为                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| 推荐目录   | 默认注册 xAI 官方 Git 目录，首次打开空商城时加载；刷新失败保留已有目录 |
| 自定义来源 | 添加、刷新和移除 Git / 本地目录；兼容 Grok 与 Claude 风格的目录清单    |
| 下载       | 保存独立快照，不启用、不运行插件；已下载插件可以离线安装               |
| 安装       | 用户确认信任后启用；CLI 需要 `--trust`                                 |
| 管理       | 启用、禁用、更新、卸载；更新失败保留原版本；禁用状态在更新后保留       |
| 详情       | 展示来源、版本、实际能力清单、已下载路径与本地 README                  |
| 配置加载   | 加载具备命名空间的 Skills、Commands、Agents、MCP、LSP 和受支持的 Hooks |
| 应用变更   | 空闲项目可重新加载；有运行中会话或后台任务时拒绝重载，避免中断工作     |
| 冲突保护   | 不允许不同来源的同名插件同时启用；有歧义时需要完整插件 ID              |
| 持久化     | 写入时加跨进程锁，并以临时文件替换注册表；安装快照与来源目录分开保存   |

推荐目录实测为 31 项；CLI 和 Electron 后端均成功下载固定版本的 Neon，下载后仍未启用。目录会随上游变化，数量不是产品常量。

## 使用

Desktop：主页侧栏 **Plugins**、命令面板 **Plugins**，或设置 → **Plugins**。选择推荐插件进入详情，再选择“下载”或“安装”；“自行安装”接受 Git 地址或本地目录。“来源”页可添加自己的目录。

终端会话输入 `/plugins`。`r` 刷新，`/` 搜索，`a` 自行安装，`s` 添加来源，`Tab` 切换来源视图；`i` 安装、`d` 下载、空格启停、`u` 更新、`x` 移除、`l` 应用变更。需要信任的操作会显示确认。

```sh
apexo plugins refresh
apexo plugins list --json
apexo plugins list --installed --json
apexo plugins details '<完整插件 ID>'
apexo plugins download '<完整插件 ID>'
apexo plugins install '<完整插件 ID>' --trust
apexo plugins install --source ./my-plugin --trust
apexo plugins install --source owner/repository@revision#subdirectory --trust
apexo plugins add-source ./my-plugin-catalog
apexo plugins disable '<完整插件 ID>'
apexo plugins enable '<完整插件 ID>'
apexo plugins update '<完整插件 ID>' --trust
apexo plugins uninstall '<完整插件 ID>'
apexo plugins remove-source '<来源 ID>'
```

安装状态先持久化，再由项目加载。已打开的项目需点击“应用到当前项目”或重新打开；运行中的项目继续使用原来的快照。用户和项目配置优先于插件提供的默认配置，插件 Agent 不会通过自己的配置提高宿主权限。

## 与官方 Grok Build 的对应关系

对照基线为官方安装版 `1.0.52 (0920c8169e27)`，源码参考 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`。

| Grok Build                                                    | Apexo                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `plugin marketplace add/list/update/remove`                   | Plugins 来源管理；对外界面不用 Marketplace 名称       |
| `plugin install/list/details/enable/disable/update/uninstall` | `plugins` 子命令、终端浏览器、Desktop 商城            |
| 安装时显式信任                                                | GUI 确认与 CLI `--trust`                              |
| 固定 Git SHA 与组件目录                                       | 支持固定 SHA 验证、目录边界检查和实际组件扫描         |
| Skills / Commands / Agents / MCP / LSP                        | 转换后接入现有 Apexo 运行时，名称使用 `插件名:组件名` |
| Hooks                                                         | 部分兼容，详见下方；不能据此宣称全部插件行为等同官方  |

## 已知边界

- Hooks 支持 command / HTTP，以及 SessionStart、SessionEnd、UserPromptSubmit、PreToolUse、PostToolUse、Stop。支持拒绝工具调用和附加上下文；命令有输出限制和超时进程清理。Stop 是完成通知，不能凭 Hook 结果重新启动模型循环；`updatedInput` 被明确拒绝，不能绕过宿主权限检查。prompt / agent 类型和其他事件尚未完整兼容，详情显示提示。
- 插件 Agent 的权限覆盖、模型覆盖和其他宿主专有字段不会直接照搬。目录治理中的组织策略、签名验证、插件发布/验证工具，以及所有上游 manifest 变体不属于已验收范围。
- “下载”保存到当前服务的插件库，可在本地 Desktop 打开目录；尚无导出 ZIP 或把远程服务文件传回浏览器的功能。
- 卸载移除注册与后续加载资格。为避免破坏仍使用旧版本的会话，旧快照暂不自动清理，尚无缓存清理界面。
- Windows / Linux 的原生窗口、远程 SSH Git 凭据交互，以及全部 31 个第三方插件的真实服务调用尚未验收。
- 原有 npm 型 Apexo runtime plugin 机制继续独立工作；商城当前管理的是文件/仓库型插件包。

## 本地化与验收

62 种语言都有本地化的 Plugins 名称。57 种语言包含全部 41 个新增文案；`fo`、`dv`、`tk`、`am`、`dz` 的新正文使用既有英文回退，名称复用项目已有翻译。尚不能把这 5 种语言列为完整翻译。

术语和复核范围见 [本地化记录](./plugins-localization-review.md)。端到端用例与本轮结果见 [实施与验收记录](./grok-build-implementation-progress.md)。所有测试使用隔离配置、本地测试模型或仅下载插件的流程，不代表已验证第三方账号授权及服务质量。

参考：[官方 Grok 目录](https://github.com/xai-org/plugin-marketplace)、[Codex Plugins 文档](https://developers.openai.com/plugins/build/plugins)。Desktop 借鉴目录浏览和插件管理的信息组织方式，使用 Apexo 现有组件与主题。

## 当前分支验收（2026-10-14）

在当前构建上复验了插件商城、安装管理与官方 Grok Build 对照。全部使用隔离配置与临时插件库；没有重启用户应用或修改用户插件安装。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| CLI 生命周期及共享注册表 | 15 项通过 | `/tmp/apexo-plugins-review-cli.log` |
| Electron 后端生命周期 | 13 项通过 | `/tmp/apexo-plugins-review-desktop.log` |
| 官方 Grok Build 1.0.52 对照 | 10 项通过 | `/tmp/apexo-plugins-review-official.log` |
| 原生 Electron 商城及中文推荐页 | 8 项通过 | `/tmp/apexo-plugins-review-native.log` |
| 生产浏览器安装管理、多语言、RTL、窄屏 | 24 项通过 | `/tmp/apexo-plugins-review-ui.log` |
| 官方推荐目录与真实下载 | 两端各读取 31 项，Neon 下载后未启用 | `/tmp/apexo-plugins-review-recommended-cli.log`、`/tmp/apexo-plugins-review-recommended-desktop.log` |
| 插件存储与真实 Hooks 专项 | 10 通过、43 断言、0 失败 | `/tmp/apexo-plugins-review-unit-final.log` |
| App 类型检查 | 通过 | `/tmp/apexo-plugins-review-app-types.log` |

本轮 CLI 与 Desktop 下载到相同的 Neon Git 版本 `4b40580dee0e6acfe2c7bc01bee811dbfeffef78`；状态均为 downloaded，未信任、未启用。此前记录中的版本属于当时的上游快照。原生窗口验证了设置和主页入口、下载、确认安装、中文界面及推荐目录。中文商城截图已做视觉检查：`/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-QeJVTM/plugins-native-recommended-zh.png`。

静态核对仍为 62 种语言有 Plugins 名称、57 种语言覆盖全部 41 个词条；`fo/dv/tk/am/dz` 的新增正文继续使用英文回退，补查语料与原因见本地化记录。浏览器实际检查了英文、简体中文、繁体中文、德语、日语、阿拉伯语、印地语、波兰语、泰语、土耳其语。

首次插件单测有一项因沙箱内无法监听本地 HTTP 端口而失败；在允许本地监听的隔离环境中重跑相同测试后全部通过，原始日志保留为 `/tmp/apexo-plugins-review-unit.log`。本轮没有扩大 Hooks 兼容范围，也没有重新运行全仓 CI；此前全仓检查记录见 [实施与验收记录](./grok-build-implementation-progress.md)。以上结果不代表全部第三方插件的账号授权与外部服务调用已经验收。

后续共享 Memory/ACP 修复完成后，2026-10-14 当前工作区又通过 CI 同款全仓回归：3640 pass、19 skip、1 todo、0 fail；全仓类型检查 21/21，HTTP API 三组各 222 项，Client 生成校验通过。日志前缀 `/tmp/apexo-scan-final-`，详见实施记录最后一节。这次全仓回归包含既有插件存储/Hooks 测试；商城交互和推荐下载采用上表已完成的专项证据，未扩大第三方兼容性声明。

## 此前构建及交互复核（2026-10-13）

2026-10-13 重新构建 Desktop 后复核：CLI 安装管理 15 项、Electron 后端 13 项、官方 Grok 1.0.52 对照 10 项、原生 Electron 商城 8 项、mini/fullscreen 终端各 8 项全部通过。插件专项测试 10 通过、43 断言、0 失败；App 类型检查通过。

CLI 与 Desktop 均从官方目录读取 31 项，下载 Neon 的固定版本 `1b2e687e70734599fca8158722e8c12a0e07feef`，验证下载后未信任、未启用。原生窗口验证了推荐列表、下载、安装、主页入口和中文界面。重新扫描 62 个语言文件，名称全部覆盖；41 个 Plugins 词条仍为 57 种语言完整覆盖，5 种正文回退，范围与上文一致。

最新复核重新构建了 Desktop，并再次运行以上检查，结果全部通过。日志使用 `/tmp/apexo-plugins-final-` 前缀：

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| CLI 生命周期 | 15 项通过 | `/tmp/apexo-plugins-final-cli.log` |
| Electron 后端生命周期 | 13 项通过 | `/tmp/apexo-plugins-final-desktop.log` |
| 官方 Grok Build 对照 | 10 项通过 | `/tmp/apexo-plugins-final-official.log` |
| 原生 Electron 商城及中文推荐页 | 8 项通过 | `/tmp/apexo-plugins-final-native.log` |
| mini / fullscreen 终端 | 各 8 项通过 | `/tmp/apexo-plugins-final-mini.log`、`/tmp/apexo-plugins-final-fullscreen.log` |
| 官方推荐目录与真实下载 | 两端各读取 31 项，Neon 下载后未启用 | `/tmp/apexo-plugins-final-recommended-cli.log`、`/tmp/apexo-plugins-final-recommended-desktop.log` |
| 插件专项测试 | 10 通过、43 断言、0 失败 | `/tmp/apexo-plugins-final-unit.log` |
| App 类型检查 / Desktop 构建 | 通过 | `/tmp/apexo-plugins-final-app-types.log`、`/tmp/apexo-plugins-final-desktop-build.log` |

中文推荐商城截图位于 `/private/var/folders/mt/x0n3c80j0vl7_32676xn7l9r0000gn/T/apexo-shell-cli-9PKvo7/plugins-native-recommended-zh.png`，已检查卡片布局、推荐列表、搜索和“自行安装”入口。Desktop 首次构建因沙箱网络无法读取 models.dev 而失败；允许构建所需网络访问后成功。全部使用隔离配置与测试进程。此次没有重跑全仓测试；复核覆盖 Plugins，不代表其他功能差距已完成。

## Native management and activation (2026-10-14)

The earlier acceptance above applies to the compatibility runtime. The native
Server now exposes global catalog, detail and management at `/api/plugins`,
`/api/plugins/detail` and `/api/plugins/manage`, plus Location-scoped runtime
status and explicit reload at `/api/plugins/runtime` and `/api/plugins/reload`.
All storage uses the injected Core global data directory. App and terminal
actions select the appropriate protocol and display installation separately from
the active project generation.

Native trusted bundles now supply agents, commands, embedded skills and supported
hook sources. Reload stages and validates the candidate before publishing; busy
work or failed preparation preserves the old effective generation. MCP and LSP
consumers remain unimplemented in this native checkpoint and produce an explicit
unsupported activation failure. Compatibility support must not be presented as
native execution. Existing native Session hook snapshots remain immutable until
explicitly reloaded. Full behavior and ownership are documented in
[native plugin activation](native-plugin-runtime.md).

Current acceptance: CLI and fresh packaged Desktop backend each passed 13
scenarios/three provider requests; the installed-reference lifecycle comparison
passed ten checks. Native-only production browser and actual macOS Desktop each
passed eight checks including both Chinese locales and failure recovery. Compact
and expanded native terminal panels each passed six checks; actual compatibility
mini/fullscreen apps each passed eight. Focused runtime/guard/compatibility tests
passed ten tests/47 assertions. These scoped results do not establish Windows,
Linux, remaining native MCP/LSP support or all third-party integrations.

## Native management and activation UI follow-up (2026-10-14)

The earlier native-only audit identified gaps that this slice now addresses. App/Desktop Plugins management selects the native group for native-only servers and retains compatibility routes for mixed servers. Native catalog enabled state is shown separately from the Location's active plugin snapshot. Apply is explicit; typed activation failures retain and display the prior active snapshot. Unsupported MCP/LSP consumers remain explicitly unsupported in this slice rather than being represented as active.

Production browser and actual macOS Electron acceptance each passed eight native-only UI checks, including separate enabled/active status, download/detail, supported activation, unsupported MCP failure preserving the snapshot, no model work, both Chinese locales, and successful recovery clearing the failure. Shared compact/expanded terminal panels each passed six native-action checks. Actual compatibility mini/fullscreen terminal app entry points each passed eight checks; the compatibility production browser passed 24 management, locale/RTL, and narrow-screen checks. The narrow native terminal harness verifies production panel and API actions; complete native-only terminal bootstrap is outside that evidence. See [native Plugins UI verification](testing/ui/native-plugins-routing.md) and [snapshot failure recovery](testing/ui/plugin-runtime-failure-recovery.md).

The storefront has 52 dictionary keys across all 62 locale dictionaries. The [localization review](plugins-localization-review.md) records completed dictionary coverage and rendered checks; the earlier five-locale gap is closed. Remaining platform and third-party integration boundaries above still apply.
