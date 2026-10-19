import { CommandSandboxBrowser } from "@apexo/tui/component/command-sandbox-browser"
import { WorkflowBrowser } from "@apexo/tui/component/workflow-browser"
import { SideQuestionBrowser, sideQuestionImages } from "@apexo/tui/component/side-question-browser"
import { HooksBrowser } from "@apexo/tui/component/hooks-browser"
import { FeedbackBrowser } from "@apexo/tui/component/feedback-browser"
import { SessionGoal } from "@apexo/tui/component/session-goal"
// Footer layout
//
// Renders the footer region as a compact vertical stack:
//   1. Single-line composer or active footer body
//   2. Optional autocomplete/menu panels below the composer
//   3. A statusline-style footer row carrying state, hints, and model info
//
// All state comes from the parent RunFooter through SolidJS signals.
// The view itself is stateless except for derived memos.
/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import { MemoryReview } from "@apexo/tui/component/memory-review"
import { MemoryOperations } from "@apexo/tui/component/memory-operations"
import { MemoryWork } from "@apexo/tui/component/memory-work"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { registerApexoSpinner } from "@apexo/tui/component/register-spinner"
import { createColors, createFrames } from "@apexo/tui/ui/spinner"
import {
  RUN_SUBAGENT_PANEL_ROWS,
  RunCommandMenuBody,
  RunModelSelectBody,
  RunQueuedPromptSelectBody,
  RunSkillSelectBody,
  RunSubagentSelectBody,
  RunVariantSelectBody,
} from "./footer.command"
import { FOOTER_MENU_ROWS, RunFooterMenu } from "./footer.menu"
import { RunFooterSubagentBody } from "./footer.subagent"
import { RunTasksBody } from "./footer.tasks"
import { PluginsBrowser } from "@apexo/tui/component/plugins-browser"
import { McpBrowser } from "@apexo/tui/component/mcp-browser"
import { MemoryBrowser } from "@apexo/tui/component/memory-browser"
import { RunPromptBody, createPromptState } from "./footer.prompt"
import { RunPermissionBody } from "./footer.permission"
import { RunQuestionBody } from "./footer.question"
import { footerWidthPolicy } from "./footer.width"
import {
  APEXO_BASE_MODE,
  formatKeyBindings,
  formatKeySequence,
  useBindings,
  useKeymapSelector,
  type OpenTuiKeymap,
} from "@apexo/tui/keymap"
import type {
  FooterPromptRoute,
  FooterQueuedPrompt,
  FooterState,
  FooterSubagentState,
  FooterView,
  PermissionReply,
  QuestionReject,
  QuestionReply,
  RunAgent,
  RunCommand,
  RunDiffStyle,
  RunInput,
  RunPrompt,
  RunProvider,
  RunResource,
  RunTuiConfig,
} from "./types"
import type { RunTheme } from "./theme"
import { modelInfo } from "./variant.shared"
import { minimalSlash } from "./footer.slash"
import { resolveEffort, sideQuestionText } from "@apexo/sdk/v2/grok-commands"
import { resolveModelArgs } from "@apexo/tui/util/slash-args"

registerApexoSpinner()

const EMPTY_BORDER = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

type RunFooterViewProps = {
  directory: string
  findFiles: (query: string) => Promise<string[]>
  agents: () => RunAgent[]
  resources: () => RunResource[]
  commands: () => RunCommand[] | undefined
  providers: () => RunProvider[] | undefined
  currentModel: () => RunInput["model"]
  variants: () => string[]
  currentVariant: () => string | undefined
  state: () => FooterState
  view?: () => FooterView
  subagent?: () => FooterSubagentState
  queuedPrompts?: () => FooterQueuedPrompt[]
  theme: () => RunTheme
  diffStyle?: RunDiffStyle
  tuiConfig: RunTuiConfig
  backgroundSubagents: boolean
  history?: RunPrompt[]
  agent: string
  onSubmit: (input: RunPrompt) => boolean
  onPermissionReply: (input: PermissionReply) => void | Promise<void>
  onQuestionReply: (input: QuestionReply) => void | Promise<void>
  onQuestionReject: (input: QuestionReject) => void | Promise<void>
  onCycle: () => void
  onInterrupt: () => boolean
  onBackground?: () => void
  taskActions?: import("./types").RunTaskActions
  goalActions?: import("@apexo/tui/component/session-goal").GoalActions
  pluginsActions?: import("@apexo/tui/component/plugins-browser").PluginsBrowserActions
  mcpActions?: import("@apexo/tui/component/mcp-browser").McpBrowserActions
  workflowActions?: import("@apexo/tui/component/workflow-browser").WorkflowActions
  sideQuestionActions?: import("@apexo/tui/component/side-question-browser").SideQuestionActions
  commandSandboxActions?: import("@apexo/tui/component/command-sandbox-browser").CommandSandboxActions
  hooksActions?: import("@apexo/tui/component/hooks-browser").HooksActions
  feedbackActions?: import("@apexo/tui/component/feedback-browser").FeedbackActions
  memoryActions?: import("@apexo/tui/component/memory-browser").MemoryBrowserActions
  onEditorOpen: (input: { value: string }) => Promise<string | undefined>
  onInputClear: () => void
  onExitRequest?: () => boolean
  onRequestExit?: (fn: (() => boolean) | undefined) => void
  onExit: () => void
  onModelSelect: (model: NonNullable<RunInput["model"]>) => void
  onVariantSelect: (variant: string | undefined) => void
  onRows: (rows: number) => void
  onLayout: (input: { route: FooterPromptRoute; autocomplete: boolean; subagentRows: number }) => void
  onStatus: (text: string) => void
  /** `/copy [N] [path]` over the responses this footer has shown. */
  onCopy?: (args: string) => void
  onSubagentSelect?: (sessionID: string | undefined) => void
  onQueuedRemove: (messageID: string) => Promise<boolean>
}

export { TEXTAREA_MIN_ROWS, TEXTAREA_MAX_ROWS } from "./footer.prompt"

export function RunFooterView(props: RunFooterViewProps) {
  const term = useTerminalDimensions()
  const width = createMemo(() => term().width)
  const responsive = createMemo(() => footerWidthPolicy(width()))
  const active = createMemo<FooterView>(() => props.view?.() ?? { type: "prompt" })
  const subagent = createMemo<FooterSubagentState>(() => {
    return (
      props.subagent?.() ?? {
        tabs: [],
        details: {},
        permissions: [],
        questions: [],
      }
    )
  })
  const [route, setRoute] = createSignal<FooterPromptRoute>({ type: "composer" })
  const [subagentMenuRows, setSubagentMenuRows] = createSignal(RUN_SUBAGENT_PANEL_ROWS)
  const queuedPrompts = createMemo(() => props.queuedPrompts?.() ?? [])
  const skills = createMemo(() => (props.commands() ?? []).filter((item) => item.source === "skill"))
  const prompt = createMemo(() => active().type === "prompt" && route().type === "composer")
  const selectingSubagent = createMemo(() => active().type === "prompt" && route().type === "subagent-menu")
  const selectingQueued = createMemo(() => active().type === "prompt" && route().type === "queued-menu")
  const memoryAvailable = createMemo(
    () =>
      !!props.memoryActions &&
      (props.memoryActions.native || !!props.commands()?.some((command) => command.name === "memory")),
  )
  const selectingPlugins = createMemo(() => active().type === "prompt" && route().type === "plugins")
  const selectingMemory = createMemo(() => active().type === "prompt" && route().type === "memory")
  const selectingTasks = createMemo(() => active().type === "prompt" && route().type === "tasks")
  const inspecting = createMemo(() => active().type === "prompt" && route().type === "subagent")
  const commanding = createMemo(() => active().type === "prompt" && route().type === "command")
  const skilling = createMemo(() => active().type === "prompt" && route().type === "skill")
  const modeling = createMemo(() => active().type === "prompt" && route().type === "model")
  const varianting = createMemo(() => active().type === "prompt" && route().type === "variant")
  const panel = createMemo(
    () =>
      active().type === "permission" ||
      active().type === "question" ||
      selectingQueued() ||
      route().type === "goal" ||
      selectingTasks() ||
      selectingMemory() ||
      selectingPlugins() ||
      selectingSubagent() ||
      commanding() ||
      skilling() ||
      modeling() ||
      varianting(),
  )
  const selected = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? current.sessionID : undefined
  })
  const tabs = createMemo(() => subagent().tabs)
  const activeTabs = createMemo(() => tabs().filter((item) => item.status === "running"))
  const selectedTab = createMemo(() => tabs().find((item) => item.sessionID === selected()))
  const selectedIndex = createMemo(() => {
    const sessionID = selected()
    if (!sessionID) {
      return 0
    }

    return tabs().findIndex((item) => item.sessionID === sessionID) + 1
  })
  const foregroundTasks = createMemo(
    () =>
      (props.state().foregroundShells ?? 0) > 0 ||
      (props.backgroundSubagents && activeTabs().some((item) => !item.background)),
  )
  const model = createMemo(() => {
    const current = props.currentModel()
    return current ? modelInfo(props.providers(), current) : { model: props.state().model, provider: undefined }
  })
  const detail = createMemo(() => {
    const current = route()
    return current.type === "subagent" ? subagent().details[current.sessionID] : undefined
  })
  const command = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["command.palette.show"] })
          .get("command.palette.show")?.[0]?.sequence,
        props.tuiConfig,
      ) ?? "",
  )
  const subagentShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.child.first"] })
          .get("session.child.first")?.[0]?.sequence,
        props.tuiConfig,
      ) ?? "",
  )
  const queuedShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.queued_prompts"] })
          .get("session.queued_prompts")?.[0]?.sequence,
        props.tuiConfig,
      ) ?? "",
  )
  const backgroundShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.background"] })
          .get("session.background")?.[0]?.sequence,
        props.tuiConfig,
      ) ?? "",
  )
  const interrupt = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap
          .getCommandBindings({ visibility: "registered", commands: ["session.interrupt"] })
          .get("session.interrupt")?.[0]?.sequence,
        props.tuiConfig,
      ) ?? "",
  )
  const variantCycle = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeyBindings(
        keymap.getCommandBindings({ visibility: "registered", commands: ["variant.cycle"] }).get("variant.cycle"),
        props.tuiConfig,
      ) ?? "",
  )
  const clearShortcut = useKeymapSelector(
    (keymap: OpenTuiKeymap) =>
      formatKeySequence(
        keymap.getCommandBindings({ visibility: "registered", commands: ["prompt.clear"] }).get("prompt.clear")?.[0]
          ?.sequence,
        props.tuiConfig,
      ) ?? "",
  )
  const busy = createMemo(() => props.state().phase === "running")
  const armed = createMemo(() => props.state().interrupt > 0)
  const exiting = createMemo(() => props.state().exit > 0)
  const queue = createMemo(() => props.state().queue)
  const usage = createMemo(() => props.state().usage)
  const interruptLabel = createMemo(() => {
    if (!interrupt()) {
      return
    }

    return interrupt() === "escape" ? "esc" : interrupt()
  })
  const runTheme = createMemo(() => props.theme())
  const theme = createMemo(() => runTheme().footer)
  const block = createMemo(() => runTheme().block)
  const spin = createMemo(() => {
    return {
      frames: createFrames({
        color: theme().highlight,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
      color: createColors({
        color: theme().highlight,
        style: "blocks",
        inactiveFactor: 0.6,
        minAlpha: 0.3,
      }),
    }
  })
  const permission = createMemo<Extract<FooterView, { type: "permission" }> | undefined>(() => {
    const view = active()
    return view.type === "permission" ? view : undefined
  })
  const question = createMemo<Extract<FooterView, { type: "question" }> | undefined>(() => {
    const view = active()
    return view.type === "question" ? view : undefined
  })
  const promptView = createMemo(() => {
    if (active().type !== "prompt") {
      return active().type
    }

    const current = route()
    return current.type === "composer" ? "prompt" : current.type
  })

  const openCommand = () => {
    setRoute({ type: "command" })
    props.onSubagentSelect?.(undefined)
  }

  const openModel = () => {
    setRoute({ type: "model" })
    props.onSubagentSelect?.(undefined)
  }

  const openSkillMenu = () => {
    if (props.commands() && skills().length === 0) {
      return
    }

    setRoute({ type: "skill" })
    props.onSubagentSelect?.(undefined)
  }

  const openVariant = () => {
    setRoute({ type: "variant" })
    props.onSubagentSelect?.(undefined)
  }

  const selectModel = (args: string) => {
    if (!args) return openModel()
    const resolved = resolveModelArgs(args, props.providers() ?? [], props.currentModel()?.providerID)
    if ("error" in resolved) return props.onStatus(resolved.error)
    props.onModelSelect({ providerID: resolved.providerID, modelID: resolved.modelID })
    props.onStatus(
      resolved.effort
        ? `Model set to ${resolved.modelID}; run /effort ${resolved.effort} to set its effort`
        : `Model set to ${resolved.modelID}`,
    )
  }

  const selectEffort = (args: string) => {
    if (!args) return openVariant()
    const variant = resolveEffort(args, props.variants())
    if (!variant)
      return props.onStatus(
        props.variants().length
          ? `Effort "${args}" is not available. Choose one of: ${props.variants().join(", ")}`
          : "The current model has no effort levels",
      )
    props.onVariantSelect(variant)
    props.onStatus(`Effort set to ${variant}`)
  }

  const openSubagentMenu = () => {
    if (tabs().length === 0) {
      return
    }

    setRoute({ type: "subagent-menu" })
    props.onSubagentSelect?.(undefined)
  }

  const openQueuedMenu = () => {
    if (queuedPrompts().length === 0) return
    setRoute({ type: "queued-menu" })
    props.onSubagentSelect?.(undefined)
  }

  const closePanel = () => {
    setRoute({ type: "composer" })
  }

  const openTab = (sessionID: string) => {
    setRoute({ type: "subagent", sessionID })
    props.onSubagentSelect?.(sessionID)
  }

  const closeTab = () => {
    setRoute({ type: "composer" })
    props.onSubagentSelect?.(undefined)
  }

  const cycleTab = (dir: -1 | 1) => {
    if (tabs().length === 0) {
      return
    }

    const routeState = route()
    const current =
      routeState.type === "subagent" ? tabs().findIndex((item) => item.sessionID === routeState.sessionID) : -1
    const index = current === -1 ? 0 : (current + dir + tabs().length) % tabs().length
    const next = tabs()[index]
    if (!next) {
      return
    }

    openTab(next.sessionID)
  }
  const composer = createPromptState({
    directory: props.directory,
    findFiles: props.findFiles,
    agents: props.agents,
    resources: props.resources,
    commands: () => [
      ...(props.commands() ?? []).filter(
        (command) =>
          command.name !== "plugins" &&
          (command.name !== "mcps" || !props.mcpActions) &&
          command.name !== "tasks" &&
          (command.name !== "memory" || !memoryAvailable()),
      ),
      ...(props.workflowActions
        ? ["workflow", "deep-research"].map((name) => ({
            name,
            description: "Manage workflows and research",
            template: "",
            hints: [],
            source: "command" as const,
          }))
        : []),
      ...(props.sideQuestionActions
        ? [
            {
              name: "btw",
              description: "Ask an independent side question",
              template: "",
              hints: [],
              source: "command" as const,
            },
          ]
        : []),
      ...(props.commandSandboxActions
        ? [
            {
              name: "sandbox",
              description: "Inspect native command sandbox",
              template: "",
              hints: [],
              source: "command" as const,
            },
          ]
        : []),
      ...(props.hooksActions
        ? [
            {
              name: "hooks",
              description: "Inspect and reload session hooks",
              template: "",
              hints: [],
              source: "command" as const,
            },
          ]
        : []),
      ...(props.feedbackActions
        ? [
            {
              name: "feedback",
              description: "Review local feedback drafts",
              template: "",
              hints: [],
              source: "command" as const,
            },
          ]
        : []),
      ...(props.goalActions
        ? [
            {
              name: "goal",
              description: "Create and manage a goal",
              template: "",
              hints: [],
              source: "command" as const,
            },
          ]
        : []),
      ...(props.mcpActions
        ? [{ name: "mcps", description: "Manage MCP connections", template: "", hints: [], source: "command" as const }]
        : []),
      ...(props.pluginsActions
        ? [
            {
              name: "plugins",
              description: "Browse and manage Plugins",
              template: "",
              hints: [],
              source: "command" as const,
            },
          ]
        : []),
      ...(memoryAvailable()
        ? [{ name: "memory", description: "Browse saved memory", template: "", hints: [], source: "command" as const }]
        : []),
      ...(props.memoryActions?.native
        ? ["remember", "flush", "dream"].map((name) => ({
            name,
            description:
              name === "remember"
                ? "Manual note rewriting is unavailable; view Memory"
                : "Review native Memory operations",
            template: "",
            hints: [],
            source: "command" as const,
          }))
        : []),
      { name: "tasks", description: "Manage session tasks", template: "", hints: [], source: "command" as const },
    ],
    tuiConfig: props.tuiConfig,
    state: props.state,
    view: promptView,
    prompt,
    width,
    theme,
    history: props.history,
    onSubmit: (input) => {
      if (
        props.workflowActions &&
        input.mode !== "shell" &&
        /^\/(?:workflow|deep-research)(?:\s|$)/u.test(input.text.trim())
      ) {
        if (input.parts.some((part) => part.type === "file")) return false
        setRoute({ type: "workflow", command: input.text.trim() })
        return true
      }
      // Grok Build: `/btw` anywhere in the message asks the whole message minus the token as a side question.
      const question =
        !props.sideQuestionActions || input.mode === "shell"
          ? undefined
          : input.text.trim() === "/btw"
            ? ""
            : sideQuestionText(input.text)
      if (question !== undefined) {
        setRoute({ type: "btw", question, images: sideQuestionImages(input.parts) })
        return true
      }
      if (
        props.commandSandboxActions &&
        input.mode !== "shell" &&
        (input.text.trim() === "/sandbox" || input.command?.name === "sandbox")
      ) {
        setRoute({ type: "command-sandbox" })
        return true
      }
      if (
        props.hooksActions &&
        input.mode !== "shell" &&
        (input.text.trim() === "/hooks" || input.command?.name === "hooks")
      ) {
        setRoute({ type: "hooks" })
        return true
      }
      if (
        props.feedbackActions &&
        input.mode !== "shell" &&
        (input.text.trim() === "/feedback" || input.command?.name === "feedback")
      ) {
        setRoute({ type: "feedback" })
        return true
      }
      if (
        props.goalActions &&
        input.mode !== "shell" &&
        (/^\/goal(?:\s|$)/u.test(input.text.trim()) || input.command?.name === "goal")
      ) {
        setRoute({ type: "goal", objective: input.text.trim().replace(/^\/goal\s*/u, "") })
        return true
      }
      if (
        props.memoryActions?.native &&
        input.mode !== "shell" &&
        /^\/(?:memory|remember|flush|dream)(?:\s|$)/u.test(input.text.trim())
      ) {
        setRoute({
          type:
            props.memoryActions.operations && ["/flush", "/dream"].includes(input.text.trim())
              ? "memory-work"
              : "memory",
        })
        return true
      }
      if (memoryAvailable() && props.memoryActions?.work && input.mode !== "shell") {
        const command = input.command?.name ?? input.text.trim().replace(/^\//, "")
        if (command === "flush" || command === "dream") {
          setRoute({ type: "memory-work", kind: command })
          return true
        }
      }
      if (
        memoryAvailable() &&
        props.memoryActions?.review &&
        input.mode !== "shell" &&
        (/^\/remember(?:\s|$)/u.test(input.text.trim()) || input.command?.name === "remember")
      ) {
        setRoute({ type: "remember", content: input.text.trim().replace(/^\/remember\s*/u, "") })
        return true
      }
      if (
        props.mcpActions &&
        input.mode !== "shell" &&
        (input.text.trim() === "/mcps" || input.command?.name === "mcps")
      ) {
        setRoute({ type: "mcp" })
        return true
      }
      if (
        props.pluginsActions &&
        input.mode !== "shell" &&
        (input.text.trim() === "/plugins" || input.command?.name === "plugins")
      ) {
        setRoute({ type: "plugins" })
        return true
      }
      if (
        memoryAvailable() &&
        input.mode !== "shell" &&
        (input.text.trim() === "/memory" || input.command?.name === "memory")
      ) {
        setRoute({ type: "memory" })
        return true
      }
      if (input.mode !== "shell" && (input.text.trim() === "/tasks" || input.command?.name === "tasks")) {
        setRoute({ type: "tasks" })
        return true
      }
      const slash = input.mode === "shell" || input.command ? undefined : minimalSlash(input.text)
      if (!slash) return props.onSubmit(input)
      if (slash.type === "new") return props.onSubmit({ ...input, text: "/new" })
      if (slash.type === "notice") props.onStatus(slash.text)
      if (slash.type === "copy") props.onCopy?.(slash.args)
      if (slash.type === "skills") openSkillMenu()
      if (slash.type === "commands") openCommand()
      if (slash.type === "model") selectModel(slash.args)
      if (slash.type === "effort") selectEffort(slash.args)
      return true
    },
    onCycle: props.onCycle,
    onInterrupt: props.onInterrupt,
    onEditorOpen: props.onEditorOpen,
    onInputClear: props.onInputClear,
    onExitRequest: props.onExitRequest,
    onExit: props.onExit,
    onSkillMenu: openSkillMenu,
    onRows: props.onRows,
    onStatus: props.onStatus,
  })
  const shell = createMemo(() => prompt() && composer.shell())
  const menu = createMemo(() => prompt() && composer.visible())
  const stateStatus = createMemo(() => props.state().status.trim())
  const modeLabel = createMemo(() => {
    if (exiting()) {
      return "EXIT"
    }

    return shell() ? "SHELL" : "BUILD"
  })
  const modeColor = createMemo(() => {
    if (exiting()) {
      return theme().error
    }

    if (shell()) {
      return theme().warning
    }

    return theme().highlight
  })
  const statusText = createMemo(() => {
    if (exiting()) {
      return `Press ${clearShortcut() || "ctrl+c"} again to exit`
    }

    if (busy()) {
      return armed() ? "again to interrupt" : "interrupt"
    }

    if (stateStatus().length > 0) {
      return stateStatus()
    }

    return shell() ? "Shell mode" : ""
  })
  const activityMeta = createMemo(() => {
    if (!responsive().statusline.showActivityMeta || usage().length === 0) {
      return ""
    }

    return usage()
  })
  const modelStatus = createMemo(() => {
    const current = props.currentModel()
    if (!prompt() || shell() || !current) {
      return
    }

    return {
      model: model().model,
      variant: props.currentVariant(),
      provider: undefined,
      // Prefer without provider, but keep it on the shared width policy if we add it back.
    }
  })
  const statusColor = createMemo(() => {
    if (exiting()) {
      return theme().error
    }

    if (armed()) {
      return theme().highlight
    }

    if (busy() || stateStatus().length > 0) {
      return theme().text
    }

    return theme().muted
  })
  const statuslineBackground = createMemo(() => theme().status)
  const hasActivityMeta = createMemo(() => activityMeta().length > 0)
  const hasModelStatus = createMemo(() => responsive().statusline.showModel && Boolean(modelStatus()))
  const contextHints = createMemo(() => {
    if (!prompt() || shell() || !responsive().statusline.showContextHints) {
      return []
    }

    const items: Array<{ kind: string; key: string; label: string }> = []
    const running = props.state().tasks?.filter((task) => task.status === "running").length ?? 0
    if (running > 0 || props.state().taskError || props.state().taskIssues?.length)
      items.push({
        kind: "tasks",
        key: "/tasks",
        label:
          props.state().taskError || props.state().taskIssues?.length
            ? "unavailable"
            : `${running} running${props.state().taskNative ? " (recent)" : ""}`,
      })
    if (foregroundTasks() && backgroundShortcut()) {
      items.push({ kind: "background", key: backgroundShortcut(), label: "background" })
    }
    if (queuedPrompts().length > 0 && queuedShortcut()) {
      items.push({ kind: "queued", key: queuedShortcut(), label: `${queue()} queued` })
    }
    if (activeTabs().length > 0 && subagentShortcut()) {
      items.push({ kind: "subagents", key: subagentShortcut(), label: "subagents" })
    }

    const limit = responsive().statusline.contextHintLimit
    return limit === undefined ? items : items.slice(0, limit)
  })
  const hasContextHints = createMemo(() => contextHints().length > 0)
  const commandHint = createMemo(() => {
    if (!prompt() || !responsive().statusline.showCommandHint) {
      return
    }

    if (shell()) {
      return { key: "esc", label: "normal" }
    }

    if (command()) {
      return { key: command(), label: "cmd" }
    }
  })
  const sectionSeparator = () => <span style={{ fg: theme().muted }}>· </span>

  createEffect(() => {
    props.onRequestExit?.(composer.requestExit)
  })

  onCleanup(() => {
    props.onRequestExit?.(undefined)
  })

  useBindings(() => ({
    mode: APEXO_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && !composer.visible(),
    commands: [
      {
        name: "command.palette.show",
        title: "Open command palette",
        category: "Prompt",
        run: openCommand,
      },
      {
        name: "variant.cycle",
        title: "Cycle model variant",
        category: "Model",
        run: props.onCycle,
      },
    ],
    bindings: [
      ...props.tuiConfig.keybinds.get("command.palette.show"),
      ...props.tuiConfig.keybinds.get("variant.cycle"),
    ],
  }))

  useBindings(() => ({
    mode: APEXO_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && foregroundTasks(),
    priority: 1,
    commands: [
      {
        name: "session.background",
        title: "Background running tasks",
        category: "Session",
        run: () => props.onBackground?.(),
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.background"),
  }))

  useBindings(() => ({
    mode: APEXO_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && tabs().length > 0,
    commands: [
      {
        name: "session.child.first",
        title: "View subagents",
        category: "Session",
        run: openSubagentMenu,
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.child.first"),
  }))

  useBindings(() => ({
    mode: APEXO_BASE_MODE,
    enabled: active().type === "prompt" && route().type === "composer" && queuedPrompts().length > 0,
    commands: [
      {
        name: "session.queued_prompts",
        title: "Manage queued prompts",
        category: "Session",
        run: openQueuedMenu,
      },
    ],
    bindings: props.tuiConfig.keybinds.get("session.queued_prompts"),
  }))

  createEffect(() => {
    const current = route()
    if (current.type !== "subagent") {
      return
    }

    if (tabs().some((item) => item.sessionID === current.sessionID)) {
      return
    }

    closeTab()
  })

  createEffect(() => {
    if (route().type !== "subagent-menu") {
      return
    }

    if (tabs().length > 0) {
      return
    }

    closePanel()
  })

  createEffect(() => {
    if (route().type !== "queued-menu" || queuedPrompts().length > 0) return
    closePanel()
  })

  createEffect(() => {
    if (active().type === "prompt") {
      return
    }

    const current = route()
    if (
      current.type !== "command" &&
      current.type !== "skill" &&
      current.type !== "model" &&
      current.type !== "variant" &&
      current.type !== "queued-menu" &&
      current.type !== "tasks" &&
      current.type !== "memory" &&
      current.type !== "remember" &&
      current.type !== "workflow" &&
      current.type !== "btw" &&
      current.type !== "feedback" &&
      current.type !== "hooks" &&
      current.type !== "command-sandbox" &&
      current.type !== "goal" &&
      current.type !== "memory-work" &&
      current.type !== "mcp" &&
      current.type !== "plugins" &&
      current.type !== "subagent-menu"
    ) {
      return
    }

    closePanel()
  })

  createEffect(() => {
    props.onLayout({
      route: route(),
      autocomplete: menu(),
      subagentRows: subagentMenuRows(),
    })
  })

  return (
    <box
      width="100%"
      height="100%"
      border={false}
      backgroundColor="transparent"
      flexDirection="column"
      gap={0}
      padding={0}
    >
      <Show when={panel() || inspecting()}>
        <box width="100%" height={1} flexShrink={0} backgroundColor="transparent" />
      </Show>

      <Show
        when={inspecting()}
        fallback={
          <box width="100%" flexDirection="column" gap={0}>
            <For each={[promptView()]}>
              {() => (
                <box
                  width="100%"
                  flexShrink={0}
                  border={panel() || prompt() ? false : ["left"]}
                  borderColor={panel() || prompt() ? undefined : theme().highlight}
                  customBorderChars={
                    panel() || prompt()
                      ? undefined
                      : {
                          ...EMPTY_BORDER,
                          vertical: "█",
                        }
                  }
                >
                  <box
                    width="100%"
                    flexGrow={1}
                    paddingLeft={0}
                    paddingRight={0}
                    paddingTop={0}
                    flexDirection="column"
                    backgroundColor={panel() || prompt() ? "transparent" : theme().surface}
                    gap={0}
                  >
                    <box width="100%" flexGrow={1} flexShrink={1} flexDirection="column">
                      <Switch>
                        <Match when={active().type === "prompt" && route().type === "composer"}>
                          <RunPromptBody
                            theme={theme}
                            background={() => runTheme().background}
                            placeholder={composer.placeholder}
                            onSubmit={composer.onSubmit}
                            onKeyDown={composer.onKeyDown}
                            onContentChange={composer.onContentChange}
                            bind={composer.bind}
                          />
                        </Match>
                        <Match when={route().type === "goal" && props.goalActions}>
                          <SessionGoal
                            actions={props.goalActions!}
                            objective={(() => {
                              const current = route()
                              return current.type === "goal" ? current.objective : undefined
                            })()}
                            theme={theme}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={route().type === "mcp" && props.mcpActions}>
                          <McpBrowser
                            actions={props.mcpActions!}
                            onAttach={composer.attachMcp}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={selectingPlugins() && props.pluginsActions}>
                          <PluginsBrowser
                            actions={props.pluginsActions!}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={route().type === "workflow" && props.workflowActions}>
                          <WorkflowBrowser
                            actions={props.workflowActions!}
                            command={(() => {
                              const current = route()
                              return current.type === "workflow" ? current.command : ""
                            })()}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={route().type === "btw" && props.sideQuestionActions}>
                          <SideQuestionBrowser
                            actions={props.sideQuestionActions!}
                            images={(() => {
                              const current = route()
                              return current.type === "btw" ? current.images : undefined
                            })()}
                            question={(() => {
                              const current = route()
                              return current.type === "btw" ? current.question : ""
                            })()}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={route().type === "command-sandbox" && props.commandSandboxActions}>
                          <CommandSandboxBrowser
                            actions={props.commandSandboxActions!}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={route().type === "hooks" && props.hooksActions}>
                          <HooksBrowser
                            actions={props.hooksActions!}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={route().type === "feedback" && props.feedbackActions}>
                          <FeedbackBrowser
                            actions={props.feedbackActions!}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={route().type === "remember" && props.memoryActions?.review}>
                          <MemoryReview
                            actions={props.memoryActions!.review!}
                            content={(() => {
                              const current = route()
                              return current.type === "remember" ? current.content : ""
                            })()}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={route().type === "memory-work" && props.memoryActions?.operations}>
                          <MemoryOperations
                            actions={props.memoryActions!.operations!}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "memory" })}
                          />
                        </Match>
                        <Match when={route().type === "memory-work" && props.memoryActions?.work}>
                          <MemoryWork
                            actions={props.memoryActions!.work!}
                            kind={(() => {
                              const current = route()
                              return current.type === "memory-work" ? current.kind : undefined
                            })()}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                          />
                        </Match>
                        <Match when={selectingMemory() && props.memoryActions}>
                          <MemoryBrowser
                            actions={props.memoryActions!}
                            theme={theme}
                            height={19}
                            onClose={() => setRoute({ type: "composer" })}
                            onWork={
                              props.memoryActions?.work || props.memoryActions?.operations
                                ? () => setRoute({ type: "memory-work" })
                                : undefined
                            }
                          />
                        </Match>
                        <Match when={selectingTasks()}>
                          <RunTasksBody
                            theme={theme}
                            tasks={() => props.state().tasks ?? []}
                            native={() => props.state().taskNative === true}
                            issues={() => props.state().taskIssues ?? []}
                            error={() => props.state().taskError}
                            actions={props.taskActions}
                            onClose={closePanel}
                          />
                        </Match>
                        <Match when={selectingSubagent()}>
                          <RunSubagentSelectBody
                            theme={theme}
                            tabs={tabs}
                            current={selected}
                            onClose={closePanel}
                            onSelect={openTab}
                            onRows={setSubagentMenuRows}
                          />
                        </Match>
                        <Match when={selectingQueued()}>
                          <RunQueuedPromptSelectBody
                            theme={theme}
                            prompts={queuedPrompts}
                            onClose={closePanel}
                            onDelete={(item) => void props.onQueuedRemove(item.messageID)}
                            onEdit={async (item) => {
                              if (!(await props.onQueuedRemove(item.messageID))) return
                              closePanel()
                              queueMicrotask(() => composer.replacePrompt(item.prompt))
                            }}
                            onRows={setSubagentMenuRows}
                          />
                        </Match>
                        <Match when={commanding()}>
                          <RunCommandMenuBody
                            theme={theme}
                            commands={props.commands}
                            subagents={tabs}
                            queued={queuedPrompts}
                            variants={props.variants}
                            variantCycle={variantCycle()}
                            onClose={closePanel}
                            onModel={openModel}
                            onEditor={() => {
                              closePanel()
                              void composer.openEditor()
                            }}
                            onSkill={openSkillMenu}
                            onSubagent={openSubagentMenu}
                            onQueued={openQueuedMenu}
                            onTasks={() => setRoute({ type: "tasks" })}
                            onGoal={props.goalActions ? () => setRoute({ type: "goal" }) : undefined}
                            onPlugins={props.pluginsActions ? () => setRoute({ type: "plugins" }) : undefined}
                            onMcp={props.mcpActions ? () => setRoute({ type: "mcp" }) : undefined}
                            onMemory={memoryAvailable() ? () => setRoute({ type: "memory" }) : undefined}
                            onVariant={openVariant}
                            onVariantCycle={() => {
                              props.onCycle()
                              closePanel()
                            }}
                            onCommand={(name) => {
                              composer.submitText(`/${name}`)
                              closePanel()
                            }}
                            onNew={() => {
                              composer.submitText("/new")
                              closePanel()
                            }}
                            onExit={props.onExit}
                          />
                        </Match>
                        <Match when={skilling()}>
                          <RunSkillSelectBody
                            theme={theme}
                            commands={props.commands}
                            onClose={closePanel}
                            onSelect={(name) => {
                              composer.replacePrompt({
                                text: `/${name} `,
                                parts: [],
                                command: {
                                  name,
                                  arguments: "",
                                },
                              })
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={modeling()}>
                          <RunModelSelectBody
                            theme={theme}
                            providers={props.providers}
                            current={props.currentModel}
                            onClose={closePanel}
                            onSelect={(model) => {
                              props.onModelSelect(model)
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={varianting()}>
                          <RunVariantSelectBody
                            theme={theme}
                            variants={props.variants}
                            current={props.currentVariant}
                            onClose={closePanel}
                            onSelect={(variant) => {
                              props.onVariantSelect(variant)
                              closePanel()
                            }}
                          />
                        </Match>
                        <Match when={active().type === "permission"}>
                          <RunPermissionBody
                            request={permission()!.request}
                            theme={theme()}
                            block={block()}
                            diffStyle={props.diffStyle}
                            onReply={props.onPermissionReply}
                          />
                        </Match>
                        <Match when={active().type === "question"}>
                          <RunQuestionBody
                            request={question()!.request}
                            theme={theme()}
                            onReply={props.onQuestionReply}
                            onReject={props.onQuestionReject}
                          />
                        </Match>
                      </Switch>
                    </box>
                  </box>
                </box>
              )}
            </For>

            <Show when={!panel() && menu()}>
              <RunFooterMenu
                theme={theme}
                items={composer.options}
                selected={composer.selected}
                offset={composer.offset}
                rows={composer.rows}
                limit={FOOTER_MENU_ROWS}
                border={false}
                paddingLeft={0}
              />
            </Show>

            <Show when={!panel() && !menu()}>
              <box
                width="100%"
                height={1}
                flexDirection="row"
                gap={0}
                flexShrink={0}
                backgroundColor={statuslineBackground()}
              >
                <box paddingLeft={1} paddingRight={1} backgroundColor={theme().statusAccent} flexShrink={0}>
                  <text wrapMode="none" truncate>
                    <span style={{ fg: modeColor(), bold: true }}>{modeLabel()}</span>
                  </text>
                </box>

                <box
                  flexDirection="row"
                  gap={1}
                  flexGrow={1}
                  flexShrink={1}
                  minWidth={12}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor="transparent"
                >
                  <Show when={busy() && !exiting()}>
                    <box flexShrink={0}>
                      <spinner color={spin().color} frames={spin().frames} interval={40} />
                    </box>
                  </Show>

                  <text fg={statusColor()} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                    <Show when={busy() && !exiting()} fallback={statusText()}>
                      <Show when={interruptLabel()}>
                        {(label) => <span style={{ fg: armed() ? statusColor() : theme().muted }}>{label()} </span>}
                      </Show>
                      {statusText()}
                    </Show>
                  </text>
                </box>

                <Show when={activityMeta().length > 0}>
                  <box paddingRight={1} backgroundColor="transparent" flexShrink={1}>
                    <text fg={theme().muted} wrapMode="none" truncate>
                      {activityMeta()}
                    </text>
                  </box>
                </Show>

                <Show when={responsive().statusline.showModel && modelStatus()}>
                  {(info) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0}>
                      <text fg={theme().text} wrapMode="none">
                        {info().model}
                        <Show when={info().provider}>
                          {(provider) => <span style={{ fg: theme().muted }}> {provider()}</span>}
                        </Show>
                        <Show when={info().variant}>
                          {(variant) => (
                            <>
                              <span style={{ fg: theme().warning, bold: true }}> {variant()}</span>
                            </>
                          )}
                        </Show>
                      </text>
                    </box>
                  )}
                </Show>

                <For each={contextHints()}>
                  {(hint, index) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0} maxWidth={24}>
                      <text fg={theme().text} wrapMode="none" truncate>
                        <Show when={index() > 0 || ((hasActivityMeta() || hasModelStatus()) && index() === 0)}>
                          {sectionSeparator()}
                        </Show>
                        <span style={{ fg: theme().text }}>{hint.key}</span>{" "}
                        <span style={{ fg: theme().muted }}>{hint.label}</span>
                      </text>
                    </box>
                  )}
                </For>

                <Show when={commandHint()}>
                  {(hint) => (
                    <box paddingRight={1} backgroundColor="transparent" flexShrink={0} maxWidth={18}>
                      <text fg={theme().text} wrapMode="none" truncate>
                        <Show when={hasActivityMeta() || hasModelStatus() || hasContextHints()}>
                          {sectionSeparator()}
                        </Show>
                        <span style={{ fg: theme().text }}>{hint().key}</span>{" "}
                        <span style={{ fg: theme().muted }}>{hint().label}</span>
                      </text>
                    </box>
                  )}
                </Show>
              </box>
            </Show>
          </box>
        }
      >
        <box
          width="100%"
          flexGrow={1}
          flexShrink={1}
          border={["left"]}
          borderColor={theme().highlight}
          customBorderChars={{
            ...EMPTY_BORDER,
            vertical: "┃",
          }}
        >
          <RunFooterSubagentBody
            active={inspecting}
            theme={runTheme}
            tab={selectedTab}
            index={selectedIndex}
            total={() => tabs().length}
            detail={detail}
            width={width}
            diffStyle={props.diffStyle}
            onCycle={cycleTab}
            onClose={closeTab}
          />
        </box>
      </Show>
    </box>
  )
}
