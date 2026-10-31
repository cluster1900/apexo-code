import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@apexo/core/util/encode"
import { nextSessionMode, parseCopyArgs, type SessionModeName } from "@apexo/sdk/v2/grok-commands"
import { browserTaskPrompt, parseBrowserCommand } from "@apexo/sdk/v2/browser-command"
import { parseComputerCommand } from "@apexo/sdk/v2/computer-command"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@apexo/ui/context/dialog"
import { previewSelectedLines } from "@apexo/session-ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { showToast } from "@/utils/toast"
import {
  downloadSessionExport,
  fetchSessionExport,
  sessionExportFilename,
  sessionResponse,
  sessionTrace,
  sessionTranscript,
  sessionUsage,
} from "@/utils/session-export"
import { createSessionTabs } from "@/pages/session/helpers"
import { extractPromptFromParts } from "@/utils/prompt"
import { Message, Part, UserMessage } from "@apexo/sdk/v2"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSessionArchive } from "@/pages/session/session-archive"
import { createSessionOwnership } from "./session-ownership"
import { useLocal } from "@/context/local"
import { useGrokCommands } from "@/components/grok-commands"
import { vimKeydown } from "@/utils/vim-mode"
import { applyCompactMode } from "@/utils/compact-mode"
import { createEffect } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"

export type SessionCommandContext = {
  navigateMessageByOffset: (offset: number) => void
  navigateToMessage?: (messageID: string) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  focusInput: () => void
  review?: () => boolean
  fileBrowser?: () => boolean
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const language = useLanguage()
  const permission = usePermission()
  const prompt = usePrompt()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const settings = useSettings()
  const sync = useSync()
  const terminal = useTerminal()
  const layout = useLayout()
  const local = useLocal()
  const navigate = useNavigate()
  const { params, sessionKey, tabs, view } = useSessionLayout()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const sessionArchive = useSessionArchive()
  const grok = useGrokCommands(() => params.id)
  const browser = {
    sessionID: undefined as string | undefined,
    browserSessionID: undefined as string | undefined,
    pageID: undefined as string | undefined,
    snapshotHash: undefined as string | undefined,
  }
  const computer = {
    sessionID: undefined as string | undefined,
    computerSessionID: undefined as string | undefined,
    snapshotHash: undefined as string | undefined,
  }
  let hydratedAutomationSessionID: string | undefined
  createEffect(() => {
    const sessionID = params.id
    if (!sessionID || hydratedAutomationSessionID === sessionID) return
    hydratedAutomationSessionID = sessionID
    void Promise.all([
      sdk().client.v2.browser.list({ sessionID }, { throwOnError: true }).then((response) => response.data),
      sdk().client.v2.computer.list({ sessionID }, { throwOnError: true }).then((response) => response.data),
    ])
      .then(([browsers, computers]) => {
        if (params.id !== sessionID) return
        const browserSession = browsers.find((item) => item.status === "connected")
        if (browserSession) {
          browser.sessionID = sessionID
          browser.browserSessionID = browserSession.id
          browser.pageID = browserSession.page?.id
          browser.snapshotHash = browserSession.page?.snapshotHash
        }
        const computerSession = computers.find((item) => item.status === "ready")
        if (computerSession) {
          computer.sessionID = sessionID
          computer.computerSessionID = computerSession.id
          computer.snapshotHash = computerSession.snapshot?.hash
        }
      })
      .catch(() => undefined)
  })
  const openDialog = async <T,>(load: () => Promise<T>, show: (value: T) => void) => {
    const owner = sessionOwnership.capture()
    const value = await load()
    owner.run(() => show(value))
  }
  const runCommand = async <T,>(input: {
    owner: ReturnType<ReturnType<typeof createSessionOwnership>["capture"]>
    prompt: T
    request: () => Promise<unknown>
    updatePrompt: (prompt: T) => void
    updateViewport: () => void
  }) => {
    await input.request()
    input.updatePrompt(input.prompt)
    input.owner.run(input.updateViewport)
  }

  const info = () => {
    const id = params.id
    if (!id) return
    return sync().session.get(id)
  }
  const hasReview = () => !!params.id
  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: actions.review,
    hasReview,
    fileBrowser: actions.fileBrowser,
  })
  const activeFileTab = tabState.activeFileTab
  const closableTab = tabState.closableTab
  const shown = settings.visibility.fileTree

  const messages = () => {
    const id = params.id
    if (!id) return []
    return sync().data.message[id] ?? []
  }
  const userMessages = () => messages().filter((m) => m.role === "user") as UserMessage[]
  const visibleUserMessages = () => {
    const revert = info()?.revert?.messageID
    if (!revert) return userMessages()
    const boundary = userMessages().findIndex((message) => message.id === revert)
    return boundary < 0 ? userMessages() : userMessages().slice(0, boundary)
  }

  const showAllFiles = () => {
    if (layout.fileTree.tab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const canAddSelectionContext = () => {
    const tab = activeFileTab()
    if (!tab) return false
    const path = file.pathFromTab(tab)
    if (!path) return false
    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const setActiveMessage = actions.setActiveMessage
  const focusInput = actions.focusInput

  const sessionCommand = withCategory(language.t("command.category.session"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const terminalCommand = withCategory(language.t("command.category.terminal"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))
  const serverCommand = withCategory(language.t("command.category.server"))

  const isAutoAcceptActive = () => {
    const sessionID = params.id
    if (sessionID) return permission.isAutoAccepting(sessionID, sdk().directory)
    return permission.isAutoAcceptingDirectory(sdk().directory)
  }

  const fallbackExportMessages = (sessionID: string) =>
    (sync().data.message[sessionID] ?? []).map((info) => ({
      info,
      parts: sync().data.part[info.id] ?? [],
    }))

  const withExport = async (use: (data: Awaited<ReturnType<typeof fetchSessionExport>>) => unknown) => {
    const sessionID = params.id
    if (!sessionID) return
    try {
      await use(
        await fetchSessionExport({
          sessionID,
          client: sdk().client,
          fallbackMessages: fallbackExportMessages(sessionID),
        }),
      )
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const copyTranscript = () =>
    withExport(async (data) => {
      await navigator.clipboard.writeText(sessionTranscript(data))
      showToast({ variant: "success", icon: "circle-check", title: language.t("toast.session.copy.success") })
    })

  // Grok Build `/copy [N]` and vim `y`: the Nth-latest response's markdown (1 = latest).
  const copyResponse = (index = 1) =>
    withExport(async (data) => {
      const text = sessionResponse(data, index)
      if (!text) {
        showToast({
          variant: "error",
          title: index === 1 ? language.t("grok.vim.noMessage") : language.t("grok.copy.missing", { index }),
        })
        return
      }
      await navigator.clipboard.writeText(text)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: index === 1 ? language.t("grok.vim.copied") : language.t("grok.copy.done", { index }),
      })
    })
  createEffect(() => applyCompactMode(sync().data.config))
  // Capture phase: timeline/list handlers stop propagation of bare letter keys before they reach window.
  makeEventListener(
    window,
    "keydown",
    (event) => {
      if (params.id)
        vimKeydown(
          event,
          { message: () => void copyResponse(), transcript: () => void copyTranscript() },
          sync().data.config,
        )
    },
    { capture: true },
  )

  const showUsage = () =>
    withExport((data) =>
      openDialog(
        () => import("@/components/dialog-session-usage"),
        (x) => dialog.show(() => <x.DialogSessionUsage usage={sessionUsage(data)} />),
      ),
    )

  const exportTrace = () =>
    withExport(async (data) => {
      const filename = sessionExportFilename(data.info).replace(/\.json$/, ".trace.json")
      const saved = await downloadSessionExport(
        filename,
        sessionTrace(data, "apexo-desktop"),
        language.t("command.session.trace"),
      )
      if (!saved) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename: saved }),
      })
    })

  const openTimeline = () => {
    const sessionID = params.id
    const navigate = actions.navigateToMessage
    if (!sessionID || !navigate) return
    void openDialog(
      () => import("@/components/dialog-timeline"),
      (x) => dialog.show(() => <x.DialogTimeline sessionID={sessionID} onSelect={navigate} />),
    )
  }

  const exportSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
        fallbackMessages: fallbackExportMessages(sessionID),
      })
      const filename = sessionExportFilename(data.info)
      const saved = await downloadSessionExport(filename, data, language.t("command.session.export"))
      if (!saved) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename: saved }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const openFile = () => {
    void openDialog(
      () => import("@/components/dialog-select-file"),
      (x) => dialog.show(() => <x.DialogSelectFile onOpenFile={showAllFiles} />),
    )
  }

  const closeTab = () => {
    const tab = closableTab()
    if (!tab) return
    tabs().close(tab)
  }

  const addSelection = () => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (!path) return

    const range = file.selectedLines(path) as SelectedLineRange | null | undefined
    if (!range) {
      showToast({
        title: language.t("toast.context.noLineSelection.title"),
        description: language.t("toast.context.noLineSelection.description"),
      })
      return
    }

    addSelectionToContext(path, selectionFromLines(range))
  }

  const openTerminal = () => {
    if (terminal.all().length > 0) terminal.new({ focus: true })
    if (terminal.all().length === 0) terminal.requestFocus()
    view().terminal.open()
  }

  const closeTerminal = () => {
    const id = terminal.active()
    if (!id) return
    const last = terminal.all().length === 1
    void terminal.close(id)
    if (last) view().terminal.close()
  }

  const chooseMcp = () => {
    void openDialog(
      () => import("@/components/dialog-select-mcp"),
      (x) => dialog.show(() => <x.DialogSelectMcp />),
    )
  }

  const toggleAutoAccept = () => {
    const sessionID = params.id
    if (sessionID) permission.toggleAutoAccept(sessionID, sdk().directory)
    else permission.toggleAutoAcceptDirectory(sdk().directory)

    const active = sessionID
      ? permission.isAutoAccepting(sessionID, sdk().directory)
      : permission.isAutoAcceptingDirectory(sdk().directory)
    showToast({
      title: active
        ? language.t("toast.permissions.autoaccept.on.title")
        : language.t("toast.permissions.autoaccept.off.title"),
      description: active
        ? language.t("toast.permissions.autoaccept.on.description")
        : language.t("toast.permissions.autoaccept.off.description"),
    })
  }

  const toggleReview = () => {
    const sessionID = params.id
    if (!sessionID) return showToast({ title: language.t("grok.auto.noSession") })
    const active = permission.toggleReview(sessionID, sdk().directory)
    showToast({
      title: active ? language.t("grok.auto.on.title") : language.t("grok.auto.off.title"),
      description: active ? language.t("grok.auto.on.description") : language.t("grok.auto.off.description"),
    })
  }

  // Grok Build Shift+Tab: Normal → Plan → Auto → Always-approve. Plan is the plan agent; the others are permission modes.
  let modeCycleAgent = "build"
  const cycleSessionMode = () => {
    const sessionID = params.id
    if (!sessionID) return
    const directory = sdk().directory
    const agent = local.agent.current()?.name
    const current: SessionModeName =
      agent === "plan"
        ? "plan"
        : permission.isReviewing(sessionID, directory)
          ? "auto"
          : permission.isAutoAccepting(sessionID, directory)
            ? "always-approve"
            : "normal"
    const next = nextSessionMode(current, { plan: local.agent.list().some((item) => item.name === "plan"), auto: true })
    if (next === "plan") {
      if (agent && agent !== "plan") modeCycleAgent = agent
      local.agent.set("plan")
    } else if (agent === "plan") local.agent.set(modeCycleAgent)
    if (next === "auto") permission.toggleReview(sessionID, directory)
    if (next === "always-approve") permission.toggleAutoAccept(sessionID, directory)
    if (next === "normal" || next === "plan") {
      if (permission.isReviewing(sessionID, directory)) permission.toggleReview(sessionID, directory)
      if (permission.isAutoAccepting(sessionID, directory)) permission.disableAutoAccept(sessionID, directory)
    }
    showToast({ title: language.t(`grok.mode.${next}` as never) })
  }

  const undo = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const owner = sessionOwnership.capture()
    const session = sdk().api.session
    const directory = sdk().directory
    const promptSession = prompt.capture()
    const revert = info()?.revert?.messageID
    const messages = userMessages()
    const boundary = revert ? messages.findIndex((message) => message.id === revert) : messages.length
    if (boundary < 0) return
    const message = messages[boundary - 1]
    if (!message) return
    const parts = sync().data.part[message.id]

    if (sync().data.session_working(sessionID)) {
      await session.interrupt({ sessionID }).catch(() => {})
    }

    await runCommand({
      owner,
      prompt: promptSession,
      request: () => session.revert.stage({ sessionID, messageID: message.id }),
      updatePrompt: (promptSession) => {
        if (parts) promptSession.set(extractPromptFromParts(parts, { directory }))
      },
      updateViewport: () => setActiveMessage(messages[boundary - 2]),
    })
  }

  const redo = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const owner = sessionOwnership.capture()
    const session = sdk().api.session
    const messages = userMessages()
    const promptSession = prompt.capture()

    const revertMessageID = info()?.revert?.messageID
    if (!revertMessageID) return

    const boundary = messages.findIndex((message) => message.id === revertMessageID)
    if (boundary < 0) return
    const next = messages[boundary + 1]
    if (!next) {
      await runCommand({
        owner,
        prompt: promptSession,
        request: () => session.revert.clear({ sessionID }),
        updatePrompt: (promptSession) => promptSession.reset(),
        updateViewport: () => setActiveMessage(messages.at(-1)),
      })
      return
    }

    await runCommand({
      owner,
      prompt: promptSession,
      request: () => session.revert.stage({ sessionID, messageID: next.id }),
      updatePrompt: () => undefined,
      updateViewport: () => setActiveMessage(messages[boundary]),
    })
  }

  const compact = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const model = local.model.current()
    if (!model) {
      showToast({
        title: language.t("toast.model.none.title"),
        description: language.t("toast.model.none.description"),
      })
      return
    }

    await sdk().api.session.compact({
      sessionID,
      model: { providerID: model.provider.id, modelID: model.id },
    })
  }

  const fork = () => {
    void openDialog(
      () => import("@/components/dialog-fork"),
      (x) => dialog.show(() => <x.DialogFork />),
    )
  }

  const ensureAutomationSession = async (tool: "browser" | "computer") => {
    if (params.id) return params.id
    const model = local.model.current()
    const agent = local.agent.current()
    if (!model || !agent) {
      showToast({
        variant: "error",
        title: tool === "browser" ? "Browser" : "Computer",
        description: `Select a model and agent before using /${tool}`,
      })
      return undefined
    }
    const created = (
      await sdk().client.v2.session.create(
        {
          agent: agent.name,
          model: { id: model.id, providerID: model.provider.id, variant: local.model.variant.current() },
          location: { directory: sdk().directory },
        },
        { throwOnError: true },
      )
    ).data.data
    navigate(`/${base64Encode(sdk().directory)}/session/${created.id}`)
    return created.id
  }

  const ensureBrowserSession = () => ensureAutomationSession("browser")

  const runBrowserCommand = async (args: string) => {
    const sessionID = await ensureBrowserSession()
    if (!sessionID) return
    if (browser.sessionID !== sessionID) {
      browser.sessionID = sessionID
      browser.browserSessionID = undefined
      browser.pageID = undefined
      browser.snapshotHash = undefined
    }

    try {
      const parsed = parseBrowserCommand(args)
      if (parsed.action === "help") {
        showToast({ title: "Browser", description: parsed.message ?? "Usage: /browser <action>" })
        return
      }
      showToast({ title: "Browser", description: `Running ${parsed.action}…`, variant: "loading" })
      if (parsed.action === "open") {
        const result = (
          await sdk().client.v2.browser.open(
            { sessionID, url: parsed.url, cdpUrl: parsed.cdpUrl },
            { throwOnError: true },
          )
        ).data
        browser.browserSessionID = result.id
        browser.pageID = result.page?.id
        browser.snapshotHash = result.page?.snapshotHash
        showToast({ variant: "success", title: "Browser", description: `Opened ${result.page?.url ?? parsed.url}` })
        return
      }
      if (!browser.browserSessionID) throw new Error("No browser session. Run /browser open <url> first")
      if (parsed.action === "close") {
        await sdk().client.v2.browser.close({ sessionID, browserSessionID: browser.browserSessionID }, { throwOnError: true })
        browser.browserSessionID = undefined
        browser.pageID = undefined
        browser.snapshotHash = undefined
        showToast({ variant: "success", title: "Browser", description: "Closed browser session" })
        return
      }
      if (parsed.action === "events") {
        const result = (
          await sdk().client.v2.browser.events(
            {
              sessionID,
              browserSessionID: browser.browserSessionID,
              after: parsed.after === undefined ? undefined : String(parsed.after),
              limit: parsed.limit === undefined ? undefined : String(parsed.limit),
            },
            { throwOnError: true },
          )
        ).data
        const description = result.events.length === 0
          ? "No browser events"
          : result.events.map((event) => `${event.type} ${event.durable?.seq ?? ""}`.trim()).join("\n")
        showToast({ title: "Browser events", description })
        return
      }

      const result = (
        await sdk().client.v2.browser.action(
          {
            sessionID,
            browserSessionID: browser.browserSessionID,
            action: parsed.action,
            pageID: browser.pageID,
            selector: parsed.action === "click" || parsed.action === "type" ? parsed.selector : undefined,
            text: parsed.action === "type" ? parsed.text : undefined,
            key: parsed.action === "press" ? parsed.key : undefined,
            x: parsed.action === "scroll" ? parsed.x : undefined,
            y: parsed.action === "scroll" ? parsed.y : undefined,
            expectedSnapshotHash: browser.snapshotHash,
            fullPage: parsed.action === "screenshot" ? parsed.fullPage : undefined,
            destructive: ["click", "type", "press", "scroll"].includes(parsed.action),
          },
          { throwOnError: true },
        )
      ).data
      browser.pageID = result.page?.id ?? browser.pageID
      browser.snapshotHash = result.page?.snapshotHash ?? browser.snapshotHash
      showToast({
        variant: "success",
        title: `Browser ${parsed.action}`,
        description: result.artifact?.relativePath ?? (result.output || result.page?.url || "Done"),
      })
    } catch (error) {
      showToast({ variant: "error", title: "Browser", description: error instanceof Error ? error.message : String(error) })
    }
  }
  let browserQueue: Promise<unknown> = Promise.resolve()
  const runBrowser = (args: string) => {
    const next = browserQueue.then(() => runBrowserCommand(args))
    browserQueue = next.catch(() => undefined)
    return next
  }
  const runBrowserTask = async (task: string) => {
    const parentID = await ensureBrowserSession()
    if (!parentID) return
    showToast({ variant: "loading", title: "Browser", description: "Sending the browser task to the current session…" })
    const promptText = browserTaskPrompt(task)
    const admitted = (
      await sdk().client.v2.session.prompt(
        { sessionID: parentID, prompt: { text: promptText }, delivery: "steer" },
        { throwOnError: true },
      )
    ).data.data
    sync().session.addOptimisticMessage({
      sessionID: parentID,
      messageID: admitted.id,
      parts: [
        {
          id: `${admitted.id}:text:0`,
          sessionID: parentID,
          messageID: admitted.id,
          type: "text",
          text: promptText,
        },
      ],
      agent: local.agent.current()?.name ?? "build",
      model: {
        providerID: local.model.current()?.provider.id ?? "",
        modelID: local.model.current()?.id ?? "",
      },
      variant: local.model.variant.current(),
    })
    await serverSync().session.sync(parentID).catch(() => undefined)
    await serverSync().session.sync(parentID, { force: true }).catch(() => undefined)
    showToast({ variant: "success", title: "Browser", description: "Browser task submitted to the current session" })
  }
  const runComputerCommand = async (args: string) => {
    const sessionID = await ensureAutomationSession("computer")
    if (!sessionID) return
    if (computer.sessionID !== sessionID) {
      computer.sessionID = sessionID
      computer.computerSessionID = undefined
      computer.snapshotHash = undefined
    }
    try {
      const parsed = parseComputerCommand(args)
      if (parsed.action === "help") {
        showToast({ title: "Computer", description: parsed.message ?? "Usage: /computer <action>" })
        return
      }
      showToast({ title: "Computer", description: `Running ${parsed.action}…`, variant: "loading" })
      if (parsed.action === "open") {
        const result = (await sdk().client.v2.computer.open({ sessionID, backend: "auto" }, { throwOnError: true })).data
        computer.computerSessionID = result.id
        computer.snapshotHash = result.snapshot?.hash
        showToast({ variant: result.status === "ready" ? "success" : "error", title: "Computer", description: result.unavailableReason ?? `Opened ${result.id}` })
        return
      }
      if (!computer.computerSessionID) throw new Error("No computer session. Run /computer open first")
      if (parsed.action === "close") {
        await sdk().client.v2.computer.close({ sessionID, computerSessionID: computer.computerSessionID }, { throwOnError: true })
        computer.computerSessionID = undefined
        computer.snapshotHash = undefined
        showToast({ variant: "success", title: "Computer", description: "Closed computer session" })
        return
      }
      if (parsed.action === "events") {
        const result = (await sdk().client.v2.computer.events({ sessionID, computerSessionID: computer.computerSessionID, after: parsed.after === undefined ? undefined : String(parsed.after), limit: parsed.limit === undefined ? undefined : String(parsed.limit) }, { throwOnError: true })).data
        showToast({ title: "Computer events", description: result.events.length ? result.events.map((event) => `${event.type} ${event.durable?.seq ?? ""}`.trim()).join("\n") : "No computer events" })
        return
      }
      const result = (await sdk().client.v2.computer.action({
        sessionID,
        computerSessionID: computer.computerSessionID,
        action: parsed.action,
        x: parsed.action === "click" ? parsed.x : undefined,
        y: parsed.action === "click" || parsed.action === "scroll" ? parsed.y : undefined,
        text: parsed.action === "type" ? parsed.text : undefined,
        key: parsed.action === "press" ? parsed.key : undefined,
        expectedSnapshotHash: computer.snapshotHash,
        destructive: ["click", "type", "press", "scroll", "close"].includes(parsed.action),
      }, { throwOnError: true })).data
      computer.snapshotHash = result.snapshot?.hash ?? computer.snapshotHash
      showToast({ variant: "success", title: `Computer ${parsed.action}`, description: result.artifact?.relativePath ?? result.output })
    } catch (error) {
      showToast({ variant: "error", title: "Computer", description: error instanceof Error ? error.message : String(error) })
    }
  }
  let computerQueue: Promise<unknown> = Promise.resolve()
  const runComputer = (args: string) => {
    const next = computerQueue.then(() => runComputerCommand(args))
    computerQueue = next.catch(() => undefined)
    return next
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.browser",
      title: "Control browser through Chrome CDP",
      description: "Open and control a real Chrome session with /browser",
      slash: "browser",
      onSlash: (args) =>
        void (parseBrowserCommand(args).action === "help" && args.trim() !== ""
          ? runBrowserTask(args).catch((error: unknown) =>
              showToast({
                variant: "error",
                title: "Browser",
                description: error instanceof Error ? error.message : String(error),
              }),
            )
          : runBrowser(args)),
      onSelect: () => void runBrowser(""),
    }),
    sessionCommand({
      id: "session.computer",
      title: "Control the desktop with Computer Use",
      description: "Observe and control desktop applications with /computer",
      slash: "computer",
      onSlash: (args) => void runComputer(args),
      onSelect: () => void runComputer(""),
    }),
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: "new",
      slashAliases: ["clear", "home", "welcome"],
      onSelect: (source) => {
        if (settings.general.newLayoutDesigns()) {
          command.trigger("tab.new", source)
          return
        }
        navigate(`/${params.dir}/session`)
      },
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: "undo",
      slashAliases: ["rewind"],
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: "compact",
      slashAliases: ["summarize"],
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: compact,
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: "fork",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: fork,
    }),
    sessionCommand({
      id: "session.export",
      title: language.t("command.session.export"),
      description: language.t("command.session.export.description"),
      slash: "export",
      disabled: !params.id,
      onSelect: exportSession,
    }),
    sessionCommand({
      id: "session.skills",
      title: language.t("command.session.skills"),
      slash: "skills",
      disabled: !params.id,
      // Seeds "/" so the slash menu, which lists skills alongside commands, opens in the composer.
      onSelect: () => {
        prompt.set([{ type: "text", content: "/", start: 0, end: 1 }], 1)
        actions.focusInput()
      },
    }),
    sessionCommand({
      id: "session.copy",
      title: language.t("command.session.copy"),
      slash: "copy",
      disabled: !params.id,
      onSelect: () => void copyResponse(),
      onSlash: (args) => {
        const parsed = parseCopyArgs(args)
        if ("error" in parsed) return showToast({ variant: "error", title: parsed.error })
        // The renderer has no safe new-file write; Grok's file output stays a terminal feature.
        if (parsed.path) return showToast({ title: language.t("grok.copy.file", { index: parsed.index }) })
        void copyResponse(parsed.index)
      },
    }),
    sessionCommand({
      id: "session.timeline",
      title: language.t("command.session.timeline"),
      slash: "timeline",
      disabled: !params.id || visibleUserMessages().length === 0 || !actions.navigateToMessage,
      onSelect: openTimeline,
    }),
    sessionCommand({
      id: "session.usage",
      title: language.t("command.session.usage"),
      slash: "usage",
      slashAliases: ["cost"],
      disabled: !params.id,
      onSelect: () => void showUsage(),
    }),
    sessionCommand({
      id: "session.trace",
      title: language.t("command.session.trace"),
      slash: "trace",
      disabled: !params.id,
      onSelect: () => void exportTrace(),
    }),
    sessionCommand({
      id: "session.archive",
      title: language.t("command.session.archive"),
      keybind: "mod+shift+backspace",
      disabled: !params.id,
      onSelect: () => {
        const id = params.id
        if (id) void sessionArchive.archive(id)
      },
    }),
  ]

  const fileCmds = () => {
    const tab = closableTab()
    return [
      fileCommand({
        id: "file.open",
        title: language.t("command.file.open"),
        description: language.t("palette.search.placeholder"),
        keybind: "mod+p",
        slash: "open",
        slashAliases: ["help"],
        onSelect: openFile,
      }),
      tab &&
        fileCommand({
          id: "tab.close",
          title: language.t("command.tab.close"),
          keybind: "mod+w",
          onSelect: closeTab,
        }),
    ].filter((v) => !!v)
  }

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext(),
      onSelect: addSelection,
    }),
  ]

  const viewCmds = () => [
    viewCommand({
      id: "terminal.toggle",
      title: language.t("command.terminal.toggle"),
      keybind: "ctrl+`,mod+j",
      slash: "terminal",
      onSelect: () => {
        if (view().terminal.opened()) {
          terminal.cancelFocus()
          view().terminal.close()
          return
        }
        terminal.requestFocus(terminal.active())
        view().terminal.open()
      },
    }),
    viewCommand({
      id: "review.toggle",
      title: language.t("command.review.toggle"),
      keybind: "mod+shift+r",
      slash: "diff",
      onSelect: () => view().reviewPanel.toggle(),
    }),
    ...(shown()
      ? [
          viewCommand({
            id: "fileTree.toggle",
            title: language.t("command.fileTree.toggle"),
            keybind: "mod+\\",
            onSelect: () => layout.fileTree.toggle(),
          }),
        ]
      : []),
    viewCommand({
      id: "input.focus",
      title: language.t("command.input.focus"),
      keybind: "ctrl+l",
      onSelect: focusInput,
    }),
  ]

  const terminalCmds = () => [
    terminalCommand({
      id: "terminal.close",
      title: language.t("terminal.close"),
      keybind: "mod+w",
      hidden: true,
      when: (event) => event.target instanceof Element && !!event.target.closest('[data-component="terminal"]'),
      onSelect: closeTerminal,
    }),
    terminalCommand({
      id: "terminal.new",
      title: language.t("command.terminal.new"),
      description: language.t("command.terminal.new.description"),
      keybind: "ctrl+alt+t",
      onSelect: openTerminal,
    }),
  ]

  const messageCmds = () => [
    sessionCommand({
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      keybind: "mod+alt+[",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      keybind: "mod+alt+]",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: "mcp",
      slashAliases: ["mcps"],
      onSelect: chooseMcp,
    }),
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: isAutoAcceptActive()
        ? language.t("command.permissions.autoaccept.disable")
        : language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      slash: "always-approve",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
    permissionsCommand({
      id: "session.mode.cycle",
      title: language.t("grok.mode.cycle"),
      keybind: "shift+tab",
      disabled: !params.id,
      onSelect: cycleSessionMode,
    }),
    permissionsCommand({
      id: "permissions.auto",
      title:
        params.id && permission.isReviewing(params.id, sdk().directory)
          ? language.t("grok.auto.disable")
          : language.t("grok.auto.enable"),
      slash: "auto",
      disabled: false,
      onSelect: toggleReview,
    }),
  ]

  const skillCmds = () => [
    serverCommand({
      id: "skills.reload",
      title: language.t("command.skills.reload"),
      description: language.t("command.skills.reload.description"),
      onSelect: () => {
        void sdk()
          .api.skill.reload()
          .then(() => serverSync().reloadCommands(sdk().directory))
          .catch((error: unknown) =>
            showToast({
              variant: "error",
              title: language.t("common.requestFailed"),
              description: error instanceof Error ? error.message : String(error),
            }),
          )
      },
    }),
  ]

  command.register("session", () => [
    ...grok.commands(),
    ...sessionCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...terminalCmds(),
    ...messageCmds(),
    ...mcpCmds(),
    ...permissionsCmds(),
    ...skillCmds(),
  ])
}
