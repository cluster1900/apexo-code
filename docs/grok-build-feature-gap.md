# Grok Build 功能完成情况与差距

更新：2026-10-13；工作分支：`grok-agent-roadmap`。

对照两条基线：官方源码 [2bdd1d6](https://github.com/xai-org/grok-build/tree/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8)，以及本机实际运行的 Grok CLI 1.0.52。后者部分工具仍使用旧名称，不能直接按字符串比较新版源码的清单。

## 本轮范围

本轮补齐工具清单、后台任务/Subagent、Plan/LSP、文件型 Memory、进程内 Scheduler/Monitor、图片视频生成，并执行 CLI、Desktop、官方 Grok 的回归。Marketplace 按要求不做。

Apexo CLI 和 Desktop 共用 Apexo 的会话、权限和工具执行层。`grok-build` profile 提供官方风格工具契约；`apexo acp --backend grok-build` 则运行官方 `grok agent stdio`。这两种执行循环仍然独立，Desktop 默认没有切换为官方 Rust runtime。

这些工具在 `grok-build` profile 下启用：CLI 使用 `apexo run --profile grok-build`；Desktop 启动环境设置 `APEXO_RUNTIME_PROFILE=grok-build`。默认 `apexo` profile 保持原有工具集合，Desktop 暂无可视化 profile 切换入口。

## 已实现和验证的能力

| 功能              | 当前行为                                                                                | 验证方式                                                                |
| ----------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 工具清单          | 共用 canonical registry；CLI streaming 清单按模型能力和会话权限过滤                     | CLI 连续场景核对清单与实际模型请求；Desktop 打包后端执行同一场景        |
| 文件操作          | read/list/grep/write/search_replace 复用真实文件实现与权限                              | 两端实际写入、读取、替换；官方 ACP 执行对应操作                         |
| 后台 Shell        | `block_until_ms=0` 立即返回；正数限制等待时间，任务继续执行                             | 两端启动、等待完成并读取 `SHELL_OK`                                     |
| 输出与取消        | `get_task_output`、`wait_tasks`、`kill_task`；多任务共享等待预算；运行中可读取最新输出  | ownership、超时、取消测试；两端读取运行中的 Monitor 输出后取消          |
| Subagent          | 同步/后台任务、续聊、父 Session ownership、保留原 agent、等待结果                       | 两端创建真实子 Session 并续聊；官方创建子 agent、等待并读回结果         |
| Plan              | 进入计划模式；拒绝退出保留 Plan；批准后写入 Build 切换消息                              | 真实 Session、Question、投影服务回归；canonical 权限别名测试            |
| LSP               | 位置操作、无文件参数的 workspaceSymbol；真实路径归一                                    | 真实 TypeScript server 返回 hover、定义位置和工作区符号；符号链接回归   |
| Memory            | read/remember/flush/dream；工作区隔离、原子写入、并发锁、重复笔记合并；新提示自动加载   | 并发写入与重载测试；两端保存、读取、整理                                |
| Memory 入口       | `/memory`、`/remember`、`/flush`、`/dream` 来自共享命令表                               | 命令注册测试；CLI streaming 命令列表检查                                |
| Monitor           | 后台 Shell、实时输出快照、独立取消、保留 Shell 权限；删除 Session 时取消所属任务        | 两端运行、查询、取消；权限测试                                          |
| Scheduler         | 创建、列出、更新、取消、立即执行、单次/重复执行、7 天过期                               | TestClock 驱动实际 BackgroundJob；拒绝/无效更新保留旧任务；两端管理操作 |
| 图片              | `image_gen`，xAI API key 或现有 OAuth 登录；按 Session 保存并返回附件                   | 本地协议测试；真实 OAuth 生成 JPEG                                      |
| 视频              | `image_to_video`、`reference_to_video`；正确引用结构、轮询、下载、取消和超时            | 本地协议/取消测试；真实 OAuth 各生成一个 6 秒 MP4                       |
| Desktop 媒体展示  | 图片预览、视频/音频播放器、附件下载                                                     | 生产组件浏览器检查，验证图片、视频 controls、下载链接                   |
| PTY               | POSIX 使用 Bun 原生 terminal；保留退出码、快速退出输出、延迟订阅；Windows 保留原 ConPTY | 固定 Bun 1.3.14 下 PTY HTTP/WebSocket 与 30 次快速退出验证              |
| 官方 ACP 生命周期 | 转发协议；代理中断时终止官方子进程                                                      | 真实官方 prompt、工具调用和 end_turn；代理退出测试                      |

## 三端的一致性边界

- Apexo registry 的基础集合为 25 项；`web_search` 仅在配置相应能力时出现。
- 无交互的 `apexo run` 禁用提问和 Plan 切换，因此不会向模型或 streaming 清单宣传 `ask_user_question`、`enter_plan_mode`、`exit_plan_mode`。交互式 CLI 和 Desktop 保留这些入口。用户权限还可能进一步减少工具集合。
- 官方 1.0.52 的实际事件使用 `run_terminal_command`、`spawn_subagent`、`get_command_or_subagent_output` 等旧名称；Apexo 的 canonical 名称分别是 `run_terminal_cmd`、`task`、`get_task_output`。名称兼容映射不代表底层 runtime 相同。
- CLI 和 Desktop 共用同一权限规则，包括自定义默认 agent 的权限；跨父 Session 的子任务操作会拒绝。媒体读本地参考文件需要 read 权限，工作区外还需 external_directory，保存结果需要 edit 权限。
- 媒体 API 复用 xAI provider 的 OAuth 刷新逻辑。下载 CDN 媒体不携带 xAI Authorization。

## 本轮修复的具体问题

1. 后台 Shell/Monitor 只在结束后能看到输出；现在运行中更新快照，等待超时也返回最新快照。
2. Monitor/定时子任务曾替换掉原来的权限询问；现在保留实际执行工具的权限检查。
3. 定时任务接受 `durable=true` 却没有恢复能力；现在明确拒绝，不生成虚假的持久任务。
4. 修改定时任务前先取消旧任务，导致无效参数或拒绝授权也丢失任务；现在先完成校验和授权。
5. Memory 未自动进入后续提示，也没有 slash 入口；现在补齐，并避免并发写入覆盖、重复时间戳笔记无法合并。
6. 视频请求与响应字段不符合 xAI API；修正参考图/语音/关键帧结构及 `video.url` 解析。
7. 媒体仅支持环境变量 API key；现在复用 provider API key/OAuth，三种工具均完成真实生成。
8. 媒体保存在通用目录且没有可展示附件；现在绑定会话工作区和 Session 目录，返回附件并渲染预览。
9. 计划/子任务别名遗漏权限映射，CLI 清单也没有反映 Session 的禁用规则；现在共用权限过滤。
10. LSP 遇到工作区的符号链接路径时可能找不到已存在的 server；现在先解析真实路径。
11. ACP 代理退出后可能遗留官方进程；现在转发 SIGINT/SIGTERM 和 Effect 取消。
12. 旧 PTY 回调注册存在快速退出丢事件的窗口；POSIX 改由 Bun 统一管理进程退出与终端 I/O。
13. 自定义默认 agent 时，CLI 清单仍按 `build` 权限过滤；现在跟随实际默认 agent，并使用 Session 已选模型。已复现修复前多报被禁用 `grep` 的问题，并验证修复后两端一致。
14. Scheduler 的最大合法间隔 `7d` 恰好碰到过期时间，首次执行被跳过；现在依据计划触发时间判断，允许期限内的最后一次触发，并有测试时钟回归覆盖。

## 仍未实现、不能宣称官方完整 parity 的部分

| 能力                      | 边界 / 后续条件                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| 官方 runtime 驱动 Desktop | 尚无完整 backend 选择、Session 映射与事件适配；当前官方入口是 ACP 代理                                  |
| Desktop profile 入口      | 当前通过启动环境启用 Grok profile；尚无设置页中的 profile/backend 选择器                                |
| 后台任务跨进程恢复        | BackgroundJob/Monitor/Scheduler 仍为进程内状态；进程退出后不会自动恢复或重试模型任务                    |
| Scheduler durable         | 明确不支持 `durable=true`；如确有跨重启需求，需要单独设计持久调度与恢复策略                             |
| Monitor 自动唤醒          | 支持实时查询输出；尚无官方逐行通知、速率限制和主动中途唤醒语义                                          |
| Memory 高级能力           | 文件型笔记及文本查询；`dream` 是确定性去重，不是向量检索、LLM 自动整理或后台 watcher；没有专用管理面板  |
| 媒体高级能力              | 本轮覆盖生成、引用、取消、保存和展示；未实现 image_edit、S3/ZDR、逐段视频事件                           |
| Marketplace               | 按要求暂缓；不混用官方和 Apexo plugin 生命周期                                                          |
| 其他官方体验              | 会话 dashboard、全部 slash 命令、sandbox 隔离、hooks、usage/trace 未做逐项等价验收；保留 Apexo 现有实现 |
| V2 runtime                | 本轮 Grok profile 运行在默认 Apexo兼容会话路径；不宣称已把全部工具迁移进独立 V2 SessionRunner           |
| 跨平台                    | 本次在 macOS arm64 验证 Bun 和 Electron；尚未在 Windows/Linux 执行，需要相应 CI 验证                    |

以上为明确的产品/架构边界；它们不应在发布说明中被描述为“与官方所有功能完全一致”。

## 可重复执行的回归

从 `packages/apexo` 执行：

```sh
bun script/grok-parity.mjs cli
bun script/grok-parity.mjs cli restricted
```

从 `packages/desktop` 构建，再用 Electron 自带的 Node 运行打包后端：

```sh
bun run build
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ../apexo/script/grok-parity.mjs desktop
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ../apexo/script/grok-parity.mjs desktop restricted
```

脚本使用隔离工作区和本地 provider/media fixture，执行 22 步真实工具链：文件写读改、后台命令及读取、Monitor 查询与取消、Scheduler 创建列出取消及实际触发子 agent、Memory 保存读取整理、三种媒体生成、Subagent 执行续聊与等待。断言文件内容、输出标记、工作区路径和 CLI manifest；日志保存在脚本打印的临时目录。

`restricted` 场景设置自定义默认 agent 并禁用 `grep`，检查模型请求及 CLI 清单都移除该工具。两端的普通与受限场景均通过。

这个脚本验证真实 CLI/打包后端与工具实现；媒体上游在脚本中是 fixture。真实 xAI 媒体调用另行使用当前 OAuth 完成，不能将两类验证混为一谈。

本次额外验证：

- 官方 `apexo acp --backend grok-build` 完成实际读写、替换、后台 Shell、Subagent，返回 `end_turn` 与 `OFFICIAL_PARITY_OK`。
- 真实 TypeScript LSP 返回 `greet` 的 hover 类型、定义位置、workspaceSymbol。
- 生产工具组件 100 行挂载：修改前中位数 9.8 ms / P95 15.2 ms；修改后 10.1 ms / P95 16.6 ms。这是局部组件基准，不是完整 Desktop 启动性能。
- 生产组件加载真实生成的 JPEG 和 MP4：图片正常解码，视频 544×544、6.04 秒，播放时间正常推进，下载入口存在；检查了实际样式截图。
- Bun 1.3.14：PTY 与扩展专项 22 通过；另验 256 KiB 输出完整排空及 30 次快速退出。Plan/权限/LSP/registry/扩展集中回归 114 通过；固定版本 LSP 专项 5 通过。
- 全仓 typecheck：21/21 通过；client `check:generated` 通过。
- HTTP API coverage/auth/effect：每组 204 通过，0 失败、0 跳过、0 缺项。
- 前端现有单元测试：2 通过。仓库中没有脚本所引用的完整浏览器 E2E 目录，因此另行运行了生产组件浏览器检查。
- CI 同款全量后端套件：3441 通过、0 失败、19 跳过、1 TODO，46 个快照；耗时 8 分 23 秒。跳过项包括平台限制、未配置的录制凭据和既有禁用场景，不能记作全部已覆盖。
- 全量之后补充 Scheduler `7d` 边界修复：受影响的扩展/adapter 套件 25 通过；重新执行全仓 typecheck、Desktop 生产构建及 CLI/Electron 的 22 步受限场景，均通过。

## 相关实现

- `packages/apexo/src/tool/grok-build.ts`：canonical adapter 与后台任务契约。
- `packages/apexo/src/tool/grok-build-extensions.ts`：Memory、Monitor、Scheduler。
- `packages/apexo/src/tool/grok-build-media.ts`：媒体协议、权限、保存与附件。
- `packages/core/src/workspace-memory.ts`：持久笔记。
- `packages/core/src/background-job.ts`：后台状态与实时快照。
- `packages/session-ui/src/components/tool-attachments.tsx`：共享媒体展示。
- `packages/apexo/script/grok-parity.mjs`：CLI/Desktop 可重复回归。
