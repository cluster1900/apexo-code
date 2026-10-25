import { useLayout } from "@/context/layout"
import { useServerSync } from "@/context/server-sync"
import { useServer } from "@/context/server"
import { createMemo, createEffect, For, on, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { PluginStoreRuntime } from "@apexo/sdk/v2/client"
import type { PluginStore } from "@apexo/schema/plugin-store"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { Icon } from "@apexo/ui/icon"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import "./plugins.css"

const ZH_PLUGIN_CATEGORIES: Record<string, string> = {
  deployment: "部署",
  monitoring: "监控",
  development: "开发",
  database: "数据库",
  observability: "可观测性",
  productivity: "效率",
  security: "安全",
}

const ZH_PLUGIN_DESCRIPTIONS: Record<string, string> = {
  vercel: "Vercel 部署平台集成。直接在 Apexo 中管理部署、检查构建状态、查看日志、配置域名并控制前端基础设施。",
  sentry: "Sentry 错误监控集成。直接在开发环境中查看错误报告、分析堆栈跟踪、按指纹搜索问题并调试生产环境错误。",
  "chrome-devtools": "Chrome DevTools 集成。控制和检查实时 Chrome 浏览器，录制性能追踪、分析网络请求、查看控制台消息并自动化浏览器操作。",
  cloudflare: "Cloudflare 开发者平台技能集：涵盖 Workers、Durable Objects、Agents SDK、MCP 服务器、Wrangler CLI 与 Web 性能优化。",
  superpowers: "软件开发核心技能库：测试驱动开发、系统化调试、协作模式以及成熟的工程工作流与方法。",
  base44: "使用 CLI 项目管理与 JavaScript/TypeScript SDK 开发技能构建并部署 Base44 全栈应用。",
  mongodb: "MongoDB 官方插件（自托管 MCP 服务器 + 技能）。通过连接字符串连接任意 MongoDB 部署，探索数据、管理集合、优化查询并生成符合最佳实践的代码。",
  "mongodb-atlas": "MongoDB Atlas 官方插件（托管 MCP 服务器 + 技能）。登录 Atlas 账户以探索数据、管理集合、优化查询，并管理集群、项目、数据库用户与网络访问。",
  axiom: "Axiom 官方可观测性集成（MCP 服务器 + 技能）。使用 APL 查询日志与指标、运行 SRE 调查、构建仪表盘、管理监控告警并优化成本。",
  neon: "Neon Serverless Postgres 集成（MCP 服务器 + 技能）。快速上手 Neon、管理项目与数据库、选择连接方式，并创建分支用于迁移测试与隔离开发。",
  wix: "构建、管理并部署 Wix 站点与应用（MCP 服务器 + 技能），涵盖站点管理、电商、CMS 与后台扩展。",
  netlify: "Netlify 平台技能集：无服务器与边缘函数、Blobs 存储、托管 Postgres、图片 CDN、表单、身份认证、缓存、AI 网关以及 Netlify CLI 部署。",
  firecrawl: "将任意网站转换为整洁的 Markdown 或结构化数据。通过内置托管的 Firecrawl MCP 服务器搜索、抓取、映射和提取实时网页数据。",
  figma: "Figma 官方 MCP 服务器与设计转代码技能。读取 Figma 设计上下文、还原设计稿、使用 Code Connect 并从网页生成 Figma 设计。",
  exa: "专为 AI 打造的实时网页搜索。实时检索网页、读取相关页面并基于最新来源作答，支持深度研究代码文档、新闻与企业信息。",
  tavily: "通过 Tavily 托管 MCP 服务器与官方技能提供网页搜索、内容提取、网站抓取、URL 发现与深度研究。",
  octen: "通过 Octen 托管 MCP 服务器提供实时网页与新闻搜索、多视角检索及网页正文提取，支持浏览器 OAuth 授权。",
  railway: "Railway 部署平台集成（MCP 服务器 + 技能）。直接在 Apexo 中创建项目、配置服务与数据库、部署代码、管理环境变量与存储卷并排查构建故障。",
  stripe: "适用于 Apexo 的 Stripe 开发插件：提供最佳实践、API/SDK 升级指南以及 Stripe MCP 服务器。",
  tinyfish: "通过 TinyFish 托管 MCP 服务器提供网页搜索、内容提取与目标驱动的浏览器自动化，支持多步骤真实站点工作流。",
  supabase: "适用于 Apexo 的 Supabase 官方插件，内置 Supabase 技能与 MCP 访问，支持项目管理、数据库操作、身份验证、存储与 Postgres 最佳实践。",
  pstack: "pstack 严谨的智能体工程手册与原则：涵盖问题排查、架构设计、代码审查、验证以及并行子智能体工作流。",
  "browser-use": "为 Apexo 提供真实浏览器能力（本地 Chrome 或云端隔离浏览器），支持网页浏览、数据抓取、表单填写、站点测试、截图与自动化网页工作流。",
  datadog: "Datadog 可观测性集成。直接在 Apexo 中查询日志、指标、链路追踪与性能剖析，搜索并管理监控项、仪表盘与故障事件。",
  quo: "适用于 Apexo 的 Quo 官方 MCP 插件。通过 Quo 托管 OAuth MCP 服务器发送短信、管理联系人与任务、查看消息历史与通话记录。",
  bruin: "Bruin 连接管理系统集成，支持电信费用管理、网络监控、设备采购与 IT 工单处理，内置 Bruin 公共 API 技能。",
  omneky: "Omneky 广告、分析、产品目录与创意生成集成。登录 Omneky 账户即可在 Apexo 中发起并管理营销活动。",
  "modern-web-guidance": "让编码智能体始终掌握现代 Web 平台的最新最佳实践。",
  helena: "Helena AI 营销助手，了解你的业务并跨 SEO、广告、社交媒体与邮件规划、发布和优化营销活动。",
  unity: "Unity 官方编码智能体插件。涵盖 Unity 6 游戏开发技能：UI Toolkit、uGUI、2D 精灵与瓦片地图、URP 渲染、Shader Graph、音频、本地化与多人联机。",
  calcom: "Cal.com 日程预约集成（托管 MCP 服务器 + 技能）。查询可用时间、预约或改期会议、管理事件类型、日程与团队成员。",
  skyvern: "通过 Skyvern 托管 MCP 服务器为 Apexo 提供云端浏览器能力，支持打开页面、点击、输入、表单填写、文件上传、截图及检查控制台与网络活动。",
  "html-css-to-image": "HTML/CSS 转图片 API 集成（托管 OAuth MCP 服务器 + 专用技能）。无需管理浏览器即可生成图片与 PDF、截取网页并使用可复用模板。",
  "pi-security": "Pi Security 官方安全集成（MCP 服务器 + 技能）。调查安全发现、评估安全态势、获取修复建议、开展设计审查并应用安全开发指南。",
  clerk: "Clerk 官方身份认证与用户管理集成。提供框架配置、组织架构、计费、Webhook 与测试指南，并管理 Clerk 应用、用户与实例配置。",
}

export function PluginsDialog() {
  const language = useLanguage()
  return (
    <Dialog title={language.t("plugins.title")} size="x-large" class="plugins-dialog">
      <Plugins />
    </Dialog>
  )
}

export function Plugins() {
  const language = useLanguage()
  const sdk = useServerSDK()
  const platform = usePlatform()
  const layout = useLayout()
  const serverSync = useServerSync()
  const server = useServer()
  const requests = { controller: new AbortController(), runtime: new AbortController() }
  const api = createMemo(() => {
    const current = sdk()
    return current.protocol.then((protocol) => (protocol === "v2" ? current.client.v2.plugins : current.client.plugins))
  })
  const directory = () => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft")
      return route.dir || layout.projects?.list()?.[0]?.worktree || serverSync().data.path?.directory || undefined
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return (
      layout.home.selection().directory ||
      layout.projects?.list()?.[0]?.worktree ||
      serverSync().data.path?.directory ||
      undefined
    )
  }
  const initialDismissedIds = (() => {
    if (typeof localStorage === "undefined") return [] as string[]
    const raw = localStorage.getItem("apexo.plugins.dismissedRetainedData")
    if (!raw) return [] as string[]
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
    } catch {
      return []
    }
  })()
  const [state, setState] = createStore({
    catalog: { sources: [], items: [] } as PluginStore.Catalog,
    tab: "discover",
    query: "",
    source: "",
    sourceInput: "",
    form: "",
    selected: "",
    readme: "",
    pending: false,
    loading: true,
    error: false,
    errorMessage: "",
    confirm: undefined as PluginStore.Action | undefined,
    changed: false,
    runtime: undefined as PluginStoreRuntime | undefined,
    reloadBusy: false,
    runtimeError: false,
    runtimeLoading: false,
    retainedDismissed: false,
    dismissedIds: initialDismissedIds,
  })
  const saveDismissedIds = (next: string[]) => {
    setState("dismissedIds", next)
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("apexo.plugins.dismissedRetainedData", JSON.stringify(next))
    }
  }
  const selected = createMemo(() => state.catalog.items.find((item) => item.id === state.selected))
  const items = createMemo(() =>
    state.catalog.items.filter(
      (item) =>
        (state.tab !== "installed" || item.status !== "available") &&
        (!state.source || item.sourceID === state.source) &&
        `${item.name} ${item.description} ${ZH_PLUGIN_DESCRIPTIONS[item.name] ?? ""} ${item.category} ${ZH_PLUGIN_CATEGORIES[item.category] ?? ""} ${item.author ?? ""}`
          .toLowerCase()
          .includes(state.query.toLowerCase()),
    ),
  )
  const manage = async (action: PluginStore.Action) => {
    if (state.pending) return
    const signal = requests.controller.signal
    const client = api()
    setState({ pending: true, error: false, errorMessage: "", reloadBusy: false })
    await client
      .then((plugins) => plugins.manage({ pluginStoreAction: action }, { signal, throwOnError: true }))
      .then(async (result) => {
        if (signal.aborted) return
        if ((action.action === "install" || action.action === "uninstall") && action.id) {
          saveDismissedIds(
            state.dismissedIds.filter((id) => id !== action.id && !id.endsWith(`:${action.id}`)),
          )
          setState("retainedDismissed", false)
        }
        setState("catalog", reconcile(result.data))
        setState({ form: "", sourceInput: "", confirm: undefined, error: false, errorMessage: "" })
        if (["install", "update", "enable", "disable", "uninstall"].includes(action.action)) {
          setState("changed", true)
          if (action.action === "uninstall") {
            const current = sdk()
            if ((await current.protocol) === "v2") {
              const dirs = Array.from(
                new Set(
                  [
                    directory(),
                    ...(layout.projects?.list()?.map((p) => p.worktree) ?? []),
                    serverSync().data.path?.directory,
                  ].filter((d): d is string => Boolean(d)),
                ),
              )
              await Promise.all(
                dirs.map((dir) =>
                  current.client.v2.plugins
                    .reload({ location: { directory: dir } }, { signal, throwOnError: false })
                    .catch(() => undefined),
                ),
              )
              await serverSync().reloadCommands?.(directory())
              await refreshRuntime()
              const refreshed = await client
                .then((plugins) => plugins.list({}, { signal, throwOnError: true }))
                .catch(() => undefined)
              if (refreshed && !signal.aborted) {
                setState("catalog", reconcile(refreshed.data))
              }
            }
          }
        }
      })
      .catch((err) => {
        if (signal.aborted) return
        const msg =
          err && typeof err === "object" && "message" in err && typeof err.message === "string"
            ? err.message
            : err &&
                typeof err === "object" &&
                "data" in err &&
                err.data &&
                typeof err.data === "object" &&
                "message" in err.data &&
                typeof err.data.message === "string"
              ? err.data.message
              : ""
        setState({
          error: true,
          errorMessage: msg.startsWith("Plugin path does not exist:")
            ? language.t("plugins.error.pathNotFound", {
                path: msg.slice("Plugin path does not exist:".length).trim(),
              })
            : msg,
          ...(state.form ? { confirm: undefined } : {}),
        })
        if (state.form) {
          requestAnimationFrame(() => {
            const input = document.getElementById("plugins-source")
            if (input instanceof HTMLInputElement) input.focus()
          })
        }
      })
      .finally(() => {
        if (!signal.aborted) setState("pending", false)
      })
  }
  createEffect(() => {
    const client = api()
    const abort = new AbortController()
    requests.controller = abort
    setState({
      catalog: { sources: [], items: [] },
      selected: "",
      source: "",
      pending: false,
      loading: true,
      error: false,
      changed: false,
      confirm: undefined,
      form: "",
    })
    void client
      .then((plugins) => plugins.list({}, { signal: abort.signal, throwOnError: true }))
      .then(async (result) => {
        if (abort.signal.aborted) return
        setState("catalog", reconcile(result.data))
        if (!result.data.items.length && result.data.sources.some((source) => !source.updatedAt))
          await manage({ action: "refresh" })
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("loading", false)
      })
    onCleanup(() => abort.abort())
  })
  createEffect(
    on(
      () => [state.selected, selected()?.path],
      ([id]) => {
        const client = api()
        const abort = new AbortController()
        setState("readme", "")
        if (id)
          void client
            .then((plugins) => plugins.detail({ id }, { signal: abort.signal, throwOnError: true }))
            .then((result) => {
              if (!abort.signal.aborted) setState("readme", result.data.readme)
            })
            .catch(() => {
              if (!abort.signal.aborted) setState("error", true)
            })
        onCleanup(() => abort.abort())
      },
    ),
  )
  const action = (action: PluginStore.Action) => {
    if (["install", "enable", "update", "uninstall", "remove-source"].includes(action.action)) {
      setState("confirm", action)
      return
    }
    void manage(action)
  }
  const status = (item: PluginStore.Item) => language.t(`plugins.status.${item.status}`)
  const category = (item: PluginStore.Item) => {
    if (item.category === "other") return language.t("settings.providers.tag.other")
    if (language.locale() === "zh") return ZH_PLUGIN_CATEGORIES[item.category] ?? item.category
    return item.category
  }
  const description = (item: PluginStore.Item) => {
    if (language.locale() === "zh") return ZH_PLUGIN_DESCRIPTIONS[item.name] ?? item.description
    return item.description
  }
  const sourceName = (source: PluginStore.Source) => {
    if (language.locale() === "zh" && (source.official || /^(official|xai(-official)?)$/i.test(source.name))) {
      return "官方"
    }
    return source.name
  }
  const refreshRuntime = async () => {
    const current = sdk()
    const target = directory()
    const signal = requests.runtime.signal
    if (!target || (await current.protocol) !== "v2" || signal.aborted) return
    setState({ runtimeLoading: true, runtimeError: false })
    await current.client.v2.plugins
      .runtime({ location: { directory: target } }, { signal, throwOnError: true })
      .then((result) => {
        if (!signal.aborted) setState("runtime", reconcile(result.data))
      })
      .catch(() => {
        if (!signal.aborted) setState("runtimeError", true)
      })
      .finally(() => {
        if (!signal.aborted) setState("runtimeLoading", false)
      })
  }
  createEffect(() => {
    sdk()
    directory()
    const abort = new AbortController()
    requests.runtime = abort
    setState({ runtime: undefined, runtimeError: false, runtimeLoading: false })
    void refreshRuntime()
    onCleanup(() => abort.abort())
  })
  const reload = async () => {
    if (state.pending) return
    const current = sdk()
    const target = directory()
    const signal = requests.controller.signal
    setState({ pending: true, error: false, reloadBusy: false })
    await (async () => {
      if ((await current.protocol) === "v2") {
        if (!target) return
        const result = await current.client.v2.plugins.reload(
          { location: { directory: target } },
          { signal, throwOnError: false },
        )
        if (!result.response.ok) {
          if (!signal.aborted) setState("reloadBusy", result.response.status === 409)
          throw result.error
        }
        const otherDirs = Array.from(
          new Set(
            [
              ...(layout.projects?.list()?.map((p) => p.worktree) ?? []),
              serverSync().data.path?.directory,
            ].filter((d): d is string => Boolean(d) && d !== target),
          ),
        )
        await Promise.all(
          otherDirs.map((dir) =>
            current.client.v2.plugins
              .reload({ location: { directory: dir } }, { signal, throwOnError: false })
              .catch(() => undefined),
          ),
        )
        return
      }
      await current.client.plugins.reload({ directory: target }, { signal, throwOnError: true })
    })()
      .then(async () => {
        if (signal.aborted) return
        setState("changed", false)
        await serverSync().reloadCommands?.(target)
      })
      .catch(() => {
        if (!signal.aborted) setState("error", true)
      })
      .finally(async () => {
        if (signal.aborted) return
        await refreshRuntime()
        await api()
          .then((plugins) => plugins.list({}, { signal, throwOnError: true }))
          .then((result) => {
            if (!signal.aborted) setState("catalog", reconcile(result.data))
          })
          .catch(() => undefined)
        if (!signal.aborted) setState("pending", false)
      })
  }
  return (
    <section
      class="plugins-store"
      aria-label={language.t("plugins.title")}
      data-component="plugins-store"
      data-active-tab={state.tab}
    >
      <header class="plugins-header">
        <div>
          <h1>{language.t("plugins.title")}</h1>
          <p>{language.t("plugins.description")}</p>
        </div>
        <div class="plugins-actions">
          <Button variant="ghost" disabled={state.pending} onClick={() => void manage({ action: "refresh" })}>
            {language.t("wsl.onboarding.refresh")}
          </Button>
          <Button
            onClick={() =>
              setState({ form: "install", selected: "", confirm: undefined, error: false, errorMessage: "" })
            }
          >
            {language.t("plugins.add")}
          </Button>
        </div>
      </header>
      <nav class="plugins-tabs" aria-label={language.t("plugins.title")}>
        <For each={["discover", "installed", "sources"] as const}>
          {(tab) => (
            <button
              type="button"
              aria-pressed={!state.form && state.tab === tab}
              onClick={() =>
                setState({ tab, selected: "", form: "", confirm: undefined, error: false, errorMessage: "" })
              }
            >
              {language.t(`plugins.${tab}`)}
            </button>
          )}
        </For>
      </nav>
      <Show when={state.error}>
        <div role="alert" class="plugins-notice">
          {state.reloadBusy
            ? language.t("plugins.activation.failure.busy")
            : state.errorMessage || language.t("plugins.error")}
        </div>
      </Show>
      <Show when={sdk().protocolKind() === "v2"}>
        <section
          class="plugins-notice plugins-runtime"
          data-component="plugins-runtime"
          aria-label={language.t("plugins.activation.title")}
        >
          <strong>{language.t("plugins.activation.title")}</strong>
          <p>{language.t("plugins.activation.hint")}</p>
          <Show when={directory()} fallback={<p>{language.t("plugins.activation.projectRequired")}</p>}>
            <Show when={state.runtime}>
              {(runtime) => (
                <>
                  <p data-component="plugins-runtime-generation">
                    {language.t("plugins.activation.generation", { generation: runtime().generation })}
                  </p>
                  <Show when={runtime().failure}>
                    {(failure) => (
                      <div role="alert" data-component="plugins-runtime-failure">
                        <p>{language.t(`plugins.activation.failure.${failure().code}`)}</p>
                        <Show when={failure().components?.length}>
                          <p>{failure().components?.join(", ")}</p>
                        </Show>
                        <p>{failure().message}</p>
                      </div>
                    )}
                  </Show>
                </>
              )}
            </Show>
            <Show when={state.runtimeError}>
              <p role="alert">{language.t("plugins.activation.unavailable")}</p>
            </Show>
            <div class="plugins-actions">
              <Button
                variant="ghost"
                data-action="plugins-runtime-refresh"
                disabled={state.pending || state.runtimeLoading}
                onClick={() => void refreshRuntime()}
              >
                {language.t("wsl.onboarding.refresh")}
              </Button>
              <Button
                data-action="plugins-runtime-reload"
                disabled={state.pending || state.runtimeLoading}
                onClick={() => void reload()}
              >
                {language.t("plugins.reload")}
              </Button>
            </div>
          </Show>
        </section>
      </Show>
      <Show when={state.changed && sdk().protocolKind() !== "v2"}>
        <div role="status" class="plugins-notice plugins-notice-row">
          <span>{language.t("plugins.changed")}</span>
          <Button variant="secondary" size="small" disabled={state.pending} onClick={() => void reload()}>
            {language.t("plugins.reload")}
          </Button>
        </div>
      </Show>
      <Show
        when={
          state.catalog.retainedData?.some((item) => !state.dismissedIds.includes(item.id)) && !state.retainedDismissed
        }
      >
        <div role="status" class="plugins-notice plugins-notice-row">
          <span>{language.t("plugins.cleanupDeferred")}</span>
          <Button
            variant="ghost"
            size="small"
            aria-label={language.t("common.close")}
            onClick={() => {
              const ids = (state.catalog.retainedData ?? []).map((item) => item.id)
              saveDismissedIds(Array.from(new Set([...state.dismissedIds, ...ids])))
              setState("retainedDismissed", true)
            }}
          >
            ×
          </Button>
        </div>
      </Show>
      <Show when={state.pending || state.loading}>
        <div role="status" class="plugins-progress">
          {language.t("common.loading")}
        </div>
      </Show>
      <Show when={state.confirm}>
        {(confirmation) => {
          const targetItem = () => state.catalog.items.find((item) => item.id === confirmation().id)
          const confirmTitle = () => {
            if (confirmation().action === "uninstall") {
              return language.t("plugins.uninstallConfirmTitle", {
                name: targetItem()?.name ?? confirmation().id ?? "",
              })
            }
            if (confirmation().action === "remove-source") {
              return language.t("plugins.removeSourceConfirmTitle")
            }
            return language.t("plugins.confirm")
          }
          const confirmBody = () => {
            if (confirmation().action === "uninstall") return language.t("plugins.uninstallNotice")
            if (confirmation().action === "remove-source") return language.t("plugins.removeSourceNotice")
            return language.t("plugins.trust")
          }
          const isDestructive = () =>
            confirmation().action === "uninstall" || confirmation().action === "remove-source"
          return (
            <div role="alertdialog" aria-label={confirmTitle()} class="plugins-confirm">
              <h2>{confirmTitle()}</h2>
              <p>{confirmBody()}</p>
              <code>{confirmation().source ?? targetItem()?.source ?? confirmation().id}</code>
              <Show when={confirmation().action === "uninstall"}>
                <label class="plugins-confirm-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmation().keepData ?? false}
                    disabled={state.pending}
                    onChange={(event) =>
                      setState("confirm", { ...confirmation(), keepData: event.currentTarget.checked })
                    }
                  />
                  <span>{language.t("plugins.keepData")}</span>
                </label>
              </Show>
              <div class="plugins-actions">
                <Button variant="ghost" disabled={state.pending} onClick={() => setState("confirm", undefined)}>
                  {language.t("common.cancel")}
                </Button>
                <Button
                  class={isDestructive() ? "plugins-danger-button" : undefined}
                  disabled={state.pending}
                  onClick={() => void manage({ ...confirmation(), trust: true })}
                >
                  {language.t("common.continue")}
                </Button>
              </div>
            </div>
          )
        }}
      </Show>
      <Show when={state.form && !state.confirm}>
        <form
          class="plugins-form"
          onSubmit={(event) => {
            event.preventDefault()
            action({ action: state.form === "source" ? "add-source" : "install", source: state.sourceInput.trim() })
          }}
        >
          <h2>{language.t(state.form === "source" ? "plugins.addSource" : "plugins.add")}</h2>
          <label for="plugins-source">{language.t("plugins.sourceInput")}</label>
          <input
            id="plugins-source"
            value={state.sourceInput}
            onInput={(event) => setState({ sourceInput: event.currentTarget.value, error: false, errorMessage: "" })}
            placeholder={language.t("plugins.sourcePlaceholder")}
            required
          />
          <div class="plugins-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setState({ form: "", error: false, errorMessage: "" })}
            >
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" disabled={state.pending || !state.sourceInput.trim()}>
              {language.t("common.continue")}
            </Button>
          </div>
        </form>
      </Show>
      <Show when={!state.form && selected()}>
        {(item) => (
          <article class="plugins-detail">
            <Button
              variant="ghost"
              onClick={() => setState({ selected: "", confirm: undefined, error: false, errorMessage: "" })}
            >
              {language.t("common.goBack")}
            </Button>
            <div class="plugins-detail-heading">
              <div class="plugins-avatar" aria-hidden="true">
                {item().name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h2>{item().name}</h2>
                <p>{item().author ?? category(item())}</p>
              </div>
              <span class="plugins-badge">{status(item())}</span>
            </div>
            <Show when={state.runtime}>
              <p data-component="plugins-activation-status">
                {language.t(
                  state.runtime?.active.includes(item().id)
                    ? "plugins.activation.active"
                    : "plugins.activation.inactive",
                )}
              </p>
            </Show>
            <p>{description(item())}</p>
            <div class="plugins-actions">
              <Show when={item().status === "available" || item().status === "downloaded"}>
                <Button disabled={state.pending} onClick={() => action({ action: "install", id: item().id })}>
                  {language.t("wsl.onboarding.install")}
                </Button>
              </Show>
              <Show when={item().status === "available"}>
                <Button
                  variant="secondary"
                  disabled={state.pending}
                  onClick={() => action({ action: "download", id: item().id })}
                >
                  {language.t("plugins.download")}
                </Button>
              </Show>
              <Show when={item().status === "enabled" || item().status === "disabled"}>
                <Button
                  variant="secondary"
                  disabled={state.pending}
                  onClick={() => action({ action: item().status === "enabled" ? "disable" : "enable", id: item().id })}
                >
                  {language.t(item().status === "enabled" ? "plugins.disable" : "plugins.enable")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={state.pending}
                  onClick={() => action({ action: "update", id: item().id })}
                >
                  {language.t("plugins.update")}
                </Button>
              </Show>
              <Show when={item().status !== "available"}>
                <Button
                  variant="ghost"
                  disabled={state.pending}
                  onClick={() => action({ action: "uninstall", id: item().id })}
                >
                  {language.t("plugins.uninstall")}
                </Button>
              </Show>
            </div>
            <dl class="plugins-metadata">
              <dt>{language.t("plugins.sources")}</dt>
              <dd>{item().source}</dd>
              <dt>{language.t("plugins.version")}</dt>
              <dd>
                {item().installedVersion ??
                  item().version ??
                  item().installedRevision?.slice(0, 12) ??
                  item().revision?.slice(0, 12) ??
                  "—"}
              </dd>
            </dl>
            <Show when={item().path}>
              <div class="plugins-path">
                <span>{language.t("plugins.files")}</span>
                <code>{item().path}</code>
                <Show when={platform.openPath && server.isLocal()}>
                  <Button variant="ghost" onClick={() => void platform.openPath?.(item().path!)}>
                    {language.t("common.open")}
                  </Button>
                </Show>
              </div>
            </Show>
            <Show when={item().warnings.includes("hooks")}>
              <div class="plugins-notice">{language.t("plugins.hooksWarning")}</div>
            </Show>
            <h3>{language.t("plugins.contents")}</h3>
            <div class="plugins-components">
              <For each={item().components}>
                {(component) => (
                  <div>
                    <span class="plugins-badge">{language.t(`plugins.component.${component.kind}`)}</span>
                    <strong>{component.name}</strong>
                    <Show when={component.description}>
                      <p>{component.description}</p>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Show when={state.readme}>
              <h3>{language.t("plugins.readme")}</h3>
              <pre class="plugins-readme">{state.readme}</pre>
            </Show>
          </article>
        )}
      </Show>
      <Show when={!state.form && !selected() && state.tab === "sources"}>
        <div class="plugins-source-heading">
          <h2>{language.t("plugins.sources")}</h2>
          <Button onClick={() => setState("form", "source")}>{language.t("plugins.addSource")}</Button>
        </div>
        <For each={state.catalog.sources}>
          {(source) => (
            <article class="plugins-source">
              <div>
                <h3>{sourceName(source)}</h3>
                <p>{source.location}</p>
                <Show when={source.error}>
                  <p role="alert">{language.t("plugins.sourceError")}</p>
                </Show>
              </div>
              <Button
                variant="ghost"
                disabled={state.pending}
                onClick={() => action({ action: "remove-source", id: source.id })}
              >
                {language.t("plugins.removeSource")}
              </Button>
            </article>
          )}
        </For>
      </Show>
      <Show when={!state.form && !selected() && state.tab !== "sources"}>
        <div class="plugins-filters">
          <input
            aria-label={language.t("common.search.placeholder")}
            placeholder={language.t("plugins.search")}
            value={state.query}
            onInput={(event) => setState("query", event.currentTarget.value)}
          />
          <select
            aria-label={language.t("plugins.sources")}
            value={state.source}
            onChange={(event) => setState("source", event.currentTarget.value)}
          >
            <option value="">{language.t("plugins.allSources")}</option>
            <For each={state.catalog.sources}>{(source) => <option value={source.id}>{sourceName(source)}</option>}</For>
          </select>
        </div>
        <h2>
          {language.t(
            state.tab === "installed"
              ? "plugins.installed"
              : items().length && items().every((item) => item.recommended)
                ? "plugins.recommended"
                : "plugins.discover",
          )}
        </h2>
        <Show when={!state.loading && !items().length}>
          <p class="plugins-empty">{language.t("plugins.empty")}</p>
        </Show>
        <div class="plugins-grid">
          <For each={items()}>
            {(item) => (
              <button
                type="button"
                class="plugins-card"
                onClick={() => setState({ selected: item.id, confirm: undefined, error: false, errorMessage: "" })}
              >
                <div class="plugins-card-top">
                  <div class="plugins-avatar" aria-hidden="true">
                    {item.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3>{item.name}</h3>
                    <span>{item.author ?? category(item)}</span>
                  </div>
                  <Show when={item.status !== "available"}>
                    <span class="plugins-badge">{status(item)}</span>
                    <Show when={state.runtime}>
                      <span class="plugins-badge" data-component="plugins-activation-status">
                        {language.t(
                          state.runtime?.active.includes(item.id)
                            ? "plugins.activation.active"
                            : "plugins.activation.inactive",
                        )}
                      </span>
                    </Show>
                  </Show>
                </div>
                <p>{description(item)}</p>
                <div class="plugins-card-bottom">
                  <span>{category(item)}</span>
                  <Icon name="arrow-right" />
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}
