import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js"
import {
  activeText,
  clampText,
  dashboardChips,
  dashboardHints,
  dashboardKey,
  dashboardPeek,
  dashboardRows,
  formatTimeAgo,
  initialDashboardUI,
  rowGlyph,
  setActiveText,
  syncDashboardUI,
  type DashboardData,
  type DashboardEffect,
  type DashboardKey,
  type RowState,
} from "@apexo/sdk/v2/agent-dashboard"
import { useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useBindings, useCommandSlashes } from "../keymap"
import type { createPromptQueue } from "../prompt/queue"
import { deliverPrompt, type PromptDraft } from "../prompt/delivery"
import { errorMessage } from "../util/error"
import { Locale } from "../util/locale"

// Named keys the dashboard owns while it is open. A key is only claimed when the shared reducer would act on it, so
// e.g. ↑/↓ still move the caret inside a non-empty reply and Enter still reaches the focused textarea otherwise.
const chords: { key: string; event: DashboardKey }[] = [
  { key: "up", event: { name: "up" } },
  { key: "down", event: { name: "down" } },
  { key: "return", event: { name: "enter" } },
  { key: "escape", event: { name: "escape" } },
  { key: "tab", event: { name: "tab" } },
  { key: "ctrl+s", event: { name: "ctrl+s" } },
  // Terminals deliver Ctrl+/ as Ctrl+_ (0x1f).
  { key: "ctrl+/", event: { name: "ctrl+/" } },
  { key: "ctrl+_", event: { name: "ctrl+/" } },
  { key: "ctrl+x", event: { name: "ctrl+x" } },
  { key: "ctrl+t", event: { name: "ctrl+t" } },
  { key: "ctrl+\\", event: { name: "ctrl+\\" } },
  ...Array.from({ length: 9 }, (_, i) => ({
    key: String(i + 1),
    event: { name: "char" as const, char: String(i + 1) },
  })),
]

// Dialogs mount above the PromptQueue provider, so the app passes its queue in.
export function DialogDashboard(props: { queue: ReturnType<typeof createPromptQueue> }) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
  const toast = useToast()
  const queue = props.queue
  const slashes = useCommandSlashes()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 250)
  onCleanup(() => clearInterval(timer))

  const data = createMemo<DashboardData>(() => ({
    sessions: sync.data.session,
    status: sync.data.session_status,
    permission: sync.data.permission,
    question: sync.data.question,
    message: sync.data.message,
    part: sync.data.part,
    pinned: local.session.pinned(),
  }))
  const [ui, setUI] = createSignal(initialDashboardUI(dashboardRows(untrack(data))))
  const rows = createMemo(() => dashboardRows(data(), ui().query))
  const peek = createMemo(() => {
    const id = ui().selected
    return id ? dashboardPeek(data(), id, now(), ui().answers.length) : undefined
  })
  const context = () => ({ rows: rows(), peek: peek(), now: Date.now() })
  let textarea: TextareaRenderable | undefined

  onMount(() => dialog.setSize("xlarge"))
  createEffect(() => {
    const next = syncDashboardUI(ui(), rows())
    if (next !== ui()) setUI(next)
  })
  // The peek reads the transcript, which the TUI only hydrates for opened sessions.
  createEffect(
    on(
      () => ui().selected,
      (id) => {
        if (id) void sync.session.sync(id).catch(() => undefined)
      },
    ),
  )
  // The textarea edits whichever text is active (query, reply, draft); keep it in step with the reducer.
  createEffect(() => {
    const text = activeText(ui())
    const focus = ui().focus
    if (!textarea || textarea.isDestroyed) return
    if (textarea.plainText !== text) {
      textarea.setText(text)
      textarea.gotoBufferEnd()
    }
    if (focus === "input") textarea.focus()
    if (focus === "list") textarea.blur()
  })

  const press = (event: DashboardKey) => {
    const result = dashboardKey(ui(), event, context())
    setUI(result.ui)
    if (result.effect) void apply(result.effect)
    return result.handled
  }

  useBindings(() => {
    const current = ui()
    const ctx = context()
    return {
      priority: 2,
      bindings: chords
        .filter((chord) => dashboardKey(current, chord.event, ctx).handled)
        .map((chord) => ({
          key: chord.key,
          desc: "Agent dashboard",
          group: "Dashboard",
          cmd: () => press(chord.event),
        })),
    }
  })
  // Printable keys on the focused list re-focus the input and type into it (doc: "any printable key returns to the input").
  useKeyboard((key) => {
    if (ui().focus !== "list" || key.ctrl || key.meta) return
    const char = key.sequence
    if (!char || char.length !== 1 || char < " " || char === "\x7f") return
    if (/^[1-9]$/u.test(char) && peek()?.question) return
    key.preventDefault()
    press({ name: "char", char })
  })

  async function apply(effect: DashboardEffect) {
    if (effect.type === "exit") return dialog.clear()
    if (effect.type === "toast") return toast.show({ message: effect.message, variant: "info" })
    if (effect.type === "open") return attach(effect.id)
    if (effect.type === "new") {
      route.navigate({ type: "home" })
      return dialog.clear()
    }
    if (effect.type === "pin") return local.session.togglePin(effect.id)
    if (effect.type === "slash") {
      const name = effect.text.split(/\s/u)[0]!
      const entry = slashes().find((item) => item.display === name || item.aliases?.includes(name))
      if (!entry) return toast.show({ message: `Unknown command ${name}`, variant: "error" })
      dialog.clear()
      return entry.onSelect()
    }
    if (effect.type === "stop")
      return sdk.interrupt(effect.id).catch((error) => toast.show({ message: errorMessage(error), variant: "error" }))
    if (effect.type === "delete")
      return sdk.client.session
        .delete({ sessionID: effect.id }, { throwOnError: true })
        .then(() => toast.show({ message: "Session deleted", variant: "info" }))
        .catch((error) => toast.show({ message: errorMessage(error), variant: "error" }))
    if (effect.type === "permission")
      return sdk
        .replyPermission({
          sessionID: effect.id,
          requestID: effect.requestID,
          reply: effect.reply,
          ...(effect.message ? { message: effect.message } : {}),
        })
        .catch((error) => toast.show({ message: errorMessage(error), variant: "error" }))
    if (effect.type === "question")
      return sdk
        .replyQuestion({ sessionID: effect.id, requestID: effect.requestID, answers: effect.answers })
        .catch((error) => toast.show({ message: errorMessage(error), variant: "error" }))
    if (effect.type === "reply") {
      send(effect.id, effect.text)
      if (effect.open) attach(effect.id)
      return
    }
    // dispatch: always a new top-level session seeded with the prompt.
    const model = local.model.current()
    const agent = local.agent.current()
    if (!model || !agent) return toast.show({ message: "Select a model before dispatching", variant: "error" })
    const created = await sdk.client.session
      .create({ agent: agent.name, model: { providerID: model.providerID, id: model.modelID } }, { throwOnError: true })
      .then((result) => result.data)
      .catch((error) => {
        toast.show({ message: errorMessage(error), variant: "error" })
        return undefined
      })
    if (!created) return
    send(created.id, effect.text, { agent: agent.name, model })
    if (effect.attach) return attach(created.id)
    toast.show({ message: "Agent dispatched", variant: "info" })
  }

  function attach(sessionID: string) {
    route.navigate({ type: "session", sessionID })
    dialog.clear()
  }

  // Idle agents start immediately; busy ones queue the message exactly like the agent view prompt.
  function send(sessionID: string, text: string, selection?: { agent: string; model: PromptDraft["model"] }) {
    const session = sync.session.get(sessionID)
    const last = (sync.data.message[sessionID] ?? []).findLast((message) => message.role === "user")
    const model =
      selection?.model ??
      (last?.role === "user" ? { providerID: last.model.providerID, modelID: last.model.modelID } : undefined) ??
      (session?.model ? { providerID: session.model.providerID, modelID: session.model.id } : undefined) ??
      local.model.current()
    const agentName =
      selection?.agent ??
      (last?.role === "user" ? last.agent : undefined) ??
      session?.agent ??
      local.agent.current()?.name
    if (!model || !agentName) return toast.show({ message: "Select a model before replying", variant: "error" })
    const draft: PromptDraft = {
      sessionID,
      agentName,
      model,
      variant: last?.role === "user" ? last.model.variant : undefined,
      mode: "normal",
      inputText: text,
      nonTextParts: [],
      editorParts: [],
      historyPrompt: { input: text, parts: [], mode: "normal" },
    }
    const busy =
      (sync.data.session_status[sessionID]?.type ?? "idle") !== "idle" ||
      !!sync.data.permission[sessionID]?.length ||
      !!sync.data.question[sessionID]?.length ||
      queue.list(sessionID).length > 0
    if (busy) {
      queue.push(draft)
      return toast.show({ message: "Reply queued", variant: "info" })
    }
    void deliverPrompt(sdk.client.session, sync.data.command, draft).catch((error) =>
      toast.show({ title: "Failed to send prompt", message: errorMessage(error), variant: "error" }),
    )
  }

  const color = (state: RowState) =>
    state === "needs-input" ? theme.warning : state === "working" ? theme.accent : theme.textMuted
  const width = () => Math.max(40, Math.min(116, dimensions().width) - 6)
  const listHeight = () => Math.max(3, dimensions().height - (peek() ? 22 : 16))
  const visible = createMemo(() => {
    const all = rows()
    const index = all.findIndex((row) => row.id === ui().selected)
    const start = Math.max(0, Math.min(index - Math.floor(listHeight() / 2), all.length - listHeight()))
    return all.slice(start, start + listHeight())
  })
  const frame = () => Math.floor(now() / 250)
  const header = () => {
    const vcs = sync.data.vcs?.branch
    return `${vcs ? `${vcs} ` : ""}${Locale.truncateMiddle(sync.path.directory || "", 48)}`
  }

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Agents · {header()}
        </text>
        <text fg={theme.textMuted}>
          <For each={dashboardChips(rows())}>
            {(chip, index) => (
              <span style={{ fg: color(chip.state) }}>
                {index() > 0 ? " │ " : ""}
                {chip.glyph} {chip.label}
              </span>
            )}
          </For>
        </text>
      </box>
      <box flexDirection="column">
        <text fg={ui().selected ? theme.textMuted : theme.primary}>{ui().selected ? "  " : "▌ "}+ New Agent</text>
        <For each={visible()}>
          {(row) => {
            const selected = () => ui().selected === row.id
            const label = () =>
              Locale.truncate(
                `${row.pinned ? "★ " : ""}${row.title}${row.subtitle ? ` · ${row.subtitle}` : ""}`,
                width() - 12,
              )
            return (
              <box flexDirection="row" justifyContent="space-between">
                <text fg={selected() ? theme.text : theme.textMuted}>
                  <span style={{ fg: theme.primary }}>{selected() ? "▌" : " "}</span>
                  <span style={{ fg: color(row.state) }}>{rowGlyph(row.state, frame())}</span> {label()}
                </text>
                <text fg={theme.textMuted}>{formatTimeAgo(now() - row.updated)}</text>
              </box>
            )
          }}
        </For>
        <Show when={!rows().length}>
          <text fg={theme.textMuted}>{ui().query ? "  No agents match the filter" : "  No agents yet"}</text>
        </Show>
      </box>
      <Show when={peek()}>
        {(view) => (
          <box flexDirection="column" border={["top"]} borderColor={theme.border}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={view().responseType === "Idle" ? theme.textMuted : theme.accent}>{view().responseType}</text>
              <text fg={theme.textMuted}>{view().time}</text>
            </box>
            <For each={clampText(view().body || "(no response yet)", width(), 3)}>
              {(line) => <text fg={theme.text}>{line}</text>}
            </For>
            <Show when={view().question}>
              {(question) => (
                <box flexDirection="column">
                  <text fg={theme.warning}>{question().text}</text>
                  <Show when={question().multiple}>
                    <text fg={theme.textMuted}>Multi-select question — press Enter to open the agent and answer</text>
                  </Show>
                  <For each={question().options}>
                    {(option, index) => (
                      <text fg={ui().option === index() && ui().focus === "input" ? theme.primary : theme.textMuted}>
                        {ui().option === index() && ui().focus === "input" ? "❯ " : "  "}
                        {index() + 1}. {option.label}
                      </text>
                    )}
                  </For>
                </box>
              )}
            </Show>
            <text fg={theme.textMuted}>
              {view().model ?? ""}
              {view().agent ? ` · ${view().agent}` : ""}
            </text>
          </box>
        )}
      </Show>
      <box
        flexDirection="row"
        border={["top", "bottom"]}
        borderColor={ui().focus === "input" ? theme.primary : theme.border}
      >
        <text flexShrink={0} fg={ui().search ? theme.warning : theme.primary}>
          <b>{ui().search ? "Search: " : "❯ "}</b>
        </text>
        <textarea
          flexGrow={1}
          minHeight={1}
          maxHeight={6}
          ref={(value: TextareaRenderable) => {
            textarea = value
          }}
          placeholder={
            ui().search
              ? "filter: text, a:<agent>, s:<state>, #tag"
              : ui().selected
                ? peek()?.question?.free !== undefined
                  ? "type feedback / Other answer…"
                  : "reply…"
                : "Dispatch a new agent"
          }
          placeholderColor={theme.textMuted}
          textColor={theme.text}
          focusedTextColor={theme.text}
          onContentChange={() => {
            if (!textarea) return
            const text = textarea.plainText
            if (text !== activeText(ui())) setUI(setActiveText(ui(), text))
          }}
        />
      </box>
      <text fg={theme.textMuted}>
        {ui().search
          ? dashboardHints.search
          : ui().selected || ui().focus === "list"
            ? dashboardHints.list
            : dashboardHints.dispatch}
      </text>
    </box>
  )
}
