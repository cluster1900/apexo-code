import {
  contextUsage,
  contextWindowLabel,
  parseContextWindow,
  docsGuides,
  docsURL,
  parseSlashInput,
  promptHistory,
  releaseNotesURL,
  resolveDocs,
  resolveEffort,
  tutorialTopics,
} from "@apexo/sdk/v2/grok-commands"
import { InstallationVersion } from "@apexo/core/installation/version"
import { openUrl } from "@apexo/core/open"
import { useDialog } from "../ui/dialog"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useRoute } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useKV } from "../context/kv"
import { useVimMode } from "../context/vim-mode"
import { useCompactMode } from "../context/compact-mode"
import { contextWindowChoice, setContextWindowChoice } from "../context/context-window"
import { DialogVariant } from "./dialog-variant"
import { DialogThemeList } from "./dialog-theme-list"
import { DialogModel } from "./dialog-model"
import { DialogAgent } from "./dialog-agent"
import { DialogProvider as DialogProviderList } from "./dialog-provider"

/**
 * Grok Build slash commands (docs/user-guide/04-slash-commands.md) that had no Apexo counterpart.
 * Desktop implements the same names in packages/app/src/components/grok-commands.tsx.
 */
export function useGrokCommands() {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const route = useRoute()
  const promptRef = usePromptRef()
  const kv = useKV()
  const [multiline, setMultiline] = kv.signal<boolean>("multiline", false)
  const vimMode = useVimMode()
  const compactMode = useCompactMode()
  const vim = vimMode.enabled
  const sessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  const alert = (title: string, message: string) =>
    dialog.replace(() => <DialogAlert title={title} message={message} />)
  const requireSession = () => {
    const id = sessionID()
    if (!id) toast.show({ variant: "info", message: "Open a session first." })
    return id
  }
  const open = (url: string) => {
    openUrl(url).catch(() => toast.show({ variant: "info", message: url }))
    dialog.clear()
  }

  const effort = (level = "") => {
    const variants = local.model.variant.list()
    if (!level) {
      if (!variants.length) return toast.show({ variant: "info", message: "The current model has no effort levels." })
      return dialog.replace(() => <DialogVariant />)
    }
    const variant = resolveEffort(level, variants)
    if (!variant)
      return toast.show({
        variant: "warning",
        message: variants.length
          ? `Effort "${level}" is not available. Choose one of: ${variants.join(", ")}`
          : "The current model has no effort levels.",
      })
    local.model.variant.set(variant)
    toast.show({ variant: "info", message: `Effort set to ${variant}` })
  }

  const docs = (args = "") => {
    const target = resolveDocs(args)
    if (target) return open(target.url)
    if (args.trim() && args.trim() !== "how-to")
      return toast.show({ variant: "warning", message: `No guide matches "${args.trim()}"` })
    dialog.replace(() => (
      <DialogSelect
        title="How-to Guides"
        options={[
          ...docsGuides.map((guide) => ({ title: guide.title, value: guide.url })),
          { title: "Online docs", value: docsURL },
        ]}
        onSelect={(option) => open(option.value)}
      />
    ))
  }

  const plan = (description = "") => {
    if (!sync.data.agent.some((agent) => agent.name === "plan"))
      return toast.show({ variant: "warning", message: "No plan agent is configured." })
    local.agent.set("plan")
    if (!description)
      return toast.show({ variant: "info", message: "Plan mode: edits are disabled until the plan is approved." })
    return description
  }

  const viewPlan = async () => {
    const id = requireSession()
    if (!id) return
    const session = sync.session.get(id)
    if (!session) return
    const file = `.apexo/plans/${session.time.created}-${session.slug}.md`
    const result = await sdk.client.file.read({ path: file }).catch(() => undefined)
    const content = result?.data?.type === "text" ? result.data.content : ""
    if (!content.trim()) return alert("Plan", "No saved plan for this session yet. Run /plan to create one.")
    alert(`Plan · ${file}`, content.length > 20_000 ? content.slice(0, 20_000) + "\n…" : content)
  }

  const context = () => {
    const id = requireSession()
    if (!id) return
    const messages = (sync.data.message[id] ?? []) as Array<{
      role: string
      providerID?: string
      modelID?: string
      tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    }>
    const last = messages.findLast((message) => message.role === "assistant" && message.modelID)
    const model = last
      ? sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID!]
      : undefined
    const usage = contextUsage(messages, model?.limit.context ?? 0)
    if (!usage) return alert("Context", "No model response yet in this session.")
    const pct = (value: number) => (usage.limit ? ` (${Math.round((value / usage.limit) * 100)}%)` : "")
    alert(
      "Context",
      [
        `Window: ${usage.limit ? usage.limit.toLocaleString() : "unknown"} tokens`,
        `Used: ${usage.used.toLocaleString()}${pct(usage.used)}`,
        `  Input (system prompt, tools, messages): ${usage.input.toLocaleString()}`,
        `  Cached input: ${usage.cache.toLocaleString()}`,
        `  Output: ${usage.output.toLocaleString()}`,
        `  Reasoning: ${usage.reasoning.toLocaleString()}`,
        usage.limit
          ? `Free: ${Math.max(0, usage.limit - usage.used).toLocaleString()}${pct(Math.max(0, usage.limit - usage.used))}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  const history = () => {
    const id = requireSession()
    if (!id) return
    const prompts = (sync.data.message[id] ?? [])
      .filter((message) => message.role === "user")
      .map((message) =>
        (sync.data.part[message.id] ?? [])
          .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
          .join("\n"),
      )
    const items = promptHistory(prompts)
    if (!items.length) return toast.show({ variant: "info", message: "No prompts in this session yet." })
    dialog.replace(() => (
      <DialogSelect
        title="Prompt history"
        options={items.map((text) => ({ title: text.split("\n")[0]!.slice(0, 120), value: text }))}
        onSelect={(option) => {
          const current = promptRef.current
          current?.set({ ...current.current, input: option.value, parts: [] })
          dialog.clear()
        }}
      />
    ))
  }

  const remove = () => {
    const id = requireSession()
    if (!id) return
    dialog.replace(() => (
      <DialogConfirm
        title="Delete session"
        message="Delete this session's history? Running work in it is stopped first."
        label="Delete"
        onConfirm={async () => {
          await sdk.client.session.abort({ sessionID: id }).catch(() => undefined)
          const result = await sdk.client.session.delete({ sessionID: id })
          if (result.error) return toast.show({ variant: "error", message: "Failed to delete session" })
          route.navigate({ type: "home" })
        }}
      />
    ))
  }

  const tutorial = () =>
    dialog.replace(() => (
      <DialogSelect
        title="Tutorial"
        options={tutorialTopics.map((topic, index) => ({ title: `${index + 1}. ${topic.title}`, value: index }))}
        onSelect={(option) => alert(tutorialTopics[option.value]!.title, tutorialTopics[option.value]!.body)}
      />
    ))

  const doctor = () => {
    const env = process.env
    const truecolor = env.COLORTERM === "truecolor" || env.COLORTERM === "24bit"
    const checks = [
      [
        `Terminal: ${env.TERM_PROGRAM ?? env.TERM ?? "unknown"}`,
        env.TERM ? "" : "TERM is not set; colors and keys may be wrong.",
      ],
      [
        `Color: ${truecolor ? "truecolor" : (env.COLORTERM ?? "256 or fewer")}`,
        truecolor ? "" : "Set COLORTERM=truecolor if your terminal supports it.",
      ],
      [
        `Editor: ${env.VISUAL ?? env.EDITOR ?? "not set"}`,
        env.VISUAL || env.EDITOR ? "" : "Set $VISUAL or $EDITOR for /editor.",
      ],
      [
        `Multiplexer: ${env.TMUX ? "tmux" : env.STY ? "screen" : "none"}`,
        env.TMUX ? "In tmux, enable `set -g allow-passthrough on` for clipboard (OSC 52) and notifications." : "",
      ],
      [
        `SSH: ${env.SSH_CONNECTION ? "yes" : "no"}`,
        env.SSH_CONNECTION ? "The local clipboard may be unreachable; /copy also writes a backup file." : "",
      ],
      [`Server: ${sync.status}`, sync.status === "complete" ? "" : "The server connection is not ready."],
    ]
    alert("Doctor", checks.map(([found, fix]) => (fix ? `✗ ${found}\n    ${fix}` : `✓ ${found}`)).join("\n"))
  }

  const settings = () =>
    dialog.replace(() => (
      <DialogSelect
        title="Settings"
        options={[
          { title: "Theme", value: "theme" },
          { title: "Model", value: "model" },
          { title: "Effort", value: "effort" },
          { title: "Agent", value: "agent" },
          { title: "Providers", value: "providers" },
          {
            title:
              local.permission.mode === "auto"
                ? "Permissions: always approve (on)"
                : local.permission.mode === "review"
                  ? "Permissions: auto-review (on)"
                  : "Permissions: ask (always approve off)",
            value: "permission",
          },
        ]}
        onSelect={(option) => {
          if (option.value === "theme") return dialog.replace(() => <DialogThemeList />)
          if (option.value === "model") return dialog.replace(() => <DialogModel />)
          if (option.value === "effort") return effort()
          if (option.value === "agent") return dialog.replace(() => <DialogAgent />)
          if (option.value === "providers") return dialog.replace(() => <DialogProviderList />)
          local.permission.toggle()
          dialog.clear()
        }}
      />
    ))

  const logout = () => {
    const providers = sync.data.provider
    if (!providers.length) return toast.show({ variant: "info", message: "No connected providers." })
    dialog.replace(() => (
      <DialogSelect
        title="Log out of provider"
        options={providers.map((provider) => ({ title: provider.name, value: provider.id }))}
        onSelect={async (option) => {
          const result = await sdk.client.auth.remove({ providerID: option.value })
          dialog.clear()
          if (result.error) return toast.show({ variant: "error", message: "Failed to remove credentials" })
          await sdk.client.instance.dispose().catch(() => undefined)
          toast.show({ variant: "info", message: `Logged out of ${option.title}` })
        }}
      />
    ))
  }

  // /context-window: listed only when the current model supports more than one size.
  const windowOptions = () => {
    const current = local.model.current()
    if (!current) return []
    return (
      sync.data.provider.find((item) => item.id === current.providerID)?.models[current.modelID]?.limit
        .context_options ?? []
    )
  }
  const setWindow = (size: number) => {
    const id = requireSession()
    const current = local.model.current()
    if (!id || !current) return
    setContextWindowChoice(id, size)
    const usage = contextUsage((sync.data.message[id] ?? []) as Parameters<typeof contextUsage>[0], size)
    if (usage && usage.used > size) {
      toast.show({ variant: "info", message: `Context window set to ${contextWindowLabel(size)}; compacting to fit` })
      void sdk.client.session.summarize({ sessionID: id, providerID: current.providerID, modelID: current.modelID })
      return
    }
    toast.show({ variant: "info", message: `Context window set to ${contextWindowLabel(size)}` })
  }
  const contextWindow = (arg?: string) => {
    const options = windowOptions()
    if (options.length < 2)
      return toast.show({ variant: "info", message: "The current model supports a single context window." })
    if (arg) {
      const parsed = parseContextWindow(arg, options)
      if ("error" in parsed) return toast.show({ variant: "error", message: parsed.error })
      return setWindow(parsed.size)
    }
    const chosen = contextWindowChoice(sessionID())
    dialog.replace(() => (
      <DialogSelect
        title="Context window"
        options={options.map((size) => ({
          title: contextWindowLabel(size),
          value: size,
          description: size === chosen ? "current" : `${size.toLocaleString()} tokens`,
        }))}
        onSelect={(option) => {
          dialog.clear()
          setWindow(option.value)
        }}
      />
    ))
  }

  const commands = [
    {
      name: "grok.context",
      title: "Show context window usage",
      category: "Session",
      slashName: "context",
      run: context,
    },
    { name: "grok.delete", title: "Delete session", category: "Session", slashName: "delete", run: remove },
    { name: "grok.history", title: "Search prompt history", category: "Session", slashName: "history", run: history },
    { name: "grok.plan", title: "Enter plan mode", category: "Agent", slashName: "plan", run: () => void plan() },
    {
      name: "grok.view_plan",
      title: "View saved plan",
      category: "Agent",
      slashName: "view-plan",
      slashAliases: ["show-plan", "plan-view"],
      run: () => void viewPlan(),
    },
    { name: "grok.effort", title: "Set reasoning effort", category: "Agent", slashName: "effort", run: () => effort() },
    {
      name: "grok.docs",
      title: "How-to guides and docs",
      category: "System",
      slashName: "docs",
      slashAliases: ["howto", "guides"],
      run: () => docs(),
    },
    {
      name: "grok.release_notes",
      title: "Release notes",
      category: "System",
      slashName: "release-notes",
      slashAliases: ["changelog"],
      run: () => open(releaseNotesURL(InstallationVersion)),
    },
    {
      name: "grok.tutorial",
      title: "Tutorial",
      category: "System",
      slashName: "tutorial",
      slashAliases: ["tour", "onboarding"],
      run: tutorial,
    },
    {
      name: "grok.doctor",
      title: "Check terminal and session setup",
      category: "System",
      slashName: "doctor",
      slashAliases: ["terminal-setup", "terminal-check", "terminal-info"],
      run: doctor,
    },
    {
      name: "grok.settings",
      title: "Settings",
      category: "System",
      slashName: "settings",
      slashAliases: ["config", "preferences", "prefs"],
      run: settings,
    },
    {
      name: "grok.multiline",
      title: multiline() ? "Turn off multiline input" : "Turn on multiline input",
      category: "Prompt",
      slashName: "multiline",
      slashAliases: ["ml"],
      run: () => {
        const next = !multiline()
        setMultiline(() => next)
        toast.show({
          variant: "info",
          message: next
            ? "Multiline on: Enter inserts a newline, Shift+Enter or Alt+Enter sends"
            : "Multiline off: Enter sends",
        })
        dialog.clear()
      },
    },
    {
      name: "grok.auto",
      title:
        local.permission.mode === "review" ? "Turn off auto-review permissions" : "Turn on auto-review permissions",
      category: "System",
      slashName: "auto",
      run: () => {
        local.permission.toggleReview()
        toast.show({
          variant: "info",
          message:
            local.permission.mode === "review"
              ? "Auto-review on: routine tool calls are approved; risky ones still ask"
              : "Auto-review off: tool calls ask for approval",
        })
        dialog.clear()
      },
    },
    {
      name: "grok.vim-mode",
      title: vim() ? "Turn off vim scrollback keys" : "Turn on vim scrollback keys",
      category: "Prompt",
      slashName: "vim-mode",
      run: () => {
        const next = vimMode.toggle()
        toast.show({
          variant: "info",
          message: next
            ? "Vim mode on: Esc on an empty prompt enters the scrollback (j/k, h/l, g/G, y/Y, Ctrl+D/U; i to type)"
            : "Vim mode off",
        })
        dialog.clear()
      },
    },
    {
      name: "grok.compact-mode",
      title: compactMode.enabled() ? "Turn off compact display" : "Turn on compact display",
      category: "Session",
      slashName: "compact-mode",
      run: () => {
        const next = compactMode.toggle()
        compactMode.sync()
        toast.show({ variant: "info", message: next ? "Compact display on" : "Compact display off" })
        dialog.clear()
      },
    },
    {
      name: "grok.context-window",
      title: "Set the context window",
      category: "Session",
      slashName: "context-window",
      hidden: windowOptions().length < 2,
      run: () => contextWindow(),
    },
    { name: "grok.logout", title: "Log out of a provider", category: "Provider", slashName: "logout", run: logout },
  ]

  /** Handles `/effort <level>`, `/docs <target>` and `/plan <description>` typed with arguments. */
  const submit = (text: string): { handled: true } | { handled: false; text?: string } => {
    const input = parseSlashInput(text)
    if (!input?.args) return { handled: false }
    if (input.name === "effort") return (effort(input.args), { handled: true })
    if (input.name === "context-window") return (contextWindow(input.args), { handled: true })
    if (["docs", "howto", "guides"].includes(input.name)) return (docs(input.args), { handled: true })
    if (input.name === "plan") {
      const description = plan(input.args)
      return typeof description === "string" ? { handled: false, text: description } : { handled: true }
    }
    return { handled: false }
  }

  return { commands, submit }
}
