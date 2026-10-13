<p align="center">
  <img src="docs/assets/apexo-wordmark.png" alt="Apexo" width="420">
</p>
<p align="center"><b>Grok 的 UI 外壳（UI harness）。</b>开源的编程智能体，支持终端、浏览器和桌面端。</p>
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

---

## Apexo 是什么？

Apexo 是 **Grok** 的 UI 外壳。它的核心目标是支持 SpaceXAI 官方开源编程智能体
[Grok Build](https://github.com/xai-org/grok-build)，让每个人都能更方便地使用 Grok。
终端界面（TUI）、Web 界面和桌面应用共用同一个本地智能体服务。

目前已经具备：

- **Grok 优先。**使用 xAI 账号登录（SuperGrok；X Premium 账号以 xAI 实际开放的 Grok
  权限为准），采用 xAI 的 OAuth 设备码流程，无需 API key；也可以使用 `XAI_API_KEY`。
  可用 models.dev 目录中的全部 Grok 模型，例如 `grok-4.7`、`grok-4.6`、`grok-4.20`
  和 `grok-build-0.1`。
- **Antigravity 原生登录。**直接复用本机 Antigravity CLI（`agy`）已有的登录态，无需重复授权；
  尚未登录时，通过 agy 完成一次 Google 授权即可。详见 [Antigravity 接入说明](docs/antigravity.md)。
- **次要提供商（API key 方式）：**OpenAI、Anthropic（Claude）、Google（Gemini）。
- **没有付费订阅，没有广告。**不再有托管模型网关、账号控制台、会话分享服务、升级推销或任何推广内容。
  一切在本地运行，直接连接你配置的提供商。
- **终端、Web、桌面三端**共用同一个本地服务和同一份会话历史。
- **Grove 主题：**TUI 和应用的默认主题，暖黑底配绿色强调色。原有主题全部保留。

### OAuth 适配范围与选择理由

本项目的 OAuth 适配只面向 **Antigravity 和 Grok**，也只做**本地适配**。
登录与授权在用户自己的机器上处理，不提供托管的 OAuth 中转或账号服务；模型请求仍直接发送给相应提供商。
这一范围针对 OAuth 和登录态集成，下方列出的 API key 接入方式仍然保留。

**作者立场：**我选择 Antigravity 和 Grok，是因为在我看来，它们对中国用户更友好，
不会仅仅因为用户是中国人就将其拒之门外，这是我很看重的一点。
我反对基于国籍的排斥，也认为 Claude 对中国用户的限制带有歧视性，因此不计划适配 Claude 的 OAuth。

不适配 OpenAI OAuth 则是另一个原因：我觉得 OpenAI 自己的产品已经做得太好了，
我没有把握做出超越它们的体验，因此更愿意把这个项目的精力放在 Antigravity 和 Grok 上。

> [!NOTE]
> **与 Grok Build 的集成现状：**Apexo 目前还不能驱动 Grok Build CLI。它现在用自带的智能体循环，
> 通过你的 Grok 登录或 API key 直接调用 xAI API。把 Grok Build 本身接到 Apexo 的界面后面是我们的目标：
> Grok Build 通过 `grok agent stdio` 提供 Agent Client Protocol（ACP）服务，而 Apexo 已经内置
> ACP SDK。在这项集成完成之前，请把 Apexo 当作一个 Grok 优先的 UI 和智能体，而不是 Grok Build 的前端。

<p align="center">
  <img src="docs/assets/apexo-tui.png" alt="Apexo 终端界面" width="820">
</p>
<p align="center">
  <img src="docs/assets/apexo-web.png" alt="Apexo Web 界面" width="820">
</p>

## 安装（从源码构建）

Apexo 暂未发布到任何包管理器。构建前需要安装 [Bun](https://bun.sh) 1.3.x（仓库固定为 `bun@1.3.14`）和 git。

```bash
git clone https://github.com/cluster1900/apexo-grok.git apexo && cd apexo
bun install

# 为当前机器构建单个原生二进制（内嵌 Web UI）
bun run --cwd packages/apexo build --single

# 产物位于 packages/apexo/dist/apexo-<os>-<arch>/bin/apexo
install -D -m755 packages/apexo/dist/apexo-*/bin/apexo ~/.local/bin/apexo
apexo --version
```

推送 `vX.Y.Z` 标签会触发 `.github/workflows/release.yml`，构建所有平台并把压缩包附加到
[GitHub Releases](https://github.com/cluster1900/apexo-grok/releases)。发布之后，也可以用安装脚本获取
（`--version X.Y.Z` 指定版本）：

```bash
curl -fsSL https://raw.githubusercontent.com/cluster1900/apexo-grok/main/install | bash
```

不构建、直接从源码运行：

```bash
bun dev            # 等同于 bun run --cwd packages/apexo src/index.ts
bun dev --help
```

## 使用

```bash
apexo                     # 在当前目录启动终端界面
apexo auth login          # 登录：选择 xAI -> "SuperGrok Subscription"（OAuth）或填写 API key
apexo auth list           # 查看已配置的凭据
apexo models xai          # 列出 Grok 模型
apexo run "解释一下这个仓库"   # 一次性、非交互运行
apexo web                 # 启动本地服务并打开 Web 界面
apexo serve               # 无界面服务（供桌面端、编辑器、脚本使用）
apexo acp                 # 作为 ACP 智能体运行，供 Zed 等编辑器接入
```

在 TUI 中：`/connect` 打开提供商对话框，`/models` 切换模型，`/themes` 切换主题，`ctrl+p` 打开命令面板；
以 `!` 开头的输入会作为 shell 命令执行。

### 提供商

| 提供商               | 连接方式                                                                        | 环境变量                       |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| **xAI Grok**（主要） | `apexo auth login` -> xAI -> SuperGrok Subscription（设备码 OAuth），或 API key | `XAI_API_KEY`                  |
| **Antigravity**      | 选择 Antigravity，复用本机 `agy` 登录态；未登录时通过 agy 完成一次 Google 授权  | —                              |
| OpenAI               | API key                                                                         | `OPENAI_API_KEY`               |
| Anthropic（Claude）  | API key                                                                         | `ANTHROPIC_API_KEY`            |
| Google（Gemini）     | API key                                                                         | `GOOGLE_GENERATIVE_AI_API_KEY` |

仍保留通用的 OpenAI 兼容“自定义提供商”入口，可接入自建服务。

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
  "$schema": "https://raw.githubusercontent.com/cluster1900/apexo-grok/main/schemas/config.json",
  "model": "xai/grok-4.7",
  "theme": "grove",
}
```

编辑器补全用的 JSON Schema 位于 [`schemas/`](schemas)：`config.json`（apexo.json）、`tui.json`、
`theme.json`（TUI 主题）和 `desktop-theme.json`（应用主题）。可用 `bun script/schemas.ts` 重新生成。

上游项目已有安装中的配置文件、目录和环境变量仍会作为后备读取（Apexo 命名优先），旧配置无需修改。
这些兼容名称集中在 [`packages/core/src/legacy-compat.ts`](packages/core/src/legacy-compat.ts)。

## 主题

- **TUI：**默认主题为 `grove`。可用 `/themes` 切换，或在 `tui.json`（`~/.config/apexo/tui.json`）
  中设置 `"theme"`。自定义主题放在 `.apexo/themes/*.json` 或 `~/.config/apexo/themes/`。
- **Web / 桌面应用：**在 设置 -> 外观 中默认使用 Grove，原主题显示为 “Classic”。

## 开发

```bash
bun install
bun turbo typecheck --concurrency=1
(cd packages/core && bun test)
(cd packages/apexo && bun test)
(cd packages/tui && bun test)
```

工作区包使用 `@apexo/*` 作用域，CLI 与服务端位于 `packages/apexo`。

## 反馈

问题和建议请提交到 [github.com/cluster1900/apexo-grok/issues](https://github.com/cluster1900/apexo-grok/issues)。

## 许可证

MIT，详见 [LICENSE](LICENSE)，原版权声明保持不变。

---

Apexo 基于 [OpenCode](https://github.com/anomalyco/opencode) 构建，感谢 OpenCode 的作者和贡献者。
