import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@apexo/core/util/encode"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import {
  activeText,
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
import { parseSlashInput } from "@apexo/sdk/v2/grok-commands"
import { findSlashOption, runSlashOption, useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { showToast } from "@/utils/toast"
import {
  dashboardPins,
  enqueueDashboardReply,
  pumpDashboardReplies,
  toggleDashboardPin,
  type DashboardReply,
} from "@/utils/dashboard-replies"

/** Maps a DOM key event onto the shared dashboard keys; undefined for keys the dashboard never claims. */
function dashboardEvent(event: KeyboardEvent): DashboardKey | undefined {
  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key.toLowerCase() === "s") return { name: "ctrl+s" }
  if (mod && event.key === "/") return { name: "ctrl+/" }
  if (event.ctrlKey && event.key.toLowerCase() === "x") return { name: "ctrl+x" }
  if (event.ctrlKey && event.key.toLowerCase() === "t") return { name: "ctrl+t" }
  if (event.ctrlKey && event.key === "\\") return { name: "ctrl+\\" }
  if (mod || event.altKey) return
  if (event.key === "ArrowUp") return { name: "up" }
  if (event.key === "ArrowDown") return { name: "down" }
  // Shift+Enter inserts a newline in the reply / dispatch box.
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) return { name: "enter" }
  if (event.key === "Escape") return { name: "escape" }
  if (event.key === "Tab" && !event.shiftKey) return { name: "tab" }
  if (event.key.length === 1) return { name: "char", char: event.key }
}

/** Runs the reply pump while mounted; peek replies to busy agents wait here until the agent is idle again. */
export function useDashboardReplyPump() {
  const sdk = useSDK()
  const sync = useSync()
  createEffect(() =>
    pumpDashboardReplies({
      busy: (sessionID) =>
        (sync().data.session_status[sessionID]?.type ?? "idle") !== "idle" ||
        !!sync().data.permission[sessionID]?.length ||
        !!sync().data.question[sessionID]?.length,
      deliver: (reply) => deliverReply(sdk(), reply),
      onError: (error) => showToast({ title: "Failed to send prompt", description: String(error) }),
    }),
  )
}

function deliverReply(sdk: ReturnType<ReturnType<typeof useSDK>>, reply: DashboardReply) {
  return sdk.api.session.prompt({
    sessionID: reply.sessionID,
    agent: reply.agent,
    model: reply.model,
    variant: reply.variant,
    text: reply.text,
    legacyParts: [{ type: "text", text: reply.text }],
  })
}

export function DialogAgentDashboard() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const command = useCommand()
  const language = useLanguage()
  const navigate = useNavigate()
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 250)
  onCleanup(() => clearInterval(timer))
  useDashboardReplyPump()

  const data = createMemo<DashboardData>(() => ({
    sessions: sync().data.session,
    status: sync().data.session_status,
    permission: sync().data.permission,
    question: sync().data.question,
    message: sync().data.message,
    part: sync().data.part,
    pinned: dashboardPins(),
  }))
  const [ui, setUI] = createSignal(initialDashboardUI(dashboardRows(untrack(data))))
  const rows = createMemo(() => dashboardRows(data(), ui().query))
  const peek = createMemo(() => {
    const id = ui().selected
    return id ? dashboardPeek(data(), id, now(), ui().answers.length) : undefined
  })
  let root: HTMLDivElement | undefined
  let input: HTMLTextAreaElement | undefined

  createEffect(() => {
    const next = syncDashboardUI(ui(), rows())
    if (next !== ui()) setUI(next)
  })
  // The peek reads the transcript, which Desktop only hydrates for opened sessions.
  createEffect(
    on(
      () => ui().selected,
      (id) => {
        if (id)
          void sync()
            .session.sync(id)
            .catch(() => undefined)
      },
    ),
  )
  createEffect(() => {
    const text = activeText(ui())
    const focus = ui().focus
    if (!input) return
    if (input.value !== text) input.value = text
    if (focus === "input" && document.activeElement !== input) input.focus()
    if (focus === "list" && document.activeElement === input) root?.focus()
  })
  // The slash command path re-focuses the prompt editor after the dialog mounts; take focus back once it settles.
  const focusDashboard = () => (ui().focus === "input" ? input?.focus() : root?.focus())
  onMount(() => {
    focusDashboard()
    const frame = requestAnimationFrame(() => {
      if (!root?.contains(document.activeElement)) focusDashboard()
    })
    onCleanup(() => cancelAnimationFrame(frame))
  })

  const onKeyDown = (event: KeyboardEvent) => {
    const key = dashboardEvent(event)
    if (!key) return
    const result = dashboardKey(ui(), key, { rows: rows(), peek: peek(), now: Date.now() })
    if (!result.handled) return
    // Claimed keys stop here so the dialog's own Escape and the global keybinds never see them.
    event.preventDefault()
    event.stopPropagation()
    setUI(result.ui)
    if (result.effect) void apply(result.effect)
  }

  const attach = (sessionID: string) => {
    dialog.close()
    navigate(`/${base64Encode(sdk().directory)}/session/${sessionID}`)
  }
  const fail = (error: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })

  // Idle agents start immediately; busy ones queue the message until the agent is idle again.
  const send = (sessionID: string, text: string, selection?: Pick<DashboardReply, "agent" | "model">) => {
    const session = sync().session.get(sessionID)
    const last = (sync().data.message[sessionID] ?? []).findLast((message) => message.role === "user")
    const current = local.model.current()
    const model =
      selection?.model ??
      (last?.role === "user" ? { providerID: last.model.providerID, modelID: last.model.modelID } : undefined) ??
      (session?.model ? { providerID: session.model.providerID, modelID: session.model.id } : undefined) ??
      (current ? { providerID: current.provider.id, modelID: current.id } : undefined)
    const agent =
      selection?.agent ??
      (last?.role === "user" ? last.agent : undefined) ??
      session?.agent ??
      local.agent.current()?.name
    if (!model || !agent) return showToast({ title: "Select a model before replying" })
    const reply = { sessionID, text, agent, model, variant: last?.role === "user" ? last.model.variant : undefined }
    const busy =
      (sync().data.session_status[sessionID]?.type ?? "idle") !== "idle" ||
      !!sync().data.permission[sessionID]?.length ||
      !!sync().data.question[sessionID]?.length
    if (busy) {
      enqueueDashboardReply(reply)
      return showToast({ title: "Reply queued" })
    }
    void deliverReply(sdk(), reply).catch(fail)
  }

  async function apply(effect: DashboardEffect) {
    if (effect.type === "exit") return dialog.close()
    if (effect.type === "toast") return showToast({ title: effect.message })
    if (effect.type === "open") return attach(effect.id)
    if (effect.type === "new") {
      dialog.close()
      return navigate(`/${base64Encode(sdk().directory)}/session`)
    }
    if (effect.type === "pin") return toggleDashboardPin(effect.id)
    if (effect.type === "slash") {
      const parsed = parseSlashInput(effect.text)
      const option = parsed ? findSlashOption(command.options, parsed.name) : undefined
      if (!parsed || !option) return showToast({ title: `Unknown command ${effect.text.split(/\s/u)[0]}` })
      if (option.disabled) return showToast({ title: language.t("command.slash.unavailable", { name: parsed.name }) })
      dialog.close()
      return runSlashOption(option, parsed.args)
    }
    if (effect.type === "stop") return sdk().api.session.interrupt({ sessionID: effect.id }).catch(fail)
    if (effect.type === "delete")
      return sdk()
        .client.session.delete({ sessionID: effect.id }, { throwOnError: true })
        .then(() => showToast({ title: "Session deleted" }))
        .catch(fail)
    if (effect.type === "permission")
      return sdk()
        .client.permission.reply(
          {
            requestID: effect.requestID,
            reply: effect.reply,
            ...(effect.message ? { message: effect.message } : {}),
          },
          { throwOnError: true },
        )
        .catch(fail)
    if (effect.type === "question")
      return sdk()
        .api.question.reply({ sessionID: effect.id, requestID: effect.requestID, answers: effect.answers })
        .catch(fail)
    if (effect.type === "reply") {
      send(effect.id, effect.text)
      if (effect.open) attach(effect.id)
      return
    }
    // dispatch: always a new top-level session seeded with the prompt.
    const current = local.model.current()
    const agent = local.agent.current()?.name
    if (!current || !agent) return showToast({ title: "Select a model before dispatching" })
    const model = { providerID: current.provider.id, modelID: current.id }
    const created = await sdk()
      .client.session.create(
        { agent, model: { providerID: model.providerID, id: model.modelID } },
        { throwOnError: true },
      )
      .then((result) => result.data)
      .catch((error: unknown) => {
        fail(error)
        return undefined
      })
    if (!created) return
    send(created.id, effect.text, { agent, model })
    if (effect.attach) return attach(created.id)
    showToast({ title: "Agent dispatched" })
  }

  const tone = (state: RowState) =>
    state === "needs-input"
      ? "text-icon-warning-base"
      : state === "working"
        ? "text-text-interactive-base"
        : "text-text-weak"
  const frame = () => Math.floor(now() / 250)

  return (
    <Dialog title={language.t("grok.dashboard")} size="x-large">
      <div
        ref={root}
        tabIndex={-1}
        // Dialog autofocuses [autofocus]; otherwise its close button would take the keys.
        autofocus={untrack(ui).focus === "list"}
        data-dashboard
        data-escape-local
        data-focus={ui().focus}
        class="flex flex-col gap-3 px-4 pb-4 min-h-0 outline-none"
        onKeyDown={onKeyDown}
      >
        <div class="flex items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-base/50 px-3 py-1.5 text-12-regular">
          <span class="text-text-weak truncate font-mono">
            {sync().data.vcs?.branch ? `${sync().data.vcs?.branch} ` : ""}
            {sdk().directory}
          </span>
          <span data-dashboard-chips class="flex gap-1.5 shrink-0 font-mono">
            <For each={dashboardChips(rows())}>
              {(chip, index) => (
                <span class={tone(chip.state)}>
                  {index() > 0 ? "│ " : ""}
                  {chip.glyph} {chip.label}
                </span>
              )}
            </For>
          </span>
        </div>
        <div
          class="flex flex-col gap-0.5 overflow-y-auto max-h-[45vh] rounded-lg border border-border-weak-base bg-surface-inset-base/30 p-1.5 font-mono text-13-regular"
          data-dashboard-rows
        >
          <button
            type="button"
            data-dashboard-new
            data-selected={ui().selected ? undefined : ""}
            class="text-left px-2.5 py-1.5 rounded-md transition-colors hover:bg-surface-base-hover"
            classList={{ "bg-surface-base-active text-text-strong": !ui().selected, "text-text-weak": !!ui().selected }}
            onClick={() => setUI({ ...ui(), selected: undefined, reply: "", option: 0, answers: [] })}
          >
            + New Agent
          </button>
          <For each={rows()}>
            {(row) => (
              <button
                type="button"
                data-dashboard-row={row.id}
                data-state={row.state}
                data-selected={ui().selected === row.id ? "" : undefined}
                class="flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md transition-colors hover:bg-surface-base-hover"
                classList={{ "bg-surface-base-active": ui().selected === row.id }}
                onClick={() =>
                  setUI(
                    ui().selected === row.id ? ui() : { ...ui(), selected: row.id, reply: "", option: 0, answers: [] },
                  )
                }
                onDblClick={() => attach(row.id)}
              >
                <span class={tone(row.state)}>{rowGlyph(row.state, frame())}</span>
                <span class="truncate flex-1 min-w-0 text-text-base">
                  {row.pinned ? "★ " : ""}
                  {row.title}
                  <Show when={row.subtitle}>
                    <span class="text-text-weak"> · {row.subtitle}</span>
                  </Show>
                </span>
                <span class="text-text-weak shrink-0 text-12-regular">{formatTimeAgo(now() - row.updated)}</span>
              </button>
            )}
          </For>
          <Show when={!rows().length}>
            <span class="px-2.5 py-2 text-text-weak">{ui().query ? "No agents match the filter" : "No agents yet"}</span>
          </Show>
        </div>
        <Show when={peek()}>
          {(view) => (
            <div
              data-dashboard-peek
              class="flex flex-col gap-1.5 rounded-lg border border-border-weak-base bg-surface-base/60 p-3 text-13-regular"
            >
              <div class="flex items-center justify-between">
                <span
                  data-peek-type
                  class={view().responseType === "Idle" ? "text-text-weak font-medium" : "text-text-interactive-base font-medium"}
                >
                  {view().responseType}
                </span>
                <span class="text-text-weak text-12-regular font-mono">{view().time}</span>
              </div>
              <div data-peek-body class="text-text-base whitespace-pre-wrap line-clamp-3 leading-5">
                {view().body || "(no response yet)"}
              </div>
              <Show when={view().question}>
                {(question) => (
                  <div data-peek-question class="flex flex-col gap-1 rounded-md border border-border-weak-base bg-surface-inset-base/40 p-2">
                    <span class="text-icon-warning-base font-medium">{question().text}</span>
                    <Show when={question().multiple}>
                      <span class="text-text-weak text-12-regular">
                        Multi-select question — press Enter to open the agent and answer
                      </span>
                    </Show>
                    <For each={question().options}>
                      {(option, index) => (
                        <button
                          type="button"
                          data-peek-option={option.label}
                          data-selected={ui().option === index() && ui().focus === "input" ? "" : undefined}
                          class="text-left rounded px-1.5 py-0.5 transition-colors hover:bg-surface-base-hover"
                          classList={{
                            "text-text-strong bg-surface-base-active": ui().option === index() && ui().focus === "input",
                            "text-text-weak": !(ui().option === index() && ui().focus === "input"),
                          }}
                          onClick={() => {
                            const result = dashboardKey(
                              { ...ui(), option: index() },
                              { name: "char", char: String(index() + 1) },
                              { rows: rows(), peek: peek(), now: Date.now() },
                            )
                            setUI(result.ui)
                            if (result.effect) void apply(result.effect)
                          }}
                        >
                          {ui().option === index() && ui().focus === "input" ? "❯ " : "  "}
                          {index() + 1}. {option.label}
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </Show>
              <span data-peek-model class="text-text-weak text-12-regular font-mono">
                {view().model ?? ""}
                {view().agent ? ` · ${view().agent}` : ""}
              </span>
            </div>
          )}
        </Show>
        <div
          class="flex items-start gap-2 rounded-lg border bg-surface-inset-base/40 px-3 py-2 transition-colors"
          classList={{
            "border-border-focus": ui().focus === "input",
            "border-border-weak-base": ui().focus !== "input",
          }}
        >
          <span class={ui().search ? "text-icon-warning-base font-mono" : "text-text-interactive-base font-mono"}>
            {ui().search ? "Search:" : "❯"}
          </span>
          <textarea
            ref={input}
            data-dashboard-input
            autofocus={untrack(ui).focus === "input"}
            rows={1}
            class="flex-1 bg-transparent outline-none resize-none text-13-regular text-text-base [field-sizing:content] max-h-40"
            placeholder={
              ui().search
                ? "filter: text, a:<agent>, s:<state>, #tag"
                : ui().selected
                  ? peek()?.question?.free !== undefined
                    ? "type feedback / Other answer…"
                    : "reply…"
                  : "Dispatch a new agent"
            }
            onFocus={() => ui().focus !== "input" && setUI({ ...ui(), focus: "input" })}
            onInput={(event) => setUI(setActiveText(ui(), event.currentTarget.value))}
          />
        </div>
        <span data-dashboard-hints class="text-12-regular text-text-weak font-mono px-0.5">
          {ui().search
            ? dashboardHints.search
            : ui().selected || ui().focus === "list"
              ? dashboardHints.list
              : dashboardHints.dispatch}
        </span>
      </div>
    </Dialog>
  )
}
