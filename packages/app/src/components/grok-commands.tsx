import { For, type Accessor } from "solid-js"
import type { TextPart } from "@apexo/sdk/v2/client"
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
import { useDialog } from "@apexo/ui/context/dialog"
import { Dialog } from "@apexo/ui/dialog"
import { List } from "@apexo/ui/list"
import type { CommandOption } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { showToast } from "@/utils/toast"
import { multiline, setMultiline } from "@apexo/session-ui/v2/prompt-input/multiline"
import { setVimMode, vimMode } from "@/utils/vim-mode"
import { applyCompactMode, compactMode, setCompactMode } from "@/utils/compact-mode"
import { contextWindowChoice, setContextWindowChoice } from "@/utils/context-window"

type Item<T> = { title: string; value: T; detail?: string }

export function DialogGrokList<T>(props: { title: string; items: Item<T>[]; onSelect: (item: Item<T>) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog title={props.title}>
      <List
        class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("grok.empty")}
        key={(item) => item.title}
        items={() => props.items}
        filterKeys={["title", "detail"]}
        onSelect={(item) => {
          if (!item) return
          dialog.close()
          props.onSelect(item)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2" data-grok-item={item.title}>
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.title}</span>
            {item.detail && <span class="text-text-weak shrink-0 font-normal">{item.detail}</span>}
          </div>
        )}
      </List>
    </Dialog>
  )
}

export function DialogGrokText(props: { title: string; lines: string[] }) {
  return (
    <Dialog title={props.title}>
      <div
        class="px-4 pb-4 flex flex-col gap-1 text-14-regular whitespace-pre-wrap break-words"
        data-component="grok-text"
      >
        <For each={props.lines}>{(line) => <div>{line}</div>}</For>
      </div>
    </Dialog>
  )
}

/**
 * Desktop counterparts of Grok Build slash commands (docs/user-guide/04-slash-commands.md).
 * The TUI implements the same names in packages/tui/src/component/grok-commands.tsx.
 */
export function useGrokCommands(sessionID: Accessor<string | undefined>) {
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const platform = usePlatform()
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const providers = useProviders(() => sdk().directory)
  const info = (description: string) => showToast({ title: description })
  const text = (title: string, lines: string[]) => dialog.show(() => <DialogGrokText title={title} lines={lines} />)

  const effort = (level = "") => {
    const variants = local.model.variant.list()
    if (!variants.length) return info(language.t("grok.effort.none"))
    if (!level)
      return dialog.show(() => (
        <DialogGrokList
          title={language.t("grok.effort")}
          items={variants.map((variant) => ({ title: variant, value: variant }))}
          onSelect={(item) => local.model.variant.set(item.value)}
        />
      ))
    const variant = resolveEffort(level, variants)
    if (!variant) return info(language.t("grok.effort.unavailable", { level, levels: variants.join(", ") }))
    local.model.variant.set(variant)
    info(language.t("grok.effort.set", { level: variant }))
  }

  const docs = (args = "") => {
    const target = resolveDocs(args)
    if (target) return platform.openExternal(target.url)
    if (args.trim() && args.trim() !== "how-to") return info(language.t("grok.docs.missing", { query: args.trim() }))
    dialog.show(() => (
      <DialogGrokList
        title={language.t("grok.docs")}
        items={[
          ...docsGuides.map((guide) => ({ title: guide.title, value: guide.url })),
          { title: language.t("grok.docs.web"), value: docsURL },
        ]}
        onSelect={(item) => platform.openExternal(item.value)}
      />
    ))
  }

  const plan = (description = "") => {
    if (!local.agent.list().some((agent) => agent.name === "plan")) return info(language.t("grok.plan.missing"))
    local.agent.set("plan")
    if (!description) info(language.t("grok.plan.entered"))
    return true
  }

  const viewPlan = async () => {
    const id = sessionID()
    const session = id ? sync().session.get(id) : undefined
    if (!session) return
    const path = `.apexo/plans/${session.time.created}-${session.slug}.md`
    const result = await sdk()
      .client.file.read({ path })
      .catch(() => undefined)
    const content = result?.data?.type === "text" ? result.data.content : ""
    if (!content.trim()) return text(language.t("grok.plan.view"), [language.t("grok.plan.empty")])
    text(`${language.t("grok.plan.view")} · ${path}`, [
      content.length > 20_000 ? content.slice(0, 20_000) + "\n…" : content,
    ])
  }

  // /context-window: listed only when the current model supports more than one size.
  const windowOptions = () => local.model.current()?.limit.context_options ?? []
  const setWindow = (size: number) => {
    const id = sessionID()
    const current = local.model.current()
    if (!id || !current) return
    setContextWindowChoice(id, size)
    const label = contextWindowLabel(size)
    const usage = contextUsage(sync().data.message[id] ?? [], size)
    if (usage && usage.used > size) {
      info(language.t("grok.contextWindow.compacting", { size: label }))
      void sdk().client.session.summarize({ sessionID: id, providerID: current.provider.id, modelID: current.id })
      return
    }
    info(language.t("grok.contextWindow.set", { size: label }))
  }
  const contextWindow = (arg?: string) => {
    const options = windowOptions()
    if (options.length < 2) return info(language.t("grok.contextWindow.single"))
    if (arg) {
      const parsed = parseContextWindow(arg, options)
      if ("error" in parsed) return info(parsed.error)
      return setWindow(parsed.size)
    }
    const chosen = contextWindowChoice(sessionID())
    dialog.show(() => (
      <DialogGrokList
        title={language.t("grok.contextWindow")}
        items={options.map((size) => ({
          title: contextWindowLabel(size),
          value: size,
          detail: size === chosen ? language.t("grok.contextWindow.current") : size.toLocaleString(language.intl()),
        }))}
        onSelect={(item) => setWindow(item.value)}
      />
    ))
  }

  const context = () => {
    const id = sessionID()
    if (!id) return
    const usage = contextUsage(sync().data.message[id] ?? [], local.model.current()?.limit.context ?? 0)
    if (!usage) return text(language.t("grok.context"), [language.t("grok.context.empty")])
    const number = (value: number) => value.toLocaleString(language.intl())
    const pct = (value: number) => (usage.limit ? ` (${Math.round((value / usage.limit) * 100)}%)` : "")
    const free = Math.max(0, usage.limit - usage.used)
    text(language.t("grok.context"), [
      language.t("grok.context.window", { limit: usage.limit ? number(usage.limit) : "?" }),
      language.t("grok.context.used", { used: number(usage.used) + pct(usage.used) }),
      `  ${language.t("grok.context.input")}: ${number(usage.input)}`,
      `  ${language.t("grok.context.cache")}: ${number(usage.cache)}`,
      `  ${language.t("grok.context.output")}: ${number(usage.output)}`,
      `  ${language.t("grok.context.reasoning")}: ${number(usage.reasoning)}`,
      ...(usage.limit ? [language.t("grok.context.free", { free: number(free) + pct(free) })] : []),
    ])
  }

  const history = () => {
    const id = sessionID()
    if (!id) return
    const prompts = (sync().data.message[id] ?? [])
      .filter((message) => message.role === "user")
      .map((message) =>
        (sync().data.part[message.id] ?? [])
          .filter((part): part is TextPart => part.type === "text" && !part.synthetic)
          .map((part) => part.text)
          .join("\n"),
      )
    const items = promptHistory(prompts)
    if (!items.length) return info(language.t("grok.history.empty"))
    dialog.show(() => (
      <DialogGrokList
        title={language.t("grok.history")}
        items={items.map((value) => ({ title: value.split("\n")[0]!.slice(0, 160), value }))}
        onSelect={(item) =>
          prompt.set([{ type: "text", content: item.value, start: 0, end: item.value.length }], item.value.length)
        }
      />
    ))
  }

  const tutorial = () =>
    dialog.show(() => (
      <DialogGrokList
        title={language.t("grok.tutorial")}
        items={tutorialTopics.map((topic, index) => ({ title: `${index + 1}. ${topic.title}`, value: index }))}
        onSelect={(item) => text(tutorialTopics[item.value]!.title, [tutorialTopics[item.value]!.body])}
      />
    ))

  const doctor = async () => {
    const health = await sdk()
      .client.global.health()
      .then((result) =>
        result.data ? `${language.t("grok.doctor.ok")} · ${result.data.version}` : language.t("grok.doctor.down"),
      )
      .catch(() => language.t("grok.doctor.down"))
    const notifications =
      typeof Notification === "undefined" ? language.t("grok.doctor.unsupported") : Notification.permission
    text(language.t("grok.doctor"), [
      `${language.t("grok.doctor.server")}: ${health}`,
      `${language.t("grok.doctor.app")}: ${platform.version ?? "dev"}`,
      `${language.t("grok.doctor.clipboard")}: ${navigator.clipboard ? "✓" : "✗"}`,
      `${language.t("grok.doctor.notifications")}: ${notifications}`,
    ])
  }

  const logout = () => {
    const connected = providers.connected()
    if (!connected.length) return info(language.t("grok.logout.none"))
    dialog.show(() => (
      <DialogGrokList
        title={language.t("grok.logout")}
        items={connected.map((provider) => ({ title: provider.name, value: provider.id }))}
        onSelect={async (item) => {
          const result = await sdk().client.auth.remove({ providerID: item.value })
          if (result.error) return info(language.t("grok.logout.failed"))
          await sdk()
            .client.instance.dispose()
            .catch(() => undefined)
          info(language.t("grok.logout.done", { provider: item.title }))
        }}
      />
    ))
  }

  const commands = (): CommandOption[] => [
    {
      id: "grok.context",
      title: language.t("grok.context"),
      category: "Session",
      slash: "context",
      disabled: !sessionID(),
      onSelect: context,
    },
    {
      id: "grok.history",
      title: language.t("grok.history"),
      category: "Session",
      slash: "history",
      disabled: !sessionID(),
      onSelect: history,
    },
    { id: "grok.plan", title: language.t("grok.plan"), category: "Agent", slash: "plan", onSelect: () => void plan() },
    {
      id: "grok.view-plan",
      title: language.t("grok.plan.view"),
      category: "Agent",
      slash: "view-plan",
      slashAliases: ["show-plan", "plan-view"],
      disabled: !sessionID(),
      onSelect: () => void viewPlan(),
    },
    {
      id: "grok.effort",
      title: language.t("grok.effort"),
      category: "Agent",
      slash: "effort",
      onSelect: () => effort(),
    },
    {
      id: "grok.docs",
      title: language.t("grok.docs"),
      category: "System",
      slash: "docs",
      slashAliases: ["howto", "guides"],
      onSelect: () => docs(),
    },
    {
      id: "grok.release-notes",
      title: language.t("grok.releaseNotes"),
      category: "System",
      slash: "release-notes",
      slashAliases: ["changelog"],
      onSelect: () => platform.openExternal(releaseNotesURL(platform.version ?? "")),
    },
    {
      id: "grok.tutorial",
      title: language.t("grok.tutorial"),
      category: "System",
      slash: "tutorial",
      slashAliases: ["tour", "onboarding"],
      onSelect: tutorial,
    },
    {
      id: "grok.doctor",
      title: language.t("grok.doctor"),
      category: "System",
      slash: "doctor",
      slashAliases: ["terminal-setup", "terminal-check", "terminal-info"],
      onSelect: () => void doctor(),
    },
    {
      id: "grok.multiline",
      title: language.t(multiline() ? "grok.multiline.off" : "grok.multiline.on"),
      category: "Prompt",
      slash: "multiline",
      slashAliases: ["ml"],
      onSelect: () => {
        const next = !multiline()
        setMultiline(next)
        info(language.t(next ? "grok.multiline.enabled" : "grok.multiline.disabled"))
      },
    },
    {
      id: "grok.vim-mode",
      title: language.t(vimMode(sync().data.config) ? "grok.vim.off" : "grok.vim.on"),
      category: "Prompt",
      slash: "vim-mode",
      onSelect: () => {
        const next = !vimMode(sync().data.config)
        setVimMode(next)
        info(language.t(next ? "grok.vim.enabled" : "grok.vim.disabled"))
      },
    },
    {
      id: "grok.compact-mode",
      title: language.t(compactMode(sync().data.config) ? "grok.compact.off" : "grok.compact.on"),
      category: "Session",
      slash: "compact-mode",
      onSelect: () => {
        const next = !compactMode(sync().data.config)
        setCompactMode(next)
        applyCompactMode(sync().data.config)
        info(language.t(next ? "grok.compact.enabled" : "grok.compact.disabled"))
      },
    },
    {
      id: "grok.context-window",
      title: language.t("grok.contextWindow"),
      category: "Session",
      slash: "context-window",
      hidden: windowOptions().length < 2,
      onSelect: () => contextWindow(),
    },
    { id: "grok.logout", title: language.t("grok.logout"), category: "Provider", slash: "logout", onSelect: logout },
  ]

  /** Handles `/effort <level>`, `/docs <target>` and `/plan <description>` typed with arguments. */
  const submit = (input: string): { handled: true } | { handled: false; text?: string } => {
    const parsed = parseSlashInput(input)
    if (!parsed?.args) return { handled: false }
    if (parsed.name === "effort") return (effort(parsed.args), { handled: true })
    if (parsed.name === "context-window") return (contextWindow(parsed.args), { handled: true })
    if (["docs", "howto", "guides"].includes(parsed.name)) return (docs(parsed.args), { handled: true })
    if (parsed.name === "plan") return plan(parsed.args) ? { handled: false, text: parsed.args } : { handled: true }
    return { handled: false }
  }

  return { commands, submit }
}
