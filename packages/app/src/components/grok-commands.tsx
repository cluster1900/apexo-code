import { For, type Accessor } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@apexo/core/util/encode"
import { Button } from "@apexo/ui/button"
import type { TextPart } from "@apexo/sdk/v2/client"
import {
  contextUsage,
  contextWindowLabel,
  effectiveContextWindow,
  parseContextWindow,
  docsGuides,
  docsURL,
  parseSlashInput,
  promptHistory,
  releaseNotesURL,
  resolveDocs,
  resolveEffort,
  resolveSessionReference,
  tutorialTopics,
} from "@apexo/sdk/v2/grok-commands"
import { useDialog } from "@apexo/ui/context/dialog"
import { Dialog } from "@apexo/ui/dialog"
import { List } from "@apexo/ui/list"
import { findSlashOption, runSlashOption, useCommand, type CommandOption } from "@/context/command"
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
import { DialogAgentDashboard, useDashboardReplyPump } from "@/components/agent-dashboard"

type Item<T> = { title: string; value: T; detail?: string }

export function DialogGrokList<T>(props: { title: string; items: Item<T>[]; onSelect: (item: Item<T>) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog title={props.title}>
      <List
        class="flex-1 px-3 pb-2 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
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
          <div class="w-full flex items-center justify-between gap-3 py-0.5" data-grok-item={item.title}>
            <span class="truncate flex-1 min-w-0 text-left font-normal text-text-strong">{item.title}</span>
            {item.detail && (
              <span class="text-text-weak shrink-0 rounded-full border border-border-weak-base bg-surface-base/60 px-2 py-0.5 text-11-regular font-mono">
                {item.detail}
              </span>
            )}
          </div>
        )}
      </List>
    </Dialog>
  )
}

// Desktop `/edit-prompt`: Grok Build opens the draft in $VISUAL/$EDITOR; a browser cannot spawn a terminal editor, so
// Desktop opens the draft in a full editor dialog. Saving replaces the draft; cancelling (Esc) keeps it unchanged.
export function DialogEditPrompt(props: { value: string; onSave: (value: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  let area: HTMLTextAreaElement | undefined
  const save = () => {
    props.onSave(area?.value ?? props.value)
    dialog.close()
  }
  return (
    <Dialog title={language.t("grok.editPrompt")} size="large">
      <div class="px-4 pb-4 flex flex-col gap-3 min-h-0">
        <textarea
          ref={(element) => {
            area = element
            requestAnimationFrame(() => {
              element.focus()
              element.setSelectionRange(element.value.length, element.value.length)
            })
          }}
          data-component="grok-edit-prompt"
          class="w-full min-h-[50vh] rounded-lg border border-border-weak-base bg-surface-inset-base/40 p-3.5 font-mono text-13-regular leading-5 text-text-base resize-y outline-none transition-colors focus:border-border-focus"
          value={props.value}
          spellcheck={false}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              save()
            }
          }}
        />
        <div class="flex items-center justify-end gap-2">
          <span class="text-text-weak text-12-regular self-center flex-1 font-mono">{language.t("grok.editPrompt.hint")}</span>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" data-action="grok-edit-prompt-save" onClick={save}>
            {language.t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogGrokText(props: { title: string; lines: string[] }) {
  return (
    <Dialog title={props.title}>
      <div
        class="mx-4 mb-4 flex flex-col gap-1.5 rounded-lg border border-border-weak-base bg-surface-inset-base/30 p-3.5 font-mono text-13-regular leading-5 text-text-base whitespace-pre-wrap break-words"
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
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const navigate = useNavigate()
  const platform = usePlatform()
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const providers = useProviders(() => sdk().directory)
  const info = (description: string) => showToast({ title: description })
  useDashboardReplyPump()
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

  const guideTitle = (title: string) => {
    const keyMap: Record<string, string> = {
      "Getting Started": "grok.docs.guide.gettingStarted",
      Goals: "grok.docs.guide.goals",
      Plugins: "grok.docs.guide.plugins",
      Memory: "grok.docs.guide.memory",
      Workflows: "grok.docs.guide.workflows",
    }
    return keyMap[title] ? language.t(keyMap[title] as never) : title
  }

  const docs = (args = "") => {
    const target = resolveDocs(args)
    if (target) return platform.openExternal(target.url)
    if (args.trim() && args.trim() !== "how-to") return info(language.t("grok.docs.missing", { query: args.trim() }))
    dialog.show(() => (
      <DialogGrokList
        title={language.t("grok.docs")}
        items={[
          ...docsGuides.map((guide) => ({ title: guideTitle(guide.title), value: guide.url })),
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
  const activeModel = () => {
    const selected = local.model.current()
    if (selected) return { providerID: selected.provider.id, modelID: selected.id, limit: selected.limit }
    const id = sessionID()
    const messages = id ? (sync().data.message[id] ?? []) : []
    const last = messages.findLast((message) => message.role === "assistant" && "modelID" in message && message.modelID)
    if (!last || !("providerID" in last)) return undefined
    const found = sync().data.provider.all.get(last.providerID)?.models[last.modelID]
    return found ? { providerID: last.providerID, modelID: last.modelID, limit: found.limit } : undefined
  }
  const windowOptions = () => activeModel()?.limit.context_options ?? []
  const setWindow = (size: number) => {
    const id = sessionID()
    const current = activeModel()
    if (!id || !current) return
    setContextWindowChoice(id, size)
    const label = contextWindowLabel(size)
    const usage = contextUsage(sync().data.message[id] ?? [], size)
    if (usage && usage.used > size) {
      info(language.t("grok.contextWindow.compacting", { size: label }))
      void sdk().client.session.summarize({ sessionID: id, providerID: current.providerID, modelID: current.modelID })
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

  // /import-claude: Grok Build's Claude settings import modal. Toggle sections, then import into the global config.
  const sectionTitle = (id: string) => language.t(`grok.importClaude.section.${id}` as never)
  const importClaude = async () => {
    const preview = (await sdk().client.config.claudeImport.preview()).data
    if (!preview) return info(language.t("grok.importClaude.failed"))
    const available = preview.sections.filter((section) => Number(section.count) > 0)
    if (!preview.found || !available.length) return info(language.t("grok.importClaude.none"))
    const chosen = new Set<string>(available.map((section) => section.id))
    const show = () =>
      dialog.show(() => (
        <DialogGrokList
          title={language.t("grok.importClaude")}
          items={[
            ...available.map((section) => ({
              title: `${chosen.has(section.id) ? "☑" : "☐"} ${sectionTitle(section.id)}`,
              value: section.id as string,
              detail: `${section.count} · ${section.items.slice(0, 3).join(", ")}${section.items.length > 3 ? ", …" : ""}`,
            })),
            { title: language.t("grok.importClaude.apply", { count: chosen.size }), value: "import" },
          ]}
          onSelect={async (item) => {
            if (item.value !== "import") {
              if (chosen.has(item.value)) chosen.delete(item.value)
              else chosen.add(item.value)
              return show()
            }
            if (!chosen.size) return info(language.t("grok.importClaude.empty"))
            const result = (
              await sdk().client.config.claudeImport.apply({
                sections: [...chosen] as ("permissions" | "env" | "mcp" | "hooks" | "paths")[],
              })
            ).data
            if (!result) return info(language.t("grok.importClaude.failed"))
            info(
              language.t("grok.importClaude.done", {
                sections: result.applied.map((section) => `${sectionTitle(section.id)} (${section.count})`).join(", "),
              }) +
                (result.skipped.length
                  ? ` · ${language.t("grok.importClaude.skipped", { count: result.skipped.length })}`
                  : ""),
            )
          }}
        />
      ))
    show()
  }

  // `/move`: same flow as the TUI — pick another known directory of this project, choose whether uncommitted changes
  // travel along, move the session server-side and leave the model a cwd reminder.
  const move = async () => {
    const id = sessionID()
    const session = id ? sync().session.get(id) : undefined
    if (!id || !session) return info(language.t("grok.auto.noSession"))
    const listed = await sdk()
      .client.project.directories({ projectID: session.projectID })
      .then((result) => result.data ?? [])
      .catch(() => [])
    const targets = listed.filter((item) => item.directory !== session.directory)
    const NEW = "\u0000new"
    // New worktree: the server names it and creates it in the same place as the TUI; Desktop never touches disk.
    const createWorktree = async () => {
      const context = [session.title].filter(Boolean).join("\n") || undefined
      const named = await sdk()
        .client.experimental.projectCopy.generateName({ projectID: session.projectID, context }, { throwOnError: true })
        .then((result) => result.data)
      if (!named?.directory) throw new Error("server did not return a worktree location")
      const created = await sdk().client.v2.projectCopy.create(
        {
          projectID: session.projectID,
          location: { directory: session.directory },
          strategy: "git_worktree",
          directory: named.directory,
          name: named.name,
        },
        { throwOnError: true },
      )
      const directory = created.data?.directory
      if (!directory) throw new Error("No project copy directory returned")
      await sdk().client.path.get({ directory }, { throwOnError: true })
      return directory
    }
    dialog.show(() => (
      <DialogGrokList
        title={language.t("grok.move")}
        items={[
          ...targets.map((item) => ({ title: item.directory, value: item.directory, detail: item.strategy })),
          { title: language.t("grok.move.new"), value: NEW },
        ]}
        onSelect={async (picked) => {
          const target = { value: picked.value }
          if (picked.value === NEW) {
            info(language.t("grok.move.creating"))
            const created = await createWorktree().catch((error: unknown) => {
              showToast({ title: language.t("grok.move.failed"), description: String(error) })
              return undefined
            })
            if (!created) return
            target.value = created
          }
          const status = await sdk()
            .client.vcs.status({ directory: session.directory })
            .then((result) => result.data ?? [])
            .catch(() => [])
          const go = async (moveChanges: boolean) => {
            dialog.close()
            const moved = await sdk()
              .client.experimental.controlPlane.moveSession(
                { sessionID: id, destination: { directory: target.value }, moveChanges },
                { throwOnError: true },
              )
              .then(() => true)
              .catch((error: unknown) => {
                showToast({ title: language.t("grok.move.failed"), description: String(error) })
                return false
              })
            if (!moved) return
            await sdk()
              .client.session.promptAsync({
                sessionID: id,
                directory: target.value,
                noReply: true,
                parts: [
                  {
                    type: "text",
                    text: `<system-reminder>The user has changed the current working directory to "${target.value}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`,
                    synthetic: true,
                  },
                ],
              })
              .catch(() => undefined)
            // Session routes are keyed by server + session id, so the open view follows the moved session as-is.
            info(language.t("grok.move.done", { directory: target.value }))
          }
          if (!status.length) return go(false)
          dialog.show(() => (
            <DialogGrokList
              title={language.t("grok.move.changes", { count: status.length })}
              items={[
                { title: language.t("grok.move.changes.yes"), value: true },
                { title: language.t("grok.move.changes.no"), value: false },
              ]}
              onSelect={(choice) => void go(choice.value)}
            />
          ))
        }}
      />
    ))
  }

  const editPrompt = () => {
    const parts = prompt.current()
    const text = parts.flatMap((part) => (part.type === "text" ? [part.content] : [])).join("")
    const others = parts.filter((part) => part.type !== "text")
    dialog.show(() => (
      <DialogEditPrompt
        value={text}
        onSave={(value) => {
          const next = [{ type: "text" as const, content: value, start: 0, end: value.length }, ...others]
          prompt.set(next as typeof parts, value.length)
        }}
      />
    ))
  }

  const context = () => {
    const id = sessionID()
    if (!id) return
    const messages = sync().data.message[id] ?? []
    const model = activeModel()
    const limit =
      effectiveContextWindow(contextWindowChoice(id), model?.limit.context_options) ?? model?.limit.context ?? 0
    const usage = contextUsage(messages, limit)
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
        items={tutorialTopics.map((topic, index) => ({
          title: `${index + 1}. ${language.t(`grok.tutorial.${index + 1}.title` as never) || topic.title}`,
          value: index,
        }))}
        onSelect={(item) =>
          text(
            language.t(`grok.tutorial.${item.value + 1}.title` as never) || tutorialTopics[item.value]!.title,
            [language.t(`grok.tutorial.${item.value + 1}.body` as never) || tutorialTopics[item.value]!.body],
          )
        }
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

  const resume = async (query = "") => {
    const fetched = await sdk()
      .client.session.list({ directory: sdk().directory, roots: true })
      .then((result) => result.data ?? [])
      .catch(() => [])
    const byID = new Map(
      [...fetched, ...sync().data.session]
        .filter((session) => !session.parentID && !session.time?.archived)
        .map((session) => [session.id, session] as const),
    )
    const sessions = [...byID.values()].sort(
      (a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0),
    )
    const open = (session: { id: string; directory?: string }) =>
      navigate(`/${base64Encode(session.directory || sdk().directory)}/session/${session.id}`)
    const match = resolveSessionReference(query, sessions)
    if (match) return open(match)
    const { DialogResumeSession } = await import("@/components/dialog-resume-session")
    dialog.show(() => <DialogResumeSession sessions={sessions} query={query} onSelect={open} />)
  }

  const sessionInfo = async () => {
    const id = sessionID()
    if (!id) return command.trigger("status.open")
    const { DialogSessionInfo } = await import("@/components/dialog-session-info")
    dialog.show(() => <DialogSessionInfo sessionID={id} />)
  }

  const commands = (): CommandOption[] => [
    {
      id: "sessions.open",
      title: language.t("command.sessions.open"),
      category: "Session",
      slash: "resume",
      slashAliases: ["continue"],
      onSelect: () => void resume(),
      onSlash: (query) => void resume(query),
    },
    {
      id: "session.info",
      title: language.t("grok.sessionInfo"),
      category: "Session",
      slash: "session-info",
      slashAliases: ["status", "info"],
      onSelect: () => void sessionInfo(),
    },
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
      onSlash: effort,
    },
    {
      id: "grok.docs",
      title: language.t("grok.docs"),
      category: "System",
      slash: "docs",
      slashAliases: ["howto", "guides"],
      onSelect: () => docs(),
      onSlash: docs,
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
      // Grok Build agent dashboard: live roster with peek/reply. `/sessions` is its alias there; `/resume` is the picker.
      id: "grok.dashboard",
      title: language.t("grok.dashboard"),
      category: "Session",
      slash: "dashboard",
      slashAliases: ["agents-dashboard", "sessions"],
      keybind: "ctrl+\\,ctrl+i",
      onSelect: () => dialog.show(() => <DialogAgentDashboard />),
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
      id: "grok.edit-prompt",
      title: language.t("grok.editPrompt"),
      category: "Prompt",
      slash: "edit-prompt",
      onSelect: editPrompt,
    },
    {
      id: "grok.move",
      title: language.t("grok.move"),
      category: "Session",
      slash: "move",
      onSelect: () => void move(),
    },
    {
      id: "grok.import-claude",
      title: language.t("grok.importClaude"),
      category: "System",
      slash: "import-claude",
      onSelect: () => void importClaude(),
    },
    {
      id: "grok.context-window",
      title: language.t("grok.contextWindow"),
      category: "Session",
      slash: "context-window",
      hidden: windowOptions().length < 2,
      onSelect: () => contextWindow(),
      onSlash: contextWindow,
    },
    { id: "grok.logout", title: language.t("grok.logout"), category: "Provider", slash: "logout", onSelect: logout },
  ]

  /**
   * `/plan <description>` switches to the plan agent and sends the description. Other names run this hook's own
   * commands, so they work on pages that do not register them (the new-session page).
   */
  const submit = (input: string): { handled: true } | { handled: false; text?: string } => {
    const parsed = parseSlashInput(input)
    if (!parsed) return { handled: false }
    if (parsed.name === "plan" && parsed.args)
      return plan(parsed.args) ? { handled: false, text: parsed.args } : { handled: true }
    const match = findSlashOption(commands(), parsed.name)
    if (!match) return { handled: false }
    if (match.disabled) return (info(language.t("command.slash.unavailable", { name: parsed.name })), { handled: true })
    runSlashOption(match, parsed.args)
    return { handled: true }
  }

  return { commands, submit }
}
