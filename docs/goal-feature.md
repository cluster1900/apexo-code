# Goal implementation contract

Status: In progress. Compatibility session control, empty-session launch, headless CLI, mini/fullscreen terminals, and the Desktop Goal panel are implemented. Planning, independent verifier panels, role models and local agents, file-based reports, Git/history/mtime change evidence, report browsing/download, explicit cleanup, and durable stop/Session-deletion cleanup are connected. Terminal cleanup intent now commits with terminal state, and optional report retention preserves the current plan and verifier references; see [lifecycle durability](./goal-lifecycle-durability.md) for guarantees and verification. The native V2 runner and its independent evaluator are also implemented; see [native Goal execution](goal-native-v2.md). The latest native compaction/Goal/Workflow gate passed 16 tests and 159 assertions, and manual compaction passed five scenarios with four provider requests in each of the CLI and freshly built packaged Desktop backends. Fresh native UI acceptance remains pending. Other remaining work includes pre-upgrade terminal reports without manifests, compatibility strategy execution, proprietary harness styles and progress summaries, remaining performance investigation, and complete cross-platform acceptance.

参考固定 grok-build 源码 `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` 的 `goal_tracker.rs`、`goal_support.rs`、`goal_classifier.rs` 和 `update_goal`。当前安装版及源码测试结果另行记录；源码阅读不等于运行验收。

## 完整要求

1. 一个会话同时只有一个目标，显式创建；目标正文、预算和进度持久保存。相同创建 ID 的精确重试不重复创建，冲突重试报错。
2. `/goal` 创建、查看、暂停、恢复、清除；CLI mini/fullscreen、headless 和 Desktop legacy/V2 共用契约。用户明确暂停后不得自动继续。
3. Continue from actual round results and distinguish progress, still-running tasks, infrastructure failure, recurring blockers and lack of progress. Worker blockage requires the same blocker across three independent consecutive rounds; repeated tool calls do not count as separate rounds. The installed reference uses an independent JSON evaluator with `continue/candidate_complete/blocked`, then independently verifies candidate completion. Both Apexo runners use this decision boundary; worker self-report cannot replace it.
4. 可选正整数 Token 预算；不设置就是无预算。统计从目标启动后的执行、规划、验证和子任务实际用量，重试去重、压缩不回退。预算耗尽在安全边界停止；已发出的请求可能产生超额用量。恢复不能绕过已耗尽预算。
5. `update_goal` 的完成报告只申请验证，独立验证须覆盖原始目标全部要求、证据和未完成项。验证失败继续，基础设施失败暂停，不误报完成。连续同样缺口与尝试上限各自有状态和恢复规则。完整对齐还包含官方默认 3 个核验者（可配置 1–5）、原始材料/工作区读取、核验明细与策略调整；单次无工具评审只是执行边界，不代表此项完成。
6. 规划、不可变目标基线、进度摘要、上下文压缩后恢复完整目标、必要时调整执行方案；验证材料与结果可追溯。
7. 重启恢复为暂停，读取状态不能自动调用模型。旧工作轮次、被取消验证和旧目标的迟到结果不能完成新目标；实际产生的迟到用量仍计入原目标。
8. 兼容执行器和原生 V2 执行器分别集成；原生 V2 保持持久输入接纳、进程内 Session coordinator 和每轮一次 `llm.stream`。不得通过兼容执行器绕接。
9. 所有用户可见文案走多语言。Desktop 有目标状态、预算/用量、暂停/恢复、验证结果和剩余项展示。
10. 每个完整功能阶段运行 CLI、最终打包 Desktop 和官方 grok-build 对照；覆盖真实取消、重启、预算耗尽、拒绝完成、阻塞恢复和跨端状态一致性。性能基线及全仓检查另外记录。

## 多核验者与报告（2026-10-14）

默认三个核验者，先运行索引 0 的核验者，再并行运行其余核验者。索引 0 对可修复缺口的高置信度否决会直接结束本次核验；若它报告外部阻塞，则仍运行完整面板，但该否决保持有效。其余情况下，多人面板只计算索引 1 及以后的严格多数；索引 0 的赞成不能把平票变为通过。一个核验者时只采用该核验者的结果。所有否决均是矛盾或无法验证的外部条件时，本次独立核验可进入 blocked；这是与工作轮次 evaluator 的三个连续同类阻塞不同的决策来源。

在 `apexo.json` 配置 `{"goal":{"verifier_count":3}}`；环境变量 `GROK_GOAL_VERIFIER_N` 优先于配置，最终夹在 1–5。环境值按官方 u32 解析，无效值回退配置，未设置时默认 3。人数在每次核验开始时固定并持久保存；修改配置不改变已开始的面板。规划/核验的本地角色配置见下节；官方远程角色配置治理仍未对齐。

每份报告有独立调用 ID、索引、结论、置信度、阻塞分类、证据、未满足项、实际 Token 和耗时；`Goal.Info.verification` 保存最近一轮及输入证据 SHA-256。Desktop、mini/fullscreen 和 headless 状态可查看报告，界面显示已收到数量与配置数量。部分报告不会提前完成目标；索引重复、调用 ID 重用、暂停后迟到结果不能覆盖既有报告。基础设施错误或非法输出暂停，取消会等待所有本地核验任务退出；缺失用量标记不会丢失。持久报告可在重启后读取，但旧核验不会自动续跑，仍需显式恢复并重新检查。

下一轮索引 0 续接自己的持久子会话，其他核验者新建独立子会话，收到当前原始目标、证据及未满足项，不收到同轮其他人的结论。规划者和核验者可读取、搜索工作区并运行现有权限允许的检查；原始目标与角色约束在每个 provider turn 重新提供。独立文件接入见下节；官方专有 harness 切换及全部恢复场景仍未覆盖。单项面板能力不能等同完整 Goal 对齐。

子会话继承父会话的权限，续接前刷新权限；显式拒绝不能被此前会话级放行绕过。规划和核验工具清单不含直接文件写入、任务创建或任意 MCP 工具；Shell 仍采用现有宿主权限，不能将角色的只读要求解释为操作系统级文件隔离。每个模型请求只计费一次，报告用量汇总实际请求回执，不再次扣费。缺少用量、超时或非法输出暂停本次评审；暂停会等待其拥有的子会话退出。

`plannerSessionID` 与每份报告的 `sessionID` 持久关联完整工具记录；完成后的状态和记录可跨进程重新读取，重启不会自动续跑未完成的模型调用。CLI/最终 Electron 各 7 项真实工具专项、官方安装版 3 项工作区对照通过，详见实施记录最新章节。

新增面板文案有英文和简体中文，其他语言使用既有回退。中文“确认”“报告”“要求”核对了本地 VS Code 与 Firefox 语料；“核验者”等产品角色术语仍列为母语审阅项。

## 规划者与核验者模型配置

CLI 和 Desktop 服务读取同一份 `apexo.json`。下面的 `provider/planner-model`、`provider/verifier-model` 是占位符，须替换为当前服务已配置可用的模型；`agent_type` 指向 Apexo 内置或自定义 agent 名称。

```json
{
  "agent": {
    "reviewer": {
      "prompt": "依据原始要求与当前文件核验，列出缺口和证据。",
      "permission": { "bash": "deny", "webfetch": "deny" }
    }
  },
  "goal": {
    "use_current_model_only": false,
    "planner_model": { "model": "provider/planner-model", "agent_type": "reviewer" },
    "skeptic_models": [
      { "model": "provider/verifier-model", "agent_type": "reviewer" },
      { "model": "provider/planner-model", "agent_type": "build" }
    ]
  }
}
```

模型和 agent 是一组配置；两项都必须填写。模型也可以省略 provider 前缀，此时使用当前会话的 provider。规划者采用 `planner_model`；核验者按 `skeptic_models` 顺序循环分配。已分配的索引持久保存在 Goal 中，恢复、缩减人数或修改配置不会重写它们；增加人数只补齐新的索引。清空列表不会删除既有分配，新建 Goal 才采用新的起点。

`GROK_GOAL_USE_CURRENT_MODEL_ONLY` 优先于 `goal.use_current_model_only`，支持官方 `1/true/yes/on/enabled` 与 `0/false/no/off/disabled`，忽略首尾空白和大小写；无效值回退配置。启用时规划和核验都继承当前模型/agent，但保留已有核验分配以供以后恢复使用。普通工作轮次和独立 evaluator 不受这些角色配置影响。

选定 agent 的提示、模型参数、有效 variant、轮次上限和权限沿用已有执行路径。角色配置不能扩展父会话权限，直接写文件、创建任务及任意 MCP 工具仍不在核验工具清单。找不到模型或 agent、agent 禁止角色必要的 read/grep 时，整组回退到当前会话模型/agent。显式配置的角色执行失败最多再尝试一次当前模型；取消、预算耗尽或旧尝试不能触发该重试。任何一次传输缺失用量仍导致 `infra_paused` 并标记 `usageIncomplete`，即使回退模型成功也不掩盖不完整用量。

`plannerExecution` 和逐人报告的 `execution` 保存请求的配置、实际模型/agent 及回退原因，子会话保留实际工具与模型记录。已有 Goal 状态兼容这些可选字段，不需 SQL 迁移。

**兼容边界**：当前 `agent_type` 选择 Apexo 命名 agent，并不移植官方 `cursor`、`grok-build-plan` 等专有 harness 的完整提示和工具风格；不能将未知官方名字默认为已经支持。策略角色与远程组织配置仍在后续范围。官方安装版 1.0.52 的核验模型池、强制继承和未知模型回退已实测；规划模型配置在两次实测中未生效，源码测试通过不能替代此差异。完整日志见实施记录最新章节。


## 当前边界与有意差异

- Durable state, attempt isolation, usage receipts, independent planning and verification, automatic continuation, budget stops, cancellation, workspace evidence and report cleanup are integrated with the compatibility and native V2 runners. Each runner uses an independent evaluator. Native strategy advice is implemented; see [the strategy contract](native-goal-strategy.md). Compatibility strategy execution, proprietary harness styles and progress summaries remain open. Focused native UI routing tests and backend acceptance are separate evidence; fresh packaged UI acceptance remains pending.
- 官方存在验证基础设施失败时 fail-open 完成的路径；Apexo 将保留目标并报告 `infra_paused`，不会把无法验证当作已完成。
- 新目标不能默默覆盖未完成目标；用户可先明确清除旧目标。未知持久状态解读为暂停，损坏的其他字段报存储错误。
- Core 状态读取不执行恢复或模型调用。恢复只能由执行器确认旧进程内运行已结束后显式发起；不能根据读取超时或状态文件推断进程死亡。

### 已接入兼容执行器：独立轮次评估器

已核对固定源码 `session/goal_evaluator.rs` 和 `session/acp_session_impl/goal.rs`，并在安装版真实模型请求中观察到该流程：

- 每个工作轮次结束后单独调用模型，不提供工具，不将请求或回答写入主会话；评估器的实际用量也受 Goal 预算约束。
- 严格 JSON 字段为 `decision`、`evidence`、`next_step`、`blocker_key`，拒绝额外字段；证据和下一步必须非空。只有 blocked 可以带非空阻塞键，键使用小写字母、数字和下划线。
- continue 保留具体下一步并继续工作；candidate_complete 只进入独立核验，不能直接完成；blocked 按稳定阻塞键累计，连续三个独立工作轮次才暂停。继续工作或候选完成会清除该连续计数。
- 官方最多请求两次；请求、格式或用量失败最终进入基础设施暂停，不当作完成。取消、清除、替换和显式恢复仍须使用本地持久尝试/代次隔离，迟到用量不能丢失。
- 官方评估器提供最近的有界记录（总计 32 KiB、单项 4 KiB，方案最多 16 KiB）。这与核验阶段的原始证据读取是不同边界；有界记录不能替代完整要求核验。

当前兼容主循环已有持久 `evaluating` 阶段，下一工作轮次采用评估器的 `next_step`；`update_goal` 的自报完成/阻塞不会跳过评估。continue 不触发旧的“三轮未申请验证”停止，稳定阻塞键才累计三轮；候选完成仍需独立核验。格式、缺失用量和传输错误最多重试一次，每次调用独立计费；已暂停、超预算、旧尝试和存储错误不重试。

`Goal.Info.evaluation` stores the latest decision, evidence, next step and blocker key. `usageIncomplete` records missing transport usage, including cancellation or process death during a durable attempt; `tokensUsed` then remains a lower bound and resume does not clear the flag. Independent reviews clear inherited worker billing context to avoid duplicate charges. Evidence and plans have separate UTF-8 byte limits while preserving the complete original objective. Native V2 integration and permission-filtered workspace verification are implemented; current verification and remaining boundaries are recorded in the native Goal document.

## 用户入口

Desktop 会话输入框旁有“目标”按钮。`/goal` 或 `/goal status` 打开状态面板；`/goal <目标正文>` 打开预填表单，确认可选 Token 预算后点击“创建并启动目标”。全新聊天也可直接使用该命令，不需要先发送普通提问。`/goal pause`、`/goal resume` 执行显式控制；`/goal clear` 打开清除确认。关闭面板不暂停目标。

Desktop 面板显示状态、执行阶段、实际用量及用量不完整提示、计划、最新评估/下一步、核验结果与未满足项。清除保留会话消息和文件。完成或预算耗尽不显示恢复按钮；预算不能通过恢复绕过。两套 App 输入框共用控制器；目前生产交互主要覆盖 V2 输入框，legacy 输入框完整交互仍需补验。

CLI mini/fullscreen 使用同一 `/goal` 面板：填写目标和可选预算，Tab 切换字段、Enter 创建；`s` 启动、`p` 暂停、`r` 恢复、`x` 清除，清除需 `y` 确认，Esc 关闭。也支持上述状态/暂停/恢复/清除命令。

Headless 控制已运行中的服务：

```sh
apexo goal create "实现目标的全部要求" --attach http://127.0.0.1:4096 --model xai/grok-4.7 --budget 100000
apexo goal status --attach http://127.0.0.1:4096 --session <sessionID>
apexo goal pause --attach http://127.0.0.1:4096 --session <sessionID> --id <goalID>
apexo goal resume --attach http://127.0.0.1:4096 --session <sessionID> --id <goalID>
apexo goal clear --attach http://127.0.0.1:4096 --session <sessionID> --id <goalID>
```

创建时不传 `--session` 会创建新会话；省略预算表示无预算。命令输出 JSON 状态，服务在命令返回后继续运行。创建会先在 stderr 输出持久的 Session/Goal ID；网络失败后使用相同 `--session`、`--id`、目标和模型重试，不能仅重用 Goal ID 创建另一个会话。`--dir` 指定服务所在机器的项目目录；身份验证沿用其他 attach 命令的环境变量和选项。

启动选择保存在 `Goal.Info.launch`，包含固定消息 ID。相同选择重试不重复写用户消息或恢复暂停目标，冲突选择返回 409。首条用户消息在取得会话执行权后写入；恢复可修复写入中断，但保留已接纳消息的授权编辑，原始目标仍独立保存。读取 Goal 不接纳消息、不调用模型。原生 V2 Protocol/SessionRunner 尚未接入这套控制。

本阶段新增文案使用 i18n，英文及简体中文完整，其他语言沿用英文回退。简体中文术语核对了 Firefox 和 VS Code 简体中文语料（本机 `/tmp/apexo-plugin-localization/zh-firefox.txt`、`zh-vscode.txt`）；“目标核验”“Token 预算”等产品短语仍需母语审阅。模型生成的目标、证据和错误详情保持原文。

## 公共控制 API

兼容会话路由 `/session/:sessionID/goal`：

| 方法   | 路径后缀          | 行为                                                                                         |
| ------ | ----------------- | -------------------------------------------------------------------------------------------- |
| GET    | 无                | 只读当前 Goal，未创建时返回 null；不调用模型或恢复执行                                       |
| POST   | 无                | 使用 `Goal.Create` 保存目标；创建 ID 精确重试返回原目标，冲突返回 409；不自动开始模型工作    |
| POST   | `/:goalID/start`  | 为未启动目标保存模型与 agent，使用持久消息 ID 接纳目标正文，再在独占执行器中启动；支持空会话 |
| POST   | `/:goalID/run`    | 仅启动 active 目标，执行器独占接纳后返回状态；需要已有带模型的用户消息                       |
| POST   | `/:goalID/pause`  | 先持久暂停，再停止该目标拥有的运行与后台子任务                                               |
| POST   | `/:goalID/resume` | 用户显式恢复并启动；完成或预算耗尽不能继续                                                   |
| DELETE | `/:goalID`        | 停止并删除指定目标；旧 ID 不能删除后来创建的目标                                             |

同一会话的控制请求串行处理；不同会话独立。取消同时校验执行器和每次运行的所有权标记，不能取消复用该会话或执行器的新普通任务。模型运行属于项目生命周期，HTTP 返回后继续执行。新进程读取旧 executing 状态仍保持只读；首次显式 run 会在确认本地空闲后将旧尝试恢复为暂停并返回冲突，resume 才开始新工作。底层遵守既有 Session-ID 路由，目录提示不覆盖会话自身的存储位置。

客户端契约已按要求通过生成脚本更新；新接口目前属于兼容 HttpApi 与 legacy JavaScript SDK。原生 V2 Protocol/Client 的 Goal 契约与执行器仍须独立实现。

## 2026-10-14：兼容主循环状态复核

内部 `runGoal` 通过会话独占执行器启动，不会把普通 prompt 隐式升级为 Goal，也不会隐式恢复暂停的目标。主循环已接入规划、工作、独立核验及拒绝后的继续执行，跟踪模型与子代理用量，在安全边界处理预算耗尽，并在后台子任务完成后再核验。`update_goal` 已加入 Grok 工具适配；完成报告仍需独立核验。

复核发现子任务证据筛选对可选 `metadata` 的访问未收窄，已增加显式检查并仅选择 task 类型。`packages/apexo` 的 `bun typecheck` 通过；内部 HTTP 集成 7 pass、0 fail、25 个断言，覆盖后台子任务等待、核验拒绝后继续、预算停止、取消与独占、普通会话隔离、三次阻塞及子代理计费。日志为 `/tmp/apexo-goal-loop-status-types2.log`、`/tmp/apexo-goal-loop-status-review2.log`。

保留首次复核记录：并行运行测试和类型检查时，类型检查报上述错误，集成测试 4 pass、3 个 5 秒超时。修复后独立重跑保持原超时与断言，7 项通过；不能仅据此确认首次超时根因。该结果仍不是公开 CLI、生产 Desktop Goal 交互或官方完整推进的三端验收，也没有重跑当前全部增量的全仓 CI。

## 2026-10-14：持久状态阶段

使用会话外键关联的 `session_goal`、`session_goal_attempt` 和 `session_goal_usage` 三张表。变更使用 SQLite immediate 事务；目标 ID 防替换冲突，独立尝试 ID 和代数隔离暂停前结果。完成请求只排队，新的验证尝试提交证据后才允许完成。每个模型调用累计用量只计正增量，重复或乱序通知不重复扣费，压缩无需重算历史。

默认验证上限 10 次，连续两次相同缺口触发无进展暂停，三个未申请验证的工作轮次触发 backoff；三个相同阻塞必须来自三个独立完成的工作尝试。恢复重置这些连续计数并保留总用量/总轮次。历史最多 64 项。规划、执行、验证均预留计费接口；实际模型调用归集仍待执行器接入。`next()` 只读取下一阶段，不调模型、不写入状态。

验证与边界：

| 范围              | 结果                                                                                     | 证据                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Core 单测         | 20 项通过、111 断言；包含阶段选择和冲突完成声明                                          | `/tmp/apexo-goal-core-final.log`，最终全仓结果见实施记录                                                            |
| Bun 存储进程      | 7 项通过，包含真实执行/验证 SIGKILL、恢复暂停、旧结果隔离、五轮两进程并发用量和预算      | `/tmp/apexo-goal-storage-cli3.log`；fixture `apexo-goal-storage-cli-JJD7So`                                         |
| Electron 存储进程 | 同一套 7 项通过                                                                          | `/tmp/apexo-goal-storage-desktop2.log`；fixture `apexo-goal-storage-desktop-eXvSUo`                                 |
| 官方安装版        | 6 项实际 ACP 生命周期对照：无目标状态、取消持久化、轮询、恢复后强杀重开、重复暂停、清除  | `/tmp/apexo-goal-official-runtime3.log`；fixture `apexo-goal-official-6KPf37`                                       |
| 全仓与接口        | 3665 pass、0 fail；类型 21/21；HTTP API 三组各 222 pass；迁移/生成检查、Desktop 构建通过 | `/tmp/apexo-goal-all-tests.log`、`/tmp/apexo-goal-all-types.log`、`/tmp/apexo-goal-httpapi.log`，完整命令见实施记录 |
| 官方固定源码      | 状态 128、显示/序列化 10 项通过                                                          | `/tmp/apexo-goal-official-tracker.log`、`/tmp/apexo-goal-official-orchestrator.log`                                 |

以上 Electron 检查运行的是真实嵌入式 Node/SQLite 的存储模块，**不是最终打包应用的 Goal UI 或自动执行验收**。官方规划/验证在本次生命周期基线中显式关闭；未据此宣称已完成官方验证面板对齐。

失败记录保留：`/tmp/apexo-goal-storage-cli2.log` 复现 Bun `SQLITE_BUSY_RECOVERY`，原因是 WAL 初始化早于 busy timeout；现已将锁等待提前，并保持只读连接不切换日志模式。官方第一轮取消通知早于磁盘写入，第二轮重开后的额外请求实际是标题生成，分别保留 `/tmp/apexo-goal-official-runtime.log` 和 `runtime2.log`。最终用观察状态落盘、按明确标题请求区分计数的方式验证，不用固定延迟或忽略全部无工具请求来放宽断言。

官方测试使用临时 GROK_HOME、关闭兼容 MCP/规则发现、禁用 leader，并只终止本脚本启动的 agent。Apexo 测试也仅使用临时数据库和独立子进程；没有重启用户应用。

## 2026-10-14：独立模型评审边界

新增 Core `SessionGoalReview` 与兼容执行器的内部 `SessionGoalModel` 服务。服务使用会话选定的模型，以独立请求生成计划或核验原始目标，不把输入、响应追加到主会话。每次请求有独立调用 ID；输入/输出的缓存、推理 Token 使用包含关系计数，step/finish 重复通知只计一次。最终核验保存证据说明、输入 SHA-256 与调用 ID。

请求默认期限为两分钟。响应格式错误、无完成事件、缺少用量、矛盾结论及传输错误均暂停；预算耗尽不采用模型结果。新 `pauseAttempt` 将取消收尾绑定到具体尝试，旧请求不能暂停恢复后的新尝试，已产生的迟到用量仍归入目标。取得尝试与安装中断处理之间也受取消保护。

**当前仍不是完整 Goal 执行器**：本阶段只有单次无工具评审，由调用方提供最多 256,000 字符的证据，超限拒绝而不是截断后认证完成。官方规划者可读取工作区，核验使用子代理和默认三人面板；这些能力、工作轮次/子任务计费、主循环、原生 V2 执行器、`/goal` 和 UI 仍待接入。模型服务的测试成功不能扩大为最终 Desktop 产品界面的 Goal 验收。

阶段证据：

| 范围                       | 结果                                                                                   | 证据                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 状态与模型边界单测         | 33 pass、163 断言                                                                      | `/tmp/apexo-goal-review-core-final2.log`                                                        |
| 兼容模型真实 HTTP 集成     | 3 pass、19 断言；独立请求、历史不变、503 与取消                                        | `/tmp/apexo-goal-review-http-final.log`                                                         |
| Bun / Electron 嵌入式 Node | 同一实际 HTTP 用例各 8 项通过：规划、拒绝/接受核验、坏 JSON、503、预算、取消、请求隔离 | `/tmp/apexo-goal-review-cli2.log`、`/tmp/apexo-goal-review-desktop2.log`                        |
| 官方安装版                 | 开启 planner 后 7 项生命周期对照通过，包含真实 planner 请求、取消、SIGKILL 重开        | `/tmp/apexo-goal-review-official-runtime.log`；fixture `apexo-goal-official-jCPabK`             |
| 官方固定源码               | planner 74、classifier 197 项原有测试通过                                              | `/tmp/apexo-goal-review-official-planner.log`、`/tmp/apexo-goal-review-official-classifier.log` |
| 受影响回归与类型           | Goal/Prompt/LLM 133 pass、1 skip、0 fail；最终类型检查 21/21                           | `/tmp/apexo-goal-review-affected.log`、`/tmp/apexo-goal-review-all-types-final.log`             |

失败记录保留：首次 Bun 脚本预期 7 次请求，实际原生传输对 503 有两次内置重试，共 9 次；修正为同时断言总数 9 和该错误恰好 3 次，未忽略请求。兼容适配器显式 `retries: 0` 的独立测试仍断言一次请求，这项传输差异保留。首次 Electron fixture 引入不需要的全局 AppNodeBuilder，导致打包后的 jsonc-parser 动态 require 失败；改为只组装 Database 与 LLM 传输层，两端复验通过。初次类型检查发现测试 `Stream.make` 的泛型参数误用，已改为正确的事件集合构造。

## 私有规划与核验文件

兼容执行器的每次规划/核验调用都会在服务数据目录的 `goal-reviews/review-*` 下创建独立私有目录。规划者通过受限 `write` 工具写 `plan.md`；核验者分别写 `verdict.json` 与 `details.md`。两份核验输出均为必需，终端回复不参与判定；只有文本 JSON 而没有文件会暂停核验。JSON 使用现有 `Goal.Verdict` 契约，不冒充官方 `refuted/findings` 字段格式。

宿主另外保存 `objective.txt` 与 `evidence.json`；核验者收到的 `plan.md` 从持久计划复制。完成时核对这些输入的哈希，目标、证据或核验计划被改动即拒绝接受结果。规划提示要求保留完整目标、任务类别、验收条件、核验计划、非目标和范围；工作会话收到独立 worker scratch 路径，可保存自己的工作证据。恢复后的核验继续使用持久计划和同一 worker scratch，新的调用总有新报告路径。

`Goal.Info.plannerFiles` 和逐人 `Reviewer.files` 保存文件路径、SHA-256、字节数及 scratch 路径。状态和文件可在进程重新打开后读取；清除、暂停或替换 Goal 后，旧调用仍不能将结果写入当前 Goal。文件位于服务所在机器；现在可经报告接口远程查看、下载或显式清理，清除 Goal 时也会尝试清理其私有报告。旧 Goal 不会凭空补造过去的文件。入口和边界见下节。

受限写工具仅接受本角色的一个或两个绝对路径，并经过宿主插件 Hooks 和 `edit` 权限。写入前后检查 Goal 尝试是否仍有效，关闭调用后拒绝继续写入。目录使用 0700，文件使用 0600；拒绝越界、符号链接、硬链接、特殊文件和被替换的目录。读取有字节限制、UTF-8 校验及读取期间变化检查。计划最多 128 KiB 且 32,768 字符，判定 JSON 最多 64 KiB，Markdown 明细最多 512 KiB，冻结输入最多 2 MiB。

这些检查约束报告工具与结果接纳，**不是操作系统 sandbox**；已有 Shell 仍遵守宿主权限。同一用户下的任意 Shell 写入不能被本机制全面隔离。原始目标仍以数据库中的完整目标为准，文件不得缩小它。Git 基线材料及无基线/非 Git 回退采集见以下两节；报告自动生命周期清理、原生 V2 执行器及跨平台验证继续保留。验证脚本为 `packages/apexo/script/grok-goal-files.mjs cli|desktop`；官方对照为 `grok-goal-official.mjs --execute --workspace`，完整结果见实施记录。


## Git 基线与核验变更材料

兼容 API 在创建 Goal 时最多等待 1 秒读取 `HEAD^{commit}`，将结果持久化到 `Goal.Info.changesBaselineCommit`。同一 Goal 的精确创建重试、暂停/恢复和进程重开都保留原基线，不会因为后续提交而重设。非 Git、未产生首个提交或读取失败不会阻止创建，基线保持缺省。此行为已接入 CLI 与 Desktop 共用的控制入口。

每轮独立核验只采集一次材料，各核验者从同一份采集结果获取各自权限允许的内容。Git diff 对比原基线与当前工作区，覆盖之后提交、暂存和未暂存的净变更；新增未跟踪文件只进入文件清单，正文由核验者通过工作区工具读取。改名以删除/新增呈现。与官方基线语义一致，创建前已有的未提交改动也可能出现在 diff 中，不声称这些改动全由 Goal 产生。

每个核验私有目录新增 `changes.patch` 和 `changed-files.json`，通过 `Reviewer.files.changes` / `changedFiles` 持久化路径、字节数和 SHA-256。核验提示提供 `CHANGES_FILE` 与 `CHANGED_FILES`；完成前验证两份输入的不可变哈希。文件清单在 patch 截断前单独读取，patch 正文最多 256 KiB，截断有显式标记。文件清单、子进程输出与执行时间均有限制；不能完整采集时标记 unavailable，不能将它解释成“没有改动”。清单文件上限为 4 MiB。采集是一次有界读取，不是工作区的原子快照；核验仍需检查当前文件及运行结果。

自动材料仅包含无需额外确认即可读取的路径，read deny/ask 均不会自动纳入。特定角色还可进一步收紧；遗漏数量会标记，但不会暴露受限路径名或内容。宿主生成的会话 summary diff、patch 和 step snapshot 元数据已从核验材料中移除，避免绕过读取权限。原始对话、用户附件与实际工具回执仍保留。该修复及证据见 [BUG-20261014-010](./testing/permissions/goal-review-summary-diff.md)。

基线不可用时现在按下一节继续回退；全部方式失败才报告 unavailable。报告浏览/下载/显式清理入口见后文，自动生命周期清理、原生 V2 以及完整跨平台验收仍未完成。本节专项为 `grok-goal-changes.mjs cli|desktop`，官方安装版对照为 `grok-goal-official.mjs --execute --changes`，结果见实施记录。

## 无基线时的变更材料回退

创建时未记录 Git HEAD 或原基线已不可用时，先按 Goal 创建时间查询最早的窗口内提交，以其父提交到当前 HEAD 的差异生成材料；首次提交没有父节点时，使用该仓库格式对应的空树。支持 Goal 工作期间才初始化仓库，也支持 SHA-256 仓库。推导出的基线只写入材料的 `derivedBaseline`，不会覆盖创建时的 `changesBaselineCommit`。`source` 区分 `baseline`、`git_history` 和 `mtime`。

历史回退与官方相同，覆盖该提交范围的已提交变更，并另列未跟踪路径；它不包含跟踪文件当前未提交的修改，核验者仍需通过工作区工具检查。如果没有窗口内提交、当前目录不是 Git 仓库或 Git 采集失败，则扫描修改时间不早于 Goal 创建秒的当前文件。

mtime 扫描遵守 `.gitignore`、`.ignore`、Git exclude 与读取权限，跳过依赖/构建目录、符号链接和硬链接。单文件正文最多 64 KiB，总 patch 正文最多 256 KiB；完整允许路径列表先于正文截断获得。二进制文件只给出大小标记。目录深度、条目数、清单大小、执行时间均有限制，并在读取前后验证文件/目录身份。所有核验者仍共享一次采集，并使用各自权限过滤、私有材料文件和不可变哈希校验。

这类材料只展示当前内容，**不能恢复旧内容或已删除文件，也不是原子快照**。空扫描、采集失败、权限省略和截断均明确标记；缺少证据不能解释为没有变更或目标已完成。专项 `grok-goal-fallback.mjs cli|desktop` 覆盖新仓库、已有提交父节点、非 Git、截断、空结果及每个场景的进程重开；官方安装版对照使用 `grok-goal-official.mjs --execute --fallback=initial|parent|mtime`。结果与边界见实施记录。

## 报告查看、下载与显式清理

Desktop 的 Goal 面板新增“报告文件”，按报告目录列出原始目标、证据、计划、逐人结论/明细及变更材料。点击文件可查看纯文本或下载到使用者本机；远程服务也走同一授权接口，不要求客户端能访问服务端路径。报告组件只在打开时加载，不在关闭状态轮询。终端 mini/fullscreen 面板按 `f` 打开，方向键选择、Enter 查看、`d` 保存、`r` 刷新、`x` 删除；本地保存拒绝覆盖已有文件。

Headless CLI 示例：

```sh
apexo goal reports --attach http://127.0.0.1:4096 --session ses_...
apexo goal report --attach http://127.0.0.1:4096 --session ses_... --report review-... --file plan --output plan.md
apexo goal cleanup-reports --attach http://127.0.0.1:4096 --session ses_...
```

`--report` 必须使用列表返回的 `review-…` ID（命令示例中的占位值需替换）；`--file` 为 `objective/evidence/plan/verdict/details/changes/changedFiles`。省略 `--output` 返回带校验值的 JSON；`--output -` 输出原始文本。清除目标后如需重试清理，显式传入原 `--id goal_…`。

共享接口为 `GET /session/:sessionID/goal/:goalID/reports`、`GET .../reports/:reportID/:file` 和 `DELETE .../reports`。新文件存放在 `goal-reviews/<sessionID>/<goalID>/review-*`，以服务生成的目录记录保留完成和未完成尝试。当前计划/最新核验/保留的前次核验用数据库中的哈希校验，不能被磁盘目录同步改写替代；较早的历史记录只有磁盘目录校验值，不能据此宣称独立可信的防篡改证明。读取不接受任意路径，拒绝错误归属、固定名称不匹配、链接、超限及读取中变化。

只有已完成或预算耗尽的当前 Goal 可显式删除报告；仍可恢复的目标必须先清除，保护计划和 scratch。界面删除需要确认，明确包括报告、证据和临时工作文件。清除 Goal 会先停止执行，再移除状态并尝试清理报告；会话消息与项目文件保留。清理部分失败会返回失败目录 ID，清除入口则记录警告，允许用原 Goal ID 重试。旧版平铺目录在清除数据库状态前写入原子清理日志，删除隔离区可跨进程恢复；没有可靠归属的历史目录不会被推测性删除。

当前保留完整报告供用户下载，和官方在完成/预算停止时移除 scratch、另存报告摘要的生命周期不完全相同。会话删除及终态 scratch 自动清理见下节；**后台保留期限清理及原生 V2 路径仍未完成**；不将显式清理等同于全部自动生命周期。专项为 `grok-goal-reports.mjs cli|desktop`，同时扩展 UI、终端和原生窗口脚本；最终结果见实施记录。

## Automatic cleanup on stop, clear, and Session deletion

After the compatibility executor's scoped model execution closes, completed and budget-limited Goals remove their system-owned `worker` scratch directories. Plans, evidence, and verifier reports remain available for viewing and downloading. Paused, blocked, and otherwise resumable Goals retain scratch. Only the literal worker directory and its deletion quarantine are eligible: cleanup never follows an arbitrary persisted `workerScratch` path or removes project files.

Before clearing a Goal or deleting a Session, the current database stores ownership and a fixed set of report IDs in `session_goal_cleanup`. This table has no cascading foreign keys, so deleting the owner does not destroy retry information. Session deletion pauses its Goal, cancels the local execution chain and owned detached jobs, recursively deletes child Sessions, and captures reports from previous Goals within the same Session's dedicated directory. Malformed Goal state is logged; only reliably scoped directories can be recovered without it. Unknown legacy flat-directory ownership is never guessed.

Failed work remains in the queue. Recovery runs when the service starts and then once per minute, processing at most 100 jobs per pass. Failed or temporarily protected jobs move behind older pending jobs. Atomic deletion quarantines are retryable. Each retry uses its persisted report IDs and never adds files created by a later Goal lifetime. A resumable current Goal remains protected. Databases sharing a data root process only their own persisted queue; the implementation does not infer global orphans from missing rows in one database.

The Core migration generator produced the schema and journal updates. Tests cover an existing-database upgrade, queue survival after Session cascade deletion, database reopening, directory substitution, and retry after repair. Run `bun script/grok-goal-cleanup.mjs cli` and `bun script/grok-goal-cleanup.mjs desktop` from `packages/apexo`. The Desktop scenario uses the current production Electron backend build. The installed grok-build run and pinned-source terminal-transition tests compare completion/budget scratch behavior; they do not imply that Grok offers the same report-download API.

The later [lifecycle durability stage](./goal-lifecycle-durability.md) adds atomic terminal intent, live-process teardown barriers, and optional report retention. Goals already terminal before that implementation without a manifest remain available for explicit cleanup or Session deletion. Clustered execution ownership, native V2 integration, and Windows/Linux acceptance remain outstanding.
