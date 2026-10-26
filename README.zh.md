<p align="center">
  <img src="docs/assets/apexo-wordmark.png" alt="Apexo" width="420">
</p>
<p align="center"><b>开源的通用编程智能体（General-Purpose Coding Agent）</b>，同时支持终端（TUI）、浏览器（Web）与桌面端（Desktop）。</p>
<p align="center">
  <a href="https://cluster1900.github.io/apexo-code/">项目主页 (Website)</a> |
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

---

## Apexo 是什么？

Apexo 是一个**开源的通用编程智能体**，基于统一的本地智能体运行时，同时提供终端界面（TUI）、Web 界面和 Electron 桌面应用。

Apexo 并非绑定单一模型厂商的简单外壳，而是拥有深度演进的自研智能体架构——包括持久化会话引擎、自主目标执行（`/goal`）、多会话工作流（`/workflow`）、后台任务与子智能体编排（`/tasks`）、跨会话持久记忆（`/memory`）、原生命令沙盒（`/sandbox`）、生命周期钩子（`/hooks`）以及旁路快速提问（`/btw`）——并对各大主流模型生态提供一等公民级的原生支持：

- **Google Gemini 与 Antigravity 深度支持：** 支持直接复用本机 Antigravity CLI（`agy`）的 Google 登录态（无需重复授权），也支持通过 `GOOGLE_GENERATIVE_AI_API_KEY` 直接接入 Gemini 系列模型；完整支持思考摘要（Reasoning Summary）、多模态附件与长上下文编程。详见 [Antigravity 接入说明](docs/antigravity.md)。
- **xAI Grok 与 Grok Build 工作流体验：** 支持使用 xAI 账号（SuperGrok 或 X Premium）通过 OAuth 设备码流程免密登录，或使用 `XAI_API_KEY`；原生支持 `grok-4.7`、`grok-4.6`、`grok-4.20`、`grok-build-0.1` 等模型与完整工具链。
- **通用多提供商与 OpenAI 兼容生态：** 原生支持 OpenAI、Anthropic（Claude）、MiniMax、DeepSeek、Qwen 以及任意自建/第三方 OpenAI 兼容服务（vLLM、Ollama、LM Studio 等），自动提取 `<think>` 推理标签并支持增量流式输出与工具调用。
- **纯本地运行，无中间商订阅，无广告：** 没有托管模型网关、强制账号后台、会话上传或推销内容。所有能力均在本地运行，直接连接你所配置的模型提供商。
- **一套本地服务，三端一致体验：** 终端、Web 与桌面端共享同一个本地服务端、实时事件流和同一份持久化会话历史。
- **Grove 主题：** TUI、Web 与桌面端的默认暖黑绿配色主题，同时保留全部经典与自定义主题支持。

### 登录与鉴权设计

Apexo 对 **Google Antigravity（`agy`）** 与 **xAI Grok** 提供**本地 OAuth / 原生 CLI 登录态复用**，同时对所有主流模型（Google Gemini、xAI、OpenAI、Anthropic、MiniMax 及任意 OpenAI 兼容接口）提供 API Key 与自定义端点直连支持。所有鉴权凭据均保存在本机，请求直达对应模型服务商。

<p align="center">
  <img src="docs/assets/apexo-tui.png" alt="Apexo 终端界面" width="820">
</p>
<p align="center">
  <img src="docs/assets/apexo-web.png" alt="Apexo Web 界面" width="820">
</p>

## 核心能力

- **自主目标（`/goal`）：** 设定目标与验证标准，智能体将自动规划并持续迭代，直至验证通过、主动暂停、受阻或预算耗尽。
- **多会话工作流（`/workflow`）：** 在独立的子会话中并行推进多步骤工作流，主会话保持随时交互。
- **后台任务与子智能体（`/tasks`）：** 集中管理后台命令、定时循环任务（`/loop`）、子智能体（Subagents）与协调器会话。
- **持久记忆系统（`/memory`、`/remember`、`/flush`、`/dream`）：** 跨会话审阅、沉淀与整理项目级和用户级持久记忆。
- **原生命令沙盒（`/sandbox`）：** 基于操作系统原生机制（macOS `seatbelt`、Linux `bubblewrap`）限制命令的文件写入与网络访问（支持 `workspace` 与 `read-only` 模式）。
- **生命周期钩子（`/hooks`）：** 查看会话钩子快照，并提供仓库级显式信任授权管理。
- **旁路提问（`/btw`）：** 在不打断当前主线任务、不污染主上下文的前提下，随时弹窗进行旁路问答。

## 安装

```bash
npm install -g apexo-code
apexo --version
```

CLI 独立压缩包和 Desktop 安装包均可在
[GitHub Releases](https://github.com/cluster1900/apexo-code/releases) 下载，不要求使用 npm。

- 使用 npm 需要 Node.js 22 或更新版本；不需要另装 Bun 或 Rust。固定版本可执行 `npm install -g apexo-code@1.0.0`。
- 直接下载 CLI 时，Apple Silicon 选择 `darwin-arm64`，Intel Mac 选择 `darwin-x64`；普通 Linux 选择 `linux-x64` 或 `linux-arm64`，Alpine 选择带 `musl` 的版本；Windows 选择 `windows-x64` 或 `windows-arm64`。
- x64 CPU 不支持 AVX2 时选择带 `baseline` 的版本。解压后将 `apexo` 和 `apexo-workflow-script` 放在同一目录（Windows 文件名带 `.exe`），并把该目录加入 PATH。
- Desktop 提供 macOS Apple Silicon 的 DMG/ZIP、Linux x64 的 AppImage/DEB/RPM，以及 Windows x64 的 EXE 安装程序。
- 首次打开可能需要通过系统的安全确认：当前 macOS 包使用临时签名且未公证，Windows 包没有发布者证书。请核对发布来源，并使用同一 Release 的 `SHA256SUMS` 验证下载文件。

完整步骤见[详细安装指南](docs/installation.md)，包括无需 npm 的安装命令、Windows PowerShell 操作、PATH 配置、校验、更新和卸载。

### 从源码构建

构建前需要安装 [Bun](https://bun.sh) 1.4.4（仓库固定为 `bun@1.4.4`）和 git。

```bash
git clone https://github.com/cluster1900/apexo-code.git apexo && cd apexo
bun install

# 为当前机器构建单个原生二进制（内嵌 Web UI）
bun run --cwd packages/apexo build --single

# 产物位于 packages/apexo/dist/apexo-<os>-<arch>/bin/apexo
mkdir -p ~/.local/bin
install -m755 packages/apexo/dist/apexo-*/bin/apexo ~/.local/bin/apexo
install -m755 packages/apexo/dist/apexo-*/bin/apexo-workflow-script ~/.local/bin/apexo-workflow-script
export PATH="$HOME/.local/bin:$PATH"
apexo --version
```

推送 `vX.Y.Z` 标签会触发 `.github/workflows/release.yml`，构建所有平台并把压缩包附加到
[GitHub Releases](https://github.com/cluster1900/apexo-code/releases)。发布之后，也可以用安装脚本获取
（`--version X.Y.Z` 指定版本）：

```bash
curl -fsSL https://raw.githubusercontent.com/cluster1900/apexo-code/main/install | bash
```

不构建、直接从源码运行：

```bash
bun dev            # 等同于 bun run --cwd packages/apexo src/index.ts
bun dev --help
```

## 使用

```bash
apexo                           # 在当前目录启动终端界面（TUI）
apexo auth login                # 登录：支持 Google Antigravity、xAI Grok（OAuth）或配置 API key
apexo auth list                 # 查看已配置的凭据
apexo models                    # 列出所有已配置提供商的可用模型
apexo run "解释一下这个仓库"     # 一次性、非交互运行
apexo web                       # 启动本地服务并打开 Web 界面
apexo serve                     # 无界面服务（供桌面端、编辑器、脚本使用）
apexo acp                       # 作为 ACP 智能体运行，供 Zed 等编辑器接入
```

在 TUI 与桌面端输入框中：`/connect` 打开提供商连接对话框，`/models` 切换模型，`/themes` 切换主题，`ctrl+p`（macOS 上为 `cmd+k` / `cmd+p`）打开命令面板；以 `!` 开头的输入会作为 shell 命令执行。

### 提供商支持

| 提供商                              | 连接方式                                                                          | 环境变量                       |
| ----------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| **Google Gemini**                   | API key（支持 Google AI Studio 等）                                               | `GOOGLE_GENERATIVE_AI_API_KEY` |
| **Antigravity（Google / Gemini）**  | 选择 Antigravity，直接复用本机 `agy` 登录态；未登录时通过 `agy` 完成一次 Google 授权 | —                              |
| **xAI Grok**                        | `apexo auth login` -> xAI -> SuperGrok Subscription（设备码 OAuth），或 API key   | `XAI_API_KEY`                  |
| **OpenAI**                          | API key                                                                           | `OPENAI_API_KEY`               |
| **Anthropic（Claude）**             | API key                                                                           | `ANTHROPIC_API_KEY`            |
| **自定义 / OpenAI 兼容服务**         | 在 `apexo.jsonc` 中配置 `baseURL` 与 `apiKey`（如 MiniMax、DeepSeek、Ollama、vLLM）| 自定义 `{env:...}`             |

### 桌面应用

Electron 桌面应用位于 `packages/desktop`：

```bash
bun run --cwd packages/desktop dev        # 开发模式
bun run --cwd packages/desktop build      # 生产构建（打包使用 electron-builder）
```

桌面应用没有自动更新；如需更新，请重新构建（或安装更新的发布版本）。

## 配置

Apexo 读取 JSON/JSONC 配置文件：

| 项目               | 位置                                                             |
| ------------------ | ---------------------------------------------------------------- |
| 全局配置           | `~/.config/apexo/apexo.jsonc`（也可用 `apexo.json`）             |
| 数据 / 状态 / 缓存 | `~/.local/share/apexo`、`~/.local/state/apexo`、`~/.cache/apexo` |
| 项目配置           | 项目中的 `apexo.json` / `apexo.jsonc`（向上查找到 git 根目录）   |
| 项目目录           | `.apexo/`（agents、commands、plugins、themes、tools）            |
| 环境变量           | `APEXO_*`（如 `APEXO_CONFIG`、`APEXO_CONFIG_CONTENT`）           |

`apexo.json` 示例：

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/cluster1900/apexo-code/main/schemas/config.json",
  "model": "google/gemini-2.5-pro",
  "theme": "grove",
}
```

### 自定义 OpenAI 兼容提供商（如 MiniMax / DeepSeek / Ollama）

你可以在 `~/.config/apexo/apexo.jsonc` 或项目根目录的 `apexo.jsonc` 中接入任意自建或第三方 OpenAI 兼容端点（例如 MiniMax、DeepSeek、Qwen、vLLM、Ollama、LM Studio 等）：

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/cluster1900/apexo-code/main/schemas/config.json",
  "model": "custom/MiniMax-M2.7",
  "provider": {
    "custom": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Custom OpenAI-Compatible",
      "options": {
        "baseURL": "https://api.minimax.cn/v1",
        "apiKey": "{env:CUSTOM_API_KEY}",
      },
      "models": {
        "MiniMax-M2.7": {
          "name": "MiniMax M2.7",
        },
      },
    },
  },
}
```

配置完成后，可运行 `apexo models` 验证自定义提供商与模型是否已注册成功。

编辑器补全用的 JSON Schema 位于 [`schemas/`](schemas)：`config.json`（`apexo.json`）、`tui.json`、
`theme.json`（TUI 主题）和 `desktop-theme.json`（应用主题）。可用 `bun script/schemas.ts` 重新生成。

## 主题

- **TUI：** 默认主题为 `grove`。可用 `/themes` 切换，或在 `tui.json`（`~/.config/apexo/tui.json`）
  中设置 `"theme"`。自定义主题放在 `.apexo/themes/*.json` 或 `~/.config/apexo/themes/`。
- **Web / 桌面应用：** 在 设置 -> 外观 中默认使用 Grove，原有主题显示为 “Classic”。

## 开发

```bash
bun install
bun turbo typecheck --concurrency=2
(cd packages/core && bun test)
(cd packages/apexo && bun test)
(cd packages/tui && bun test)
```

工作区包使用 `@apexo/*` 作用域，CLI 与服务端位于 `packages/apexo`。

## 反馈

问题和建议请提交到 [github.com/cluster1900/apexo-code/issues](https://github.com/cluster1900/apexo-code/issues)。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
