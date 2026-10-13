# Grok Agent Expansion

状态：开放设计文档（2026-10-09）

范围：Apexo Grok-first agent runtime、skills、插件、MCP、provider 和开发流程

## 目标

Apexo 的产品身份是围绕 Grok/xAI 扩展的 coding agent。Grok 是默认的 provider、提示词和运行时优化对象；OpenAI、Anthropic、Google 以及其他兼容 provider 只能通过清晰的适配边界加入，不能反过来决定产品抽象。

这份文档把与 Pi 的比较转化为可实现的能力清单。我们借鉴 Pi 的可组合 harness 能力（skills、extensions、packages、RPC、provider catalog），不复制 Pi 的产品身份，也不把 Apexo 改造成通用模型网关。Pi 的相关能力以其公开文档为参照：[How Pi works](https://pi.dev/docs/latest/how-pi-works)、[Skills](https://pi.dev/docs/latest/skills)、[Extensions](https://pi.dev/docs/latest/extensions)、[Packages](https://pi.dev/docs/latest/packages)、[Providers](https://pi.dev/docs/latest/providers)、[RPC](https://pi.dev/docs/latest/rpc)。

当前默认的 Grok 运行路径是 AI SDK：`packages/apexo/src/session/llm.ts` 调用 `streamText`，xAI provider 由 `@ai-sdk/xai` 提供，`packages/apexo/src/session/llm/ai-sdk.ts` 再把 `fullStream` 转成 `LLMEvent`。`native-runtime.ts` 是实验性 opt-in 路径，provider ID 目前只接受 OpenAI 和 Anthropic（OpenAI-compatible 是其中一个允许的 SDK package 形态）；xAI 会回落到 AI SDK。xAI OAuth/device-code 在 `packages/apexo/src/plugin/xai.ts`，Grok 提示词选择在 `packages/apexo/src/session/system.ts`。将来可以通过 ACP 接入 Grok Build，但 Grok Build 的进程不能反过来替代 Apexo 的 Session V2、权限和资源边界。

## 当前基线

Apexo 已经具备一套较强的 agent 骨架：

- `packages/apexo/src/tool/registry.ts` 提供读写、搜索、shell、patch、fetch、task、todo、skill、MCP 和可选 code-mode/LSP 工具。
- `packages/apexo/src/agent/agent.ts` 提供 build、plan、general、explore 等内置 agent，并支持受控的后台子 agent。
- `packages/apexo/src/mcp/index.ts` 支持 stdio、SSE、Streamable HTTP、OAuth、prompts、resources 和 resource templates。
- CLI、TUI、Web、Desktop、HTTP SDK、ACP 和 Session V2 的连接关系与覆盖差异见下方矩阵；它们不自动共享同一套 skill loader、Protocol 或 branch operation。
- V1 skill loader 会扫描配置目录中的 `{skill,skills}/**/SKILL.md`（包括项目 `.apexo`、遗留 `.opencode`、`~/.config/apexo` 和 `APEXO_CONFIG_DIR`），也会扫描全局 `~/.claude/skills`、`~/.agents/skills` 以及从项目目录向上到 worktree 的同名目录，并支持 `skills.paths`、`skills.urls`。
- V2 skill loader 使用 `packages/schema/src/skill.ts` 和 `packages/core/src/skill.ts` 的另一套来源模型：目录内 glob 是 `{*.md,**/SKILL.md}`，根目录 `*.md` 可以用文件名推导 `name`，还支持可选的 `slash`。
- xAI OAuth/API key 和 Grok 模型已经是产品入口；其他 provider 是兼容能力，而不是产品主线。

当前仍待治理的部分集中在“可组合层”和“运行时治理层”：两套 skill decoder/discovery 仍保持独立，V2 package manifest、完整 project provenance 和 Desktop 安装管理仍未形成稳定公共契约。V1/V2 已各自提供最小 reload 入口，插件 trust deny、MCP 延迟发现、CLI JSONL 适配和现有 fork/revert 查看切片已经落在现有边界内。

## 不可改变的边界

1. **Grok-first。** 新的 provider、prompt、工具调用、流式事件、模型能力和 auth 设计先验证 xAI/Grok；其他 provider 只能通过 adapter/catalog 接入。
2. **Session V2 的 durable admission 与 model execution 分离。** `SessionV2.prompt(...)` 先写 durable `session_input`，再 advisory wake；不得用内存 tool loop 或旧的 `SessionPrompt.loop(...)` 取代 V2 runner。
3. **每个 provider turn 只有一次显式 `llm.stream(request)`。** 历史必须在 durable continuation 前重新加载。
4. **SessionExecution 按 Session ID 进程内协调。** 不给 drain 伪造 durable identity；本地 drain 保持 process-local，跨进程执行等 clustering 设计完成后再做。
5. **Location-scoped 资源。** SessionRunner、model resolution、tool registry、permissions 和 filesystem 都从 Location 解析；不得把 Session ID 直接传给这些资源层。
6. **保留 HTTP API 和 ACP。** JSONL RPC 作为可选兼容面加入，不替换现有 HTTP/ACP 公共协议。
7. **依赖方向不变。** Schema → Core/Protocol → Server；Client 可以依赖 Schema/Protocol，但不能依赖 Core/Server；`sdk-next` 负责组合 Client、Core、Server。

## 最小实现原则

每个功能点先交付一条真实、可验证的用户路径，再决定是否需要扩大抽象。设计文档中的目标能力不是一次性工程清单；没有实际调用方的接口、manifest 字段、生命周期层或兼容协议不提前加入代码。

实现时遵循以下规则：

1. **复用现有 seam。** 优先改现有 service、registry、HttpApi/SDK operation 或 provider adapter；只有现有边界无法表达需求时才增加新模块。
2. **一个功能一个最小切片。** 一次只解决一个行为问题，避免顺手重构相邻系统。每个 PR 应能说明新增的入口、状态和测试。
3. **不为未来预留代码。** 未被当前调用方读取的 schema 字段、package manager、RPC method、trust 状态和通用 ranking 不写入运行时。
4. **行为变化先隔离。** 会改变现有加载、权限、工具暴露或 provider 选择的实现使用实验 flag、显式配置或兼容分支，并保留回滚路径。
5. **先记录再抽象。** 先把当前行为、冲突和边界写入测试或文档；重复出现且有真实调用方时再提取共享 decoder、catalog 或 lifecycle。
6. **完成后删掉脚手架。** 最小切片验证失败时删除未使用的抽象，不让路线图变成永久 dead code。
7. **先做 CLI/Desktop 对照。** 每个面向用户的功能在进入路线图前都要标出 CLI 入口、Desktop 入口和共同的服务层。Desktop 复用 `packages/app`、生成的 Client 和 server，不在 `packages/desktop` 再复制一份运行时；如果某个能力是纯 transport adapter（例如 JSONL），要明确写成不需要 Desktop UI，而不是把缺口藏起来。

各能力的第一条最小切片如下：

| 能力 | 第一条最小切片 | 明确暂不做 |
| --- | --- | --- |
| Skills/reload | 只移除 `packages/core/src/skill.ts` 中的闭包 `Map`，让 `list()` 不返回旧解析结果；focused test 放在 `packages/apexo/test/v2/skill-v2-reload.test.ts`，从 `packages/apexo` 运行 | 不改 `Skill.Info`、Schema、Protocol、生成 Client、V1/V2 discovery 或 watcher；不在 `packages/core` 下运行测试 |
| Trust/provenance | 独立地在一个 executable registration 边界加入显式 allow/deny | 不把 trust 数据、skill 列表/调用策略或完整签名供应链绑进 skill cache 切片 |
| Grok Package | 先在现有 `package.json` 下声明一种资源（优先 skills），复用现有 file/npm 安装 | 不新建平行 manifest、包管理器、统一主题系统或通用 lifecycle framework |
| Deferred tools | 先为 MCP tools 提供一个 `tool_search` catalog，并复用现有 permission/filter | 不改内置工具注册，不同时做 embedding/ranking 和所有 plugin 类型 |
| JSONL RPC | 先包住一个已经存在且已进入 Protocol/Client 的 operation | 不先发明 method 集合、事件总线或第二套 Session runner |
| Grok provider | 先完善 AI SDK xAI 路径的一个能力（auth、model metadata 或 stream event） | 不为了 xAI 一次性扩展 native runtime 或重写 provider 抽象 |
| Branch UX | 先暴露现有 fork/revert 数据的一种 CLI/TUI 和 Desktop 查看动作 | 不新建 transcript store、branch graph 或同步协议 |
| CLI/Desktop parity | 先用同一个 server/service operation 做一条 CLI smoke path 和一条 `packages/app`/Client path | 不在 Electron 壳里复制 service、loader 或 Session runner；纯 transport adapter 不强行增加 Desktop UI |

## CLI / Desktop 覆盖矩阵

这里的 Desktop 指 `packages/desktop` 的 Electron 壳和其中复用的 `packages/app`；真正的 Session、Skill、Tool、Provider 和 MCP 运行时仍由 Apexo server 提供。CLI 既可以直接启动本地实例，也可以通过 `run --attach` 使用同一个 HTTP 服务。因此“覆盖”首先表示两边执行同一个 service/API 语义，其次才是是否有对应的管理入口。

| 能力 | CLI 当前入口 | Desktop 当前入口 | 当前结论 | 最小补齐要求 |
| --- | --- | --- | --- | --- |
| Grok/xAI provider、模型选择和 Session V2 | `run --model`、`providers`、`models`，本地或 `--attach`；xAI auth 在 provider/plugin 层 | `packages/app` 的 provider/model query 和 prompt model selector；Desktop sidecar 或远程 server | ✅ 执行路径共用；Grok 仍从 AI SDK xAI 路径进入 | 每次 provider 改动至少跑一条 CLI run 和一条 App/Client session smoke；不在 Desktop 重写 provider |
| Session prompt、stream、interrupt、queue/steer、permission | `run`/TUI 的 session loop 和 permission 交互 | `packages/app` 的 `server-sdk`、事件适配、permission/question UI | ✅ 共用 server/runtime；Desktop 不是第二个 runner | 新增 V2 行为时同时验证 CLI 本地、CLI attach 和 Desktop App client 的同一事件语义 |
| Session authorization / Grok Build permission names | `bash`、`read`、`edit`、`task` 等 canonical permission；Grok profile 的 `run_terminal_command`、`read_file`、`search_replace`、`spawn_subagent` 等别名 | 同一个 Session permission record 和 permission reply API | ✅ 一次 `always` 授权按 Session 持久化，Grok Build 与 Apexo 名称互相命中；不同 Session 不共享 | 继续保持 action canonicalization、Session DB persistence 和 `once/always/reject` 语义一致；project-wide saved grants 仍由 V2 PermissionSaved 管理 |
| Skill discovery、调用和 slash command | `Skill.Service`、`debug skill`、session skill tool；旧 command list 也把 skill 暴露为 command | V1 通过 `command.list` 进入 `packages/app` 的 slash command；V2 通过 `SkillV2`/skill tool guidance；生成的 `skills.list` 尚未成为 App 的独立列表 | △ 运行时覆盖，管理/列表不对称 | cache 切片验证 V2 `list()` 会重新读取；reload 已有独立入口，独立 skill 列表 UI 仍等真实调用方 |
| Skill reload 和下一 boundary 生效 | `debug skill --reload`；本地实例或 `--attach` 下的 V1 `POST /skill/reload` / V2 `POST /api/skill/reload` | `packages/app` 的 `skills.reload` command 通过 compatibility API 按协议调用 V1/V2 | ✅ 两边已有最小管理入口；系统上下文和已 materialize 工具在当前 provider turn 保持不变，下一次 boundary 读取新内容，skill tool 正文仍按调用时 loader 读取 | 继续复用两套 loader 和 `State.reload`；不做 watcher、Info 字段或统一 decoder |
| Trust/provenance | 插件 tuple 已支持显式 `{trust:"deny"}` gate；skill/global/URL provenance 仍未治理 | Desktop 复用 server 的插件 gate；当前没有 trust 对话框或来源状态 | △ 第一条 executable registration gate 已完成，完整来源审计仍缺 | 继续保持默认兼容加载；CLI/Desktop 的完整来源审计和 skill trust 决策另列切片 |
| Grok Package / plugin 安装 | `plugin`/`plug` 复用现有 file/npm installer 和 `package.json` manifest | `packages/app` 仅能在 V1 status popover 显示 `apexo.json` 中已配置的插件；没有安装/升级入口；执行仍由 Desktop sidecar/server 完成 | △ 执行可复用，安装管理缺 Desktop 面 | 先让一种资源在现有 installer 和 Desktop sidecar/server 上真实可加载，并复用现有状态展示；安装/升级 UI 等资源可用后再做 |
| MCP server、prompts、resources 和连接状态 | `mcp list/auth/add/logout/debug` 及 TUI/session runtime | `dialog-select-mcp`、status popover、`/mcp` slash command、server-sync | ✅ 两边都有管理和运行入口 | 新 transport 或 deferred catalog 要同时补 CLI 命令 smoke 和 App status/command smoke |
| Deferred tools / `tool_search` | 设置 `APEXO_EXPERIMENTAL_TOOL_SEARCH=1` 后由 V1 `session/tools.ts` 的默认 provider turn 暴露；它执行选中的 MCP tool | Desktop 在使用同一 V1 server/provider turn 时复用；V2 `ToolRegistry` 和 code-mode 不在本切片 | 🟡 V1 opt-in catalog、精确选择执行和 permission 已接入；V2 canonical MCP registration 仍待独立切片 |
| Fork、revert、branch/transcript UX | `run --fork`、attach 后 fork；TUI 使用现有 session 数据 | `session.fork` dialog、`session.undo`/`redo`，走 `packages/app/src/utils/server-compat.ts` | ✅ 已覆盖现有 durable fork/revert seam；V2 Protocol 迁移仍独立 | 继续复用旧 HttpApi/compat API，不建第二 transcript store；只有迁移到 V2 时才补 Protocol/Client operation |
| HTTP、ACP 和 JSONL | `serve`/`attach`、`acp`；`jsonl` 薄适配 `session.list` | Desktop sidecar 暴露 HTTP，App 使用生成 Client；没有 JSONL UI，也不是 ACP consumer | ✅ JSONL 只包现有 `session.list` framing，不新增 method/event schema；Desktop 继续使用 HTTP |
| Plugin/skill/package provenance、错误和版本兼容 | CLI installer 输出 manifest/范围错误 | Desktop 目前只显示已配置 plugin 名称和 MCP/LSP 状态 | △ 状态展示不对称 | 每个新增来源至少有一个 CLI 可读结果和一个 App 可见状态；优先复用现有 config/status query |

覆盖矩阵的验收规则是：面向用户的共享运行时能力必须有 CLI 本地、CLI attach（如果该能力走 HTTP）和 Desktop App/Client 的最小 smoke；纯内部切片（例如移除 V2 skill cache）只需要对应 package 的 focused test，不为它额外增加协议或 UI。管理能力必须两边各有一个明确入口，或者在表中标记为 transport-only 并写明替代入口。测试应落在 `packages/app` 和 server/API seam，不为 Electron 壳复制业务逻辑。

## 实现审计结论


| 审核项 | 结论 | 需要保留的边界 |
| --- | --- | --- |
| 最小化修改 | ✅ 已满足 | 第一条 skills 切片只删除 V2 闭包 `Map`；不改 `Skill.Info`、Schema、Protocol、Client、discovery 或 UI。provider 只走 AI SDK xAI；deferred tools 只改默认 `session/tools.ts` 的 MCP 注册段；JSONL 只包既有 operation。 |
| Skill cache 功能闭合 | ✅ 已实现 | `packages/core` 没有测试套件；focused test 固定放在 `packages/apexo/test/v2/skill-v2-reload.test.ts`，从 `packages/apexo` 运行。URL source 继续使用 `SkillDiscovery.pull` 的 `~/.cache/apexo/skills/` 缓存。V2 HTTP handler 会等待 location plugin boot，避免首次 list 返回空结果。 |
| Package 资源声明 | 🟡 V1 installer 已实现 | `readPluginManifest`/`packageTargets` 识别 `apexo.skills` 的相对目录，现有 installer 会把它写入 V1 `skills.paths`；当前 focused test 验证配置写入，不声称已经有 V2 manifest 或 Desktop 安装 UI。 |
| `tool_search` | 🟡 V1 默认 provider-turn 已实现 | `packages/apexo/src/session/tools.ts` 在 `APEXO_EXPERIMENTAL_TOOL_SEARCH=1` 时注册固定 schema，返回确定性 MCP catalog，并在同一次调用内复用 permission、截断和附件处理；V2 `packages/core/src/tool/registry.ts` 仍保留 canonical MCP registration 待决边界，因此本切片不宣称覆盖 V2 registry 或 `packages/codemode`。 |
| Trust/provenance | 🟡 有边界，未完成 | 第一条只做一个 executable registration 的 allow/deny；来源字段、列表/调用策略、digest/签名和全局/URL 迁移都仍待决策，不能和 skill cache 一起验收。 |
| JSONL RPC | ✅ 已选 `session.list` 薄 adapter | `apexo jsonl` 只接受 `session.list` 请求并转发 `/api/session` 的现有响应；不新增 method、事件信封或 Desktop UI。 |
| Grok provider / branch view | ✅ 现有路径已核对 | Grok 当前使用 AI SDK xAI → `streamText` → `LLMEvent`，OAuth/device code 和 Grok prompt 已在现有代码中；fork/revert 继续复用旧 HttpApi。本文不把它们误写成新增 provider 或 Protocol 迁移。 |
| CLI/Desktop 覆盖 | 🟡 reload 已覆盖，其他能力按边界区分 | skill reload 有 CLI attach、本地入口和 Desktop command；V2 plugin boot 有 HTTP focused test。JSONL 是 CLI-only adapter；Package 安装 UI、完整 provenance 和 V2 canonical deferred tools 仍未完成。 |

因此完成条件继续按切片判断：skill cache、V1/V2 reload、plugin trust deny gate、V1 MCP deferred catalog 和 JSONL adapter 已分别落地；V2 canonical deferred tools、完整 skill provenance、V2 package manifest 和 Desktop package 安装 UI 仍不属于已完成范围。

本轮实现补齐了两个运行时边界：V1 `Command.Service` 不再把 skill command 正文永久复制进初始化 state，而是在查询时从当前 Skill state 生成；V2 `PluginInternal` 暴露 location-scoped readiness，`/api/skill` 和 `/api/command` 在首次响应前等待 plugin boot。这样 reload 和首次 list 的行为与本矩阵的最小验收一致。V2 `ToolRegistry` 没有被强行接入 `tool_search`，因为当前 core 还没有 canonical MCP registration；这项边界保留为后续独立切片。

## 目标能力

### A. 可移植 Agent Skills

先把实际 loader 写清楚，再设计统一契约。V1（`packages/apexo/src/skill/index.ts`）只接受 `SKILL.md`，要求 `name`，`description` 可选；V2（`packages/schema/src/skill.ts`、`packages/core/src/skill.ts`）允许 `name`、`description`、`slash` 都可选，根目录 `*.md` 可以从文件名推导 `name`，嵌套文件若没有 `name` 会被跳过。两套 decoder 都容忍多余 frontmatter，但会丢弃，当前 `Info` 不保留 `license`、`compatibility`、`metadata`、`allowed-tools` 或 `disable-model-invocation`。没有 `description` 的 skill 可以被加载，但 V1 `Skill.fmt` 和 V2 `SkillGuidance` 不会把它放进系统提示词的可用 skill 列表。`NameMismatchError` 已定义，但当前 loader 不会抛出它。

portable skill 的最低约定仍然保持 `name`、`description`、正文；可移植扩展字段只有在两套 loader 共享 decoder 并且明确写入 `Info` 后才进入运行时契约。

实现顺序：

1. 先移除 V2 `Skill` 的内部 cache，并用 focused test 固定重新读取行为。共享 frontmatter decoder 放到有第二个真实调用方时再做。
2. 这个切片不改 `Skill.Info`、Schema、Protocol 或生成的 Client，也不记录 source/加载时间；`location` 已经是公开的 V2 `Info` 字段。
3. `packages/core/src/skill.ts` 已移除闭包内 `Map<string, Info[]>` cache，并在 `packages/apexo/test/v2/skill-v2-reload.test.ts` 用 markdown 变更后再次 `list()` 的 focused test 验证不返回旧解析。`packages/core` 没有 test script 或 test 目录，运行方式是 `cd packages/apexo && bun test test/v2/skill-v2-reload.test.ts`。对于 `directory` source，这只是重新做轻量 fs glob；对于 `url` source，`SkillDiscovery.pull` 会复用 `~/.cache/apexo/skills/` 的版本/文件缓存。现在的最小管理入口复用两套 loader：V1 `Skill.reload` 暴露为 `POST /skill/reload` 和 `debug skill --reload`，V2 `State.reload` 暴露为 `POST /api/skill/reload`，Desktop 的 `skills.reload` command 通过 compatibility API 选择对应 operation。V2 command/skill list 会等待 location plugin boot；reload 不改 `Info` 或 discovery 规则，也不做 watcher。系统提示和已 materialize 的工具定义在下一次 provider-turn boundary 更新，skill tool 执行时仍会按现有 loader 读取当前内容。
4. skill invocation 的 permission 已经存在：`packages/apexo/src/tool/skill.ts` 在调用前执行 `ctx.ask({ permission: "skill" })`，V1 `available` 和 V2 `SkillGuidance` 也会过滤被拒绝的 skill；URL/plugin skill 进入现有 loader 后沿用同一条路径，不重复接入。
5. 保持 `apexo-runtime-v2` 和 `agent-skills-portability` 作为实现约束，不为 skills 再建一套运行时。

当前行为和目标行为分开记录：V1 通过无界并发加载，同名 skill 直接写入 map，谁后完成谁覆盖，完成顺序不稳定；内置 `customize-apexo` 先注册，磁盘 skill 可以覆盖它。V2 按 source 注册顺序覆盖，同一 source 内文件先排序。本次切片决定保留两套 loader 的既有覆盖语义，不把跨 loader 的 precedence 或稳定冲突错误混入 reload；因此验收只要求重新读取，不承诺重复 skill 的新优先级。目标中的 `/reload` 语义已经确定为：正在执行的 provider turn 保持已经 materialize 的系统上下文和工具定义，新内容在下一次 safe provider-turn boundary 可见；skill tool 的正文读取继续遵循现有调用时加载语义。

### B. Project trust 与 provenance

Trust/provenance 目前只实现第一条执行边界：插件 tuple 的现有 options 可设置 `{ "trust": "deny" }`，server 和 TUI 在解析、动态 import 前跳过它；省略或未知值保持兼容加载。全局 `.claude`/`.agents` skill 和配置 URL skill 仍直接进入发现与加载流程，路径/URL、digest、签名、来源审计以及 skill trust 策略需要独立迁移，不能伪装成已完成的完整 trust 系统。

当前实现只对显式拒绝的插件生效；未配置 trust 的资源维持原有加载行为。未信任的全局或 URL skill 是否继续列出、是否只保留 inventory，以及 CLI/Desktop 如何展示来源仍待决策。

目标中的 trust decision 必须先于可执行 resource registration；被拒绝的来源可以只留下用于 UI/审计的 provenance inventory，不能进入 tool/plugin/MCP 执行面。第一条 trust 实现只在一个 executable registration 边界做本地显式 allow/deny，独立于 skill cache 和 reload；远程 source pinning、跨资源统一策略、skill 列表/调用策略和复杂供应链签名系统延后。

### C. Grok Package

当前已经有插件包模型，来源是 `package.json`：支持 file/npm 安装、`engines.apexo`、`exports["./server"]`、`exports["./tui"]`、server/TUI 入口和 `oc-themes`；配置目录下的 `{tool,tools}/*.{js,ts}` 则是另一条动态 import 路径。Grok Package 应该是对现有 `package.json` 的增量扩展，而不是新的并行 JSON，也不是替换当前插件 manifest。

资源声明的字段形状尚未定案。若增加统一声明，优先放进现有 `package.json` 的 Apexo 专用字段，并兼容现有 `exports`、`oc-themes` 和工具目录。示例里的 `engines.apexo` 应使用当前主版本范围（例如 `^1.0.0`），而不是 `>=0.5`；当前版本为 `1.18.35`，且 major 为 0 时 `checkPluginCompatibility` 会跳过检查。

一个只展示单一资源的 `package.json` 增量形状（字段名仍待定）：

```json
{
  "name": "@acme/grok-repo-tools",
  "version": "0.1.0",
  "engines": { "apexo": "^1.0.0" },
  "apexo": {
    "skills": ["skills"]
  }
}
```

这段是未来 `package.json` 扩展的讨论草案；第一条资源声明采用相对目录（例如 `skills`），由现有 loader 继续负责目录内的 `SKILL.md` glob，不把 glob 语法再复制进 package manifest。当前主题字段仍然是 `oc-themes`，不能被一个尚未实现的 `themes` 或 `apexo.themes` 替代。第一条实现已经在现有 installer 增加 skills target，并映射到现有 V1 loader 的 `skills.paths`；file/npm 安装路径已有 focused test。这是一处增量映射，不是新的 manifest 或 package manager。V2 loader 的 manifest 适配、安装管理 UI、git ref 的 source 类型和 pin 规则仍需独立切片。其他资源字段留待真实调用方出现后再决定。来源 provenance 和 requested capabilities 也属于后续 trust 设计。当前工具模块确实在 registry 初始化时 `import()`，因此“禁止 import 副作用启动进程”是未来的行为变更，需要生命周期 API、兼容策略和迁移说明，不能作为当前插件行为描述。

### D. 延迟工具发现

工具很多时，模型上下文不应默认包含所有 MCP/plugin 工具。设置 `APEXO_EXPERIMENTAL_TOOL_SEARCH=1` 后，provider turn 提供 Grok-aware `tool_search`/catalog：先返回工具名和描述；传入精确 MCP 工具名与参数时在同一次调用中执行，并复用现有 permission、插件 hook、截断和附件处理。当前没有独立的 redaction 层，不为首条切片新增一套。新工具 ID 使用 `tool_search`，不复用网页搜索真实 ID `websearch`；package tools 仍等 catalog 边界稳定后接入。

首版只覆盖 MCP tools，改动默认 provider-turn 的注册段：`packages/apexo/src/session/tools.ts` 保留实验 code-mode 的早退，并在 `APEXO_EXPERIMENTAL_TOOL_SEARCH=1` 时注册 `tool_search`。它在 turn 开始前固定 schema；没有 `tool` 时返回按名称排序的 catalog，有精确 `tool` 时直接执行所选 MCP tool，因此不假设正在运行的 AI SDK turn 能动态注入新 definition。核心工具的 definition 继续由 registry 初始化，但暴露给模型仍受条件控制：网页搜索真实 ID `websearch` 受 Exa/Parallel flags 控制，`apply_patch` 只对 model id 含 `gpt-` 且不含 `oss`、不含 `gpt-4` 时暴露，否则暴露 `edit` 和 `write`；shell 的真实 ID 是 `bash`。registry 内部的临时属性名不是模型看到的工具 ID；LSP、plan 也受 flag/client 条件控制。package tools 等到 catalog 边界稳定后接入。

### E. 可选 JSONL RPC

提供一个薄的 stdin/stdout JSONL adapter，用于编辑器、脚本和测试 harness。RPC 只负责 request/response framing；如果被包装 operation 已经产生事件，就原样转发，不创建第二套 session runner。HTTP API 仍是类型化公共服务面，ACP 仍是编辑器协议面。

首版已选择当前 Protocol/Client 的 `session.list` operation；`apexo jsonl` 只负责 stdin/stdout framing 和请求转发，不发明 method 集合。请求形状是 `{ "id": string|number?, "method": "session.list", "query"?: <session.list query> }`，响应原样承载 `/api/session` 的现有 schema，不另造事件信封、单调序号或 schema version。未来如果包装 `session.fork` 或新增 `reload`，必须先在 Protocol 声明端点，再从 `packages/client` 运行 `bun run generate`。

### F. Grok provider 深化

先把现有 AI SDK 的 xAI/Grok 路径做深：`packages/apexo/src/session/llm.ts` 的 `streamText`、`packages/apexo/src/session/llm/ai-sdk.ts` 的 `fullStream → LLMEvent`、`packages/apexo/src/provider/provider.ts` 的 provider catalog、`packages/apexo/src/plugin/xai.ts` 的 OAuth/device-code/API key 生命周期、`packages/apexo/src/session/system.ts` 的 Grok prompt 选择，以及 provider catalog 的模型能力。native runtime 继续是 opt-in，当前 xAI 会回落到 AI SDK；第一条 provider 切片只改上述 AI SDK 路径。provider adapter 必须在 LLM service 边界之后工作，不能把 xAI 特例散落在 Session runner、Tool registry 或 HTTP handlers。

secondary provider 继续保留，但只在有明确用户价值时加入；新增 provider 需要证明不削弱 Grok 默认路径、权限和可观测性。

### G. Session branch 与 transcript UX

Apexo 的数据库 session/fork/revert 是 durable source of truth。后续可增加 Pi 风格的同一 session transcript branch 导航，但实现应映射到现有 parent/fork/revert 和 Session V2 history projection，不引入第二套 JSONL transcript store。第一阶段只改善 CLI/TUI 和 Desktop 的 branch 列表、恢复和比较信息；Desktop 通过 `packages/app`/Client 复用 operation，不在 Electron 壳增加分支逻辑。

### H. Session authorization compatibility

Grok Build 与 Apexo 使用同一个 Session 授权记录。Grok Build 的工具名只作为 wire alias：`run_terminal_command → bash`、`read_file → read`、`list_dir → list`、`search_replace → edit`、`spawn_subagent → task`，其余 alias 在 `packages/core/src/v1/permission.ts` 集中 canonicalize。V1 permission、V2 permission 和 Grok Build tool adapter 都在进入规则匹配前完成这一步，因此终端、Desktop 和 ACP 不会为同一动作各自保存一份授权。

`always` 授权按 Session 写入 `session.permission`，并保留 V2 的 project-level `PermissionSaved` 记录；`once` 只解决当前请求，`reject` 只影响当前 Session 中相同的 pending requests。Session DB 是跨客户端和进程重启的 durable source of truth，内存 map 只用于当前实例快速解析。Session prompt 的工具开关采用 merge，避免覆盖已经记住的授权。

验收至少包含三条路径：Grok alias 请求由 Apexo canonical rule 放行；同一 Session 先在 Grok alias 上 `always` 再用 Apexo canonical name 不再询问；另一个 Session 仍然需要单独授权。CLI、Desktop 和 ACP 通过共享 permission service/API 验证，不在客户端复制授权状态。

## 分阶段路线

### P0：规范和低风险实现（当前切片）

- 发布本文档和 decision log。
- 加入 Grok-first、V2 runtime、HttpApi contract、provider、MCP、plugin、skills portability、CI/release skills。
- 将现有 `effect` 和 `rtl-aware-development` 作为 baseline skills 一并保留，不把它们视为本设计之外的临时文件。
- 记录 V1/V2 portable frontmatter 和 discovery 差异，提出重复/冲突处理选项；在策略决策前不改变覆盖顺序。
- 只记录 V2 skill cache 清理和未来 safe provider-turn boundary 的行为；trust/provenance 是独立切片，不放进 skill cache。
- 将上面的 CLI/Desktop 覆盖矩阵作为每个面向用户能力的入口清单；纯内部切片（例如 cache 清理）只要求对应 package 的 focused test，不为它虚构两边入口。

完成条件：新贡献者只读项目内 skills 就能知道正确扩展点、生成代码规则、Grok-first 边界、V2 禁区和 CLI/Desktop 入口；文档与实际 loader 的路径一致。

### P1：运行时组合能力

- 已移除 V2 skill cache 的闭包 `Map`，并用一个 markdown 变更后再次 `list()` 的 focused test 验证；在现有 V1/V2 loader 上补了最小 reload operation、CLI `debug skill --reload` 和 Desktop `skills.reload` command。V2 command/skill list 等待 location plugin boot，不增加 watcher 或统一 decoder。
- trust/provenance 另做一个独立切片：只在一个 executable registration 边界接入显式 allow/deny；不修改 Skill.Info，也不和 cache 失效绑定。
- 在现有 `package.json` 下声明一种资源并复用 file/npm installer；不先做通用 manifest/lifecycle manager。
- 为 V1 默认路径增加 opt-in MCP deferred catalog 与 `tool_search`（`APEXO_EXPERIMENTAL_TOOL_SEARCH=1`），复用 permission 和现有结果处理；V2 canonical `ToolRegistry`、experimental code-mode 和 package tools 后续再接入。

完成条件按切片分别判断：skill 证明 `list()` 不返回旧解析且首次 V2 list 等待 boot；reload 证明 V1/V2 operation、CLI 和 Desktop compatibility path；trust 只证明一个 executable registration 会遵守 allow/deny；package 只证明一种资源能通过现有 installer 写入 V1 配置；deferred tools 只证明 V1 MCP catalog 选中后遵守 permission，并沿用现有截断和附件处理。四项不合并为一个交付门槛。

### P2：兼容面和体验

- 为一个已经存在的 Protocol/Client operation 加入可选 JSONL RPC adapter，并沿用该 operation 的请求/响应 schema。
- 只深化 Grok provider 的一个模型能力、auth、usage 或流式事件切片。
- 如果选择接入 Grok Build ACP，只验证一个选定 Session operation 与 HTTP/CLI/TUI/Desktop 的语义一致性，保持它是可选的集成路径。
- 改善一个现有 fork/revert 数据的 CLI/TUI 和 Desktop 查看动作，仍然复用同一个 Session operation。
- 用 CLI focused test 验证所选 operation 的 JSONL framing；真实编辑器接入仍属于后续发布验证，不把它扩大成第二套协议。

完成条件：选定的 JSONL operation、现有 Grok AI SDK 路径和现有 fork/revert 查看动作分别通过各自的 CLI/Desktop 或 adapter focused test 验证；不要求一次交付完整 Grok 能力，secondary provider 或兼容层的失败不能改变所选 Grok 切片的默认体验。

## 代码落点

| 能力 | 首要落点 | 约束 |
| --- | --- | --- |
| Skills/reload | `packages/core/src/skill.ts`（cache）；`packages/core/src/plugin/internal.ts`（V2 location boot readiness）；`packages/apexo/src/skill/index.ts`（V1 reload）；`packages/protocol/src/groups/skill.ts`、`packages/server/src/handlers/skill.ts`（V2 operation）；`packages/apexo/src/server/routes/instance/httpapi/{groups,handlers}/instance.ts`（V1 operation）；`packages/apexo/src/cli/cmd/debug/skill.ts`、`packages/app/src/pages/session/use-session-commands.tsx`（CLI/Desktop） | cache 切片仍不改 `Info`；reload 只复用现有 `State.reload`/`InstanceState.invalidate`，从协议源生成 Client；readiness 是内部 location seam，不做 watcher、统一 decoder 或额外 provenance 字段 |
| Trust/provenance | `packages/apexo/src/config`, `packages/apexo/src/permission`, `packages/core/src/permission`, `packages/apexo/src/event-v2-bridge.ts` | discovery inventory 与 executable registration 分开；不绕过 permission |
| Grok Package | `packages/apexo/src/plugin`, `packages/apexo/src/tool/registry.ts`, `packages/apexo/src/skill`, `packages/apexo/src/mcp`, `packages/apexo/src/command` | 增量扩展现有 `package.json`；兼容 `exports`/`oc-themes`；生命周期可关闭 |
| Deferred tools | `packages/apexo/src/session/tools.ts`, `packages/apexo/src/mcp`, `packages/apexo/src/effect/runtime-flags.ts` | `APEXO_EXPERIMENTAL_TOOL_SEARCH=1` 时改 V1 默认 provider-turn 的 MCP 注册；V2 `packages/core/src/tool/registry.ts` 和 `packages/codemode` 保持现状，待 canonical MCP registration 决策；保留 `websearch`、model-specific `apply_patch/edit/write`、`bash` 和 feature flags；permission 与现有结果处理不变 |
| JSONL RPC | 当前切片为 `packages/apexo/src/cli/cmd/jsonl.ts` 和 `packages/apexo/test/cli/jsonl.test.ts` | 只包现有 `session.list` 的 CLI stdin/stdout framing；不改 `packages/protocol`、Server `HttpApi` 或生成 Client。未来若要暴露新 operation，先补源协议再生成 Client；不复制 Session runner；HTTP/ACP 保持稳定 |
| Grok provider | `packages/apexo/src/session/llm.ts`, `packages/apexo/src/session/llm/ai-sdk.ts`, `packages/apexo/src/provider/provider.ts`, `packages/apexo/src/plugin/xai.ts`, `packages/apexo/src/session/system.ts` | 首条只改 AI SDK xAI 路径并收敛到 `LLMEvent`；native 仅为 opt-in，不列入这条切片 |
| Branch UX | `packages/core` session store、`packages/apexo` CLI/TUI、`packages/app` | DB projection 是唯一 transcript source；Desktop 通过 App/Client 复用 operation，不在 `packages/desktop` 增加分支逻辑 |
| CLI/Desktop parity | `packages/apexo/src/cli`, `packages/app/src`, `packages/desktop/src/renderer/index.tsx`, `packages/desktop/src/main/sidecar.ts` | CLI 可本地或 `--attach`；Desktop 是 App + sidecar/远程 server；业务逻辑只放 shared service/API |

公共 Protocol 或 Server `HttpApi` 变化必须从源文件开始，并在 `packages/client` 运行 `bun run generate`；不得直接编辑 `src/generated` 或 `src/generated-effect`。

## 测试与发布门槛

测试只覆盖当前切片的行为边界：V2 cache 切片在 `packages/apexo/test/v2/skill-v2-reload.test.ts` 测试 markdown 变更后的重新读取，并从 `packages/apexo` 运行；V1 command cache 在 `packages/apexo/test/skill/command-reload.test.ts` 验证 reload 后 slash command 读取新正文；V2 首次 list 的 plugin boot readiness 在 `packages/apexo/test/server/httpapi-v2-location.test.ts` 验证。skill reload 的 V1/V2 operations 由 HTTP API exercise 覆盖，真实 CLI attach smoke 在 `packages/apexo/test/cli/debug-skill.test.ts`，Desktop compatibility path 在 `packages/app/src/utils/server-skills.test.ts`，App command 由类型检查覆盖；trust 切片测试一个 executable registration 的 allow/deny；package 切片测试一种资源通过现有 installer 写入 V1 配置；V1 deferred tools 切片在 `packages/apexo/test/session/tool-search.test.ts` 测试 MCP catalog、permission 和现有结果处理；provider、branch 或 JSONL 切片各自只测选定 operation。面向用户的切片再按覆盖矩阵补 CLI/Desktop smoke，纯内部切片不额外增加协议或 UI。仓库根目录运行的是 CI 使用的 Turbo 命令；package 自己的 `bun test` 不要从根目录运行：

```sh
bun turbo typecheck --concurrency=2
GITHUB_ACTIONS=false bun turbo test --concurrency=2
# package-local checks; each subshell starts from the repository root
(cd packages/client && bun run check:generated)
(cd packages/apexo && bun run test:httpapi)
```

V2 Skill 的 focused test 不是 `packages/core` 的测试命令；`packages/core` 当前只有 `typecheck`、`db` 和 `migration` scripts。

本轮实际验收：根目录 `bun turbo typecheck --concurrency=2` 通过；`GITHUB_ACTIONS=false bun turbo test --concurrency=2` 通过（3419 tests，3399 pass、0 fail，19 skip、1 todo）；focused skill/reload/tool/plugin/CLI suite 79 pass；HTTP API exercise 204/204 通过。`packages/client` 的 `check:generated` 在未提交工作区会把本次合法生成文件差异报告为 dirty，生成脚本本身已运行完成；提交生成文件后该 CI 检查才会变为 clean。

Turbo 会进入各 package 执行 typecheck/test；根目录 package.json 的 `test` 入口本身会退出。所有实现走分支和 PR；`main` 只在 `test`、`typecheck` 以及生成文件检查通过后合并。

## 明确不做

- 不把 Pi 的名称、默认 provider 或产品交互复制进 Apexo。
- 不为了“支持更多模型”把 Grok-specific prompt、auth、streaming 和 telemetry 降级成最低公分母。
- 不在第一阶段替换现有 HTTP API、ACP、数据库 transcript 或 Session V2 runner。
- 未来的 package lifecycle 不让 skill、plugin、MCP 或 package 通过 import side effect 启动进程、改变权限或接管 session 编排；当前 registry 对配置目录工具的动态 `import()` 行为保持兼容，迁移必须单独设计。
- 不一次性实现所有 Pi provider；每个新 provider 都必须通过 Grok-first 评审。

## Decision log / 开放问题

已决定：

- Grok/xAI 是产品主线；Pi 只提供可借鉴的 harness 参照。
- HTTP API 和 ACP 继续是正式协议面，JSONL RPC 是兼容 adapter。
- trust/provenance 必须先于可执行 project resource registration；被拒绝来源只保留 provenance inventory。
- skills 是 instruction layer，不是隐藏的 feature implementation；可执行能力必须进入 tool/plugin/MCP 的权限边界。
- DB session projection 是唯一 transcript source；branch UX 不另建 transcript 存储。
- `/reload` 的目标语义是：进行中的 provider turn 保持已经 materialize 的系统上下文和工具定义，新内容在下一次 safe provider-turn boundary 可见；skill tool 正文仍按调用时 loader 读取。
- `tool_search` 先采用确定性的名称/描述匹配；精确工具选择在同一次固定-schema调用内执行，不能动态注入正在运行的 provider turn。
- 第一条 trust gate 复用现有 plugin tuple options：`{ "trust": "deny" }` 在 server/TUI loader 解析前拒绝，默认和未知值保持兼容。
- 全局 `.claude`/`.agents` skill 与 `skills.urls` 在本次切片继续按现有行为加载；不在没有调用方和 UI 的情况下改变默认 trust，也不把它们伪装成已完成的来源审计。
- V1/V2 skill 的同名覆盖在本次切片继续保持各自既有语义；稳定 precedence、冲突错误和跨 loader 合并另开切片。
- JSONL 首版固定包装已有 `session.list`，CLI 使用 `apexo jsonl`，Desktop 继续使用 HTTP，不增加新的 Protocol method。
- `effect` 和 `rtl-aware-development` 是现有项目 baseline skills；本设计新增的 skills 与它们并列，不替换它们。
- V1 slash command 不再复制 skill 正文到长期 command state；`Command.get/list` 在查询时读取当前 Skill state，reload 后的正文因此可见。
- V2 plugin boot readiness 是 location 内部服务边界；`/api/skill` 和 `/api/command` 等待它，不新增公共 Protocol 字段或事件。
- `tool_search` 当前只覆盖 V1 `session/tools.ts` 的默认 provider-turn；没有 canonical MCP registration 以前，不把 V2 `ToolRegistry` 或 code-mode 标为已完成。

待决策：

- 远程 skill/package 的 pin 格式选 git commit、integrity hash，还是两者都支持。
- `tool_search` 后续是否需要 Grok-specific embedding/ranking（首版已确定为名称/描述匹配）。
- trust 默认是否在未来允许未信任 skill 被列出但要求显式 trust 才能调用，以及全局/URL 来源的迁移提示如何设计；当前版本保持兼容加载。
