# Grok Build Feature Gap

状态：P0/P1 核心切片已落地，剩余能力按下表继续排期  
日期：2026-10-12  
对比基线：Apexo `grok-agent-roadmap` / `28952af`，官方 [xai-org/grok-build](https://github.com/xai-org/grok-build/tree/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8) / `2bdd1d6`

## 结论

Apexo 当前已经有一个可运行的 Grok-first agent，以及一个把部分 Apexo 工具映射成 Grok Build 风格名称的 profile。它还不是官方 Grok Build 的前端，也没有运行官方 Grok Build 的执行循环。

CLI 和 Desktop 在 Apexo server 层使用同一套 Session、Tool Registry、Permission、Provider 和 HTTP API。开启 `APEXO_RUNTIME_PROFILE=grok-build` 后，两者当前暴露的工具契约一致；但这只是 Apexo 内部一致，不代表和官方 Grok Build 一致。

本 feature 的目标是把差距变成可验收的能力清单，并明确哪些能力需要真正接入 `grok agent stdio`，哪些能力可以继续由 Apexo adapter 实现。

## 当前实现边界

README 已明确说明当前实现运行 Apexo 自己的 agent loop，目标才是把 Grok Build 放到 Apexo UI 后面。[README.md](/Users/hawk_wu/Desktop/apexo-grok/README.md:35)

当前 profile 默认仍在 Apexo 的 Session/AI SDK loop 中运行，并在 Tool Registry 返回结果时进行适配。[registry.ts](/Users/hawk_wu/Desktop/apexo-grok/packages/apexo/src/tool/registry.ts:342) 另外，`apexo acp --backend grok-build` 会透明启动官方 `grok agent stdio`，作为可选的官方 ACP 路径；它不改变默认 Apexo backend。

当前模型侧工具定义如下：

```text
ask_user_question
run_terminal_cmd
read_file
list_dir
grep
search_replace
write
task
send_subagent_message
todo_write
lsp
enter_plan_mode
exit_plan_mode
web_fetch
get_task_output
kill_task
```

`web_search` 在 headless manifest 中会被列出，但当前未启用 Exa/Parallel 时不会出现在实际 HTTP tool list 中。这是现有 profile manifest 和 runtime capability 的一个小型不一致。

## 功能差距矩阵

状态含义：

- ✅ 已有：当前可以使用，并且已有测试或运行验证。
- 🟡 部分：有相邻能力或 adapter，但契约、行为或入口不完整。
- ❌ 缺失：当前没有对应能力。
- ⬜ 目标：本 feature 需要补齐的验收结果。

| 能力 | 官方 Grok Build | Apexo 当前 | 状态 | 目标 |
| --- | --- | --- | --- | --- |
| 执行循环 | Rust Grok runtime；CLI、headless、ACP 共用 | 默认 Apexo AI SDK `streamText` loop；可选官方 ACP backend | 🟡 | Desktop/App 的官方 backend 选择、Session 映射和事件边界仍需补齐 |
| ACP | `grok agent stdio` | `apexo acp --backend grok-build` 透明代理；默认仍是 Apexo ACP | 🟡 | 补充 Desktop/App 选择入口和 permission/session 状态映射 |
| 文件读取 | `read_file` | `read_file` | ✅ | 保持 schema、offset、limit 和错误行为一致 |
| 目录读取 | `list_dir` | `list_dir` | ✅ | 保持 schema 和结果格式一致 |
| 精确编辑 | `search_replace` | `search_replace` | ✅ | 增加与官方边界条件的契约测试 |
| 文件写入 | 官方完整 tool config 未单列 `write` | `write` | 🟡 | 说明为 Apexo 扩展，或移除并完全使用官方写入语义 |
| Shell | `run_terminal_cmd`，支持 `block_until_ms` 和后台任务 | `run_terminal_command`，只把等待值映射成 timeout | 🟡 | 使用官方 ID；实现后台句柄、输出查询、完成通知和取消 |
| 后台 shell | `get_task_output`、`kill_task` | `BackgroundJob` 查询、等待、取消；CLI/Desktop 共用 | ✅ | 增加重启/断线恢复和增量输出后再宣称完整 parity |
| Subagent | `task`、`send_subagent_message` | canonical `task` adapter；消息工具复用 Task/BackgroundJob | ✅ | 补充跨进程恢复和更细的状态事件 |
| Todo | `todo_write` | `todo_write` | ✅ | 对齐字段和 UI 状态 |
| 计划模式 | `enter_plan_mode`、`exit_plan_mode` | canonical adapter，复用 Apexo plan agent | ✅ | 继续收敛 plan state、权限和 provider-turn 边界 |
| LSP | `lsp` | profile 默认启用并将 snake_case schema 映射到 Apexo LSP | ✅ | 结果格式和 LSP server lifecycle 仍需逐项对照 |
| Web | `web_search`、`web_fetch` | `web_fetch`；`web_search` 条件启用 | 🟡 | manifest 只宣传实际可用工具，统一 provider capability 检查 |
| 图片/视频 | `image_gen`、`image_to_video`、`reference_to_video` | 没有对应 Grok Build tool contract | ❌ | 增加工具、事件、附件和 Desktop 预览链路 |
| 监控 | `monitor` | 无 | ❌ | 定义监控对象、事件、停止和权限语义 |
| 定时任务 | `scheduler_create/delete/list` | 无 | ❌ | 增加 durable scheduler、通知和 CLI/Desktop 管理入口 |
| 会话 | resume、fork、dashboard、sessions、export 等 | Apexo 有 session、fork、compact、undo、export 等部分能力 | 🟡 | 逐项对齐 session id/title、fork、恢复、删除和 dashboard 行为 |
| Memory | `/memory`、`/flush`、`/dream`、`/remember` | 无完整对应集合 | ❌ | 增加持久化 memory、scope、刷新和 UI 展示 |
| Plugins/skills/hooks | 官方 plugins、marketplace、skills、workflows、hooks | Apexo 有自己的 plugin、skill、MCP 体系 | 🟡 | 定义兼容边界；不能把两个 manifest/lifecycle 直接混用 |
| Sandbox | `--sandbox`、permission modes、worktree | Apexo 有 permissions/worktree，但语义不同 | 🟡 | 写出 capability matrix；明确文件、网络、命令隔离差异 |
| CLI/headless | `grok --single`、JSON、streaming JSON、headless agent | `apexo run --profile grok-build`、JSON、streaming JSON | 🟡 | 对齐事件类型、tool manifest、错误、退出码和 session metadata |
| 配置/auth | Grok login、OAuth、models、usage、trace 等 | Apexo 有 xAI auth/provider/config | 🟡 | 保持 provider 兼容，同时明确哪些配置由 Grok runtime 管理 |

## CLI、Desktop、官方 Grok Build 的一致性要求

| 检查项 | 当前结果 | Feature 验收要求 |
| --- | --- | --- |
| CLI 与 Desktop 的 Tool Registry | 同一 profile 下实际 tool list、schema、description 相同 | 继续从 server registry/canonical manifest 生成，不允许客户端各自维护一份列表 |
| CLI profile 选择 | `apexo run --profile grok-build` 可选择 | Desktop 需要明确 profile 选择或配置入口；不能只依赖隐藏环境变量 |
| Session/Permission | 共用 Apexo server 和 durable Session record | 官方 bridge 连接时也必须保留 Session、permission 和 audit 边界 |
| Streaming events | CLI 有 Apexo streaming JSON adapter；Desktop 走 HTTP/App events | 定义一份 event mapping，覆盖 text、thinking、tool call、tool result、permission、background task、error、finish |
| ACP | CLI 已有 Apexo backend，并可选择官方 `grok agent stdio` backend | Desktop/App 仍需 backend 选择和状态展示 |
| UI commands | CLI/TUI、App/Desktop 的 slash/command palette 各有差异 | 共享能力必须有 capability 到入口的映射；纯 transport 能力要明确标为 CLI-only |
| Provider model | CLI、Desktop 都走 Apexo provider | 官方 Grok Build 模式下，model/auth/usage 的 owner 必须明确 |

## 优先级和实现切片

### P0：先解决“是不是 Grok Build”的问题

1. **Runtime strategy decision**
   - 选择 A：Apexo UI 连接官方 `grok agent stdio`，Apexo 负责 UI、Session 映射和权限边界。
   - 选择 B：继续使用 Apexo loop，但把它命名为 Grok-compatible profile，不宣称官方 Grok Build parity。
   - 验收：README、CLI help、Desktop 设置和 feature manifest 使用同一术语。

2. **Canonical capability manifest**
   - 以官方名称为 canonical ID：`run_terminal_cmd`、`task` 等。
   - adapter alias 只用于兼容旧客户端，不再把 `run_terminal_command`、`spawn_subagent` 当作官方名称。
   - CLI、Desktop、HTTP tool list、streaming `available_commands` 都从同一份 manifest 生成。
   - 验收：开启同一 profile 时，声明的工具集合等于实际可执行工具集合。

3. **Background task lifecycle**
   - 实现 task ID、输出读取、取消、完成通知、重启/断线行为和权限审计。
   - shell 和 subagent 使用一致的 task state model。
   - 验收：可启动后台命令，查询增量输出，取消命令，并在 CLI/Desktop 看到同一状态。

4. **Official ACP smoke path**
   - 最小切片只接通一个只读 prompt/tool flow。
   - 验证 `grok agent stdio` 的初始化、prompt、tool event、permission 和结束事件。
   - 验收：CLI 和 Desktop 至少有一条连接官方 ACP 的 smoke path，且不影响默认 Apexo path。

### P1：补齐核心工具和运行语义

- `task`、`send_subagent_message`、`enter_plan_mode`、`exit_plan_mode`。
- `lsp` 的 schema、结果和权限。
- `web_search` 的 capability-aware advertisement。
- shell、subagent、scheduler 共用 task lifecycle。
- plan、permission mode、sandbox、worktree 的行为矩阵。
- 事件和错误的 streaming JSON 对齐。

验收重点：同一个 prompt 在 CLI、Desktop 和 headless 模式下产生相同的工具 ID、参数校验、权限请求和完成事件。

### P2：补齐官方体验面

- Memory：`/memory`、`/flush`、`/dream`、`/remember`。
- Session dashboard、usage、trace、status line。
- Plugins、marketplace、hooks、workflows。
- Image/video tool chain 与 Desktop preview。
- Scheduler 管理界面和通知。
- 官方 CLI flags 和 slash commands 的兼容别名。

这些能力不能只添加命令名；每项都必须有持久化状态、权限边界、CLI 入口、Desktop 入口或明确的 transport-only 标记。

## 验收测试矩阵

### 静态和类型检查

```sh
bun turbo typecheck --concurrency=2
GITHUB_ACTIONS=false bun turbo test --concurrency=2
(cd packages/client && bun run check:generated)
(cd packages/apexo && bun run test:httpapi)
```

### Profile 契约

```sh
APEXO_RUNTIME_PROFILE=grok-build APEXO_CLIENT=cli \
  bun run packages/apexo/src/index.ts serve --port 41724

APEXO_RUNTIME_PROFILE=grok-build APEXO_CLIENT=desktop \
  bun run packages/apexo/src/index.ts serve --port 41725
```

对两个端口请求同一个 `/experimental/tool`，要求：

- 工具 ID 集合相同；
- schema 相同；
- description 相同；
- capability 未启用时不得出现在 manifest；
- alias 只出现在兼容层，不出现在 canonical manifest。

### 三端 smoke

| 路径 | 最小场景 | 必须验证 |
| --- | --- | --- |
| Apexo CLI | 单轮只读 prompt | text、tool list、退出码、错误 |
| Apexo Desktop | sidecar + App session | 同一 prompt 的事件、permission、session 状态 |
| 官方 Grok Build | `grok --single` 与 `grok agent stdio` | 官方 tool/event/permission contract |
| 官方 ACP bridge | Apexo UI 连接 `grok agent stdio` | 初始化、prompt、tool、permission、finish |

### 当前已完成验证

- Grok profile focused tests：107 pass，0 fail。
- 全量 typecheck：21/21 package pass。
- 全量测试：3408 pass，19 skip，1 todo，0 fail。
- HTTP API exercise：coverage/auth/effect 三种模式均 204/204 pass。
- App、Desktop typecheck 和 Desktop production build pass。
- Apexo CLI 和本机 `grok 1.0.50` 都完成只读单轮 smoke。
- CLI/Desktop profile HTTP tool list 实测一致。

官方 Rust workspace 的 `cargo check` 尚未完成，因为固定 Rust toolchain 下载在本机 rustup 阶段卡住；这不应被记录为官方代码已通过构建。

## 非目标

- 不把 Apexo 的自有 agent loop 直接改名成官方 Grok Build。
- 不在 `packages/desktop` 复制 Session、Tool Registry、Permission 或 Provider runtime。
- 不直接编辑 `src/generated` 或 `src/generated-effect`；公共 Protocol/Server HttpApi 变化必须在源文件修改后从 `packages/client` 运行生成命令。
- 不一次性实现所有官方 slash command；每个命令必须有真实状态和执行路径。
- 不把官方工具名字和 Apexo 内部名字混在同一层长期维护。

## 相关代码和文档

- [README.md](/Users/hawk_wu/Desktop/apexo-grok/README.md:35)：当前 Grok Build integration status。
- [grok-build.ts](/Users/hawk_wu/Desktop/apexo-grok/packages/apexo/src/tool/grok-build.ts:7)：当前 Grok profile adapter。
- [registry.ts](/Users/hawk_wu/Desktop/apexo-grok/packages/apexo/src/tool/registry.ts:336)：profile adapter 的接入点。
- [run.ts](/Users/hawk_wu/Desktop/apexo-grok/packages/apexo/src/cli/cmd/run.ts:180)：CLI profile 和 streaming JSON 入口。
- [server.ts](/Users/hawk_wu/Desktop/apexo-grok/packages/desktop/src/main/server.ts:44)：Desktop 设置 `APEXO_CLIENT=desktop` 的入口。
- [grok-agent-expansion.md](/Users/hawk_wu/Desktop/apexo-grok/docs/grok-agent-expansion.md)：Apexo 自身 Grok-first agent 扩展路线。
