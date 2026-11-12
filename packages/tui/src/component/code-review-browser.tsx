/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ColorInput, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import type { CodeReviewInput, CodeReviewRun } from "@apexo/sdk/v2/client"
import { createMemo, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useBindings } from "../keymap"

export type CodeReviewActions = {
  available: () => Promise<boolean>
  list: (after: string | undefined, signal: AbortSignal) => Promise<{ data: CodeReviewRun[]; hasMore: boolean }>
  get: (id: string, signal: AbortSignal, workspace?: boolean) => Promise<CodeReviewRun>
  start: (input: CodeReviewInput, signal: AbortSignal) => Promise<CodeReviewRun>
  cancel: (id: string, signal: AbortSignal) => Promise<CodeReviewRun>
}

export function CodeReviewBrowser(props: {
  actions: CodeReviewActions
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  height?: number
}) {
  const dimensions = useTerminalDimensions()
  const lifetime = new AbortController()
  let refreshToken = 0
  let viewport: ScrollBoxRenderable | undefined
  let editor: TextareaRenderable | undefined
  const [state, setState] = createStore({
    items: [] as CodeReviewRun[],
    selected: 0,
    finding: 0,
    hasMore: false,
    detail: undefined as CodeReviewRun | undefined,
    available: false,
    pending: true,
    refreshing: false,
    error: "",
    editing: false as false | "target" | "focus",
    target: "uncommitted",
    focus: "",
    priority: "all",
  })
  const terminal = (item: CodeReviewRun) => !["admitted", "capturing", "running"].includes(item.status)
  const loadDetail = async (compare = true, token = refreshToken) => {
    const id = state.items[state.selected]?.id
    if (!id) return
    const selected = state.items[state.selected]
    const workspace = selected && terminal(selected) && (compare || !state.detail || !terminal(state.detail))
    const detail = await props.actions.get(id, lifetime.signal, workspace)
    if (!lifetime.signal.aborted && token === refreshToken && id === state.items[state.selected]?.id)
      setState("detail", detail)
  }
  const load = async (more = false, compare = true, token = refreshToken) => {
    const page = await props.actions.list(more ? state.items.at(-1)?.id : undefined, lifetime.signal)
    if (lifetime.signal.aborted || token !== refreshToken) return
    const id = state.items[state.selected]?.id
    const items = more
      ? [...state.items, ...page.data]
      : [...page.data, ...state.items.filter((item) => !page.data.some((fresh) => fresh.id === item.id))]
    setState({
      items,
      hasMore: page.hasMore,
      selected: Math.max(
        0,
        items.findIndex((item) => item.id === id),
      ),
    })
    await loadDetail(compare, token)
  }
  const run = async (work: () => Promise<void>) => {
    if (state.pending) return
    refreshToken++
    setState({ pending: true, error: "" })
    await work()
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", "Request failed. Refresh before retrying.")
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const findings = createMemo(() =>
    (state.detail?.result?.findings ?? [])
      .filter((finding) => state.priority === "all" || finding.priority === state.priority)
      .toSorted((a, b) => a.priority.localeCompare(b.priority)),
  )
  const finding = () => findings()[state.finding]
  onMount(async () => {
    await props.actions
      .available()
      .then(async (available) => {
        if (lifetime.signal.aborted) return
        setState("available", available)
        if (available) await load()
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", "Code review is unavailable.")
      })
    if (!lifetime.signal.aborted) setState("pending", false)
  })
  const timer = setInterval(() => {
    if (
      state.pending ||
      state.refreshing ||
      state.editing ||
      !state.available ||
      !state.items.some((item) => !terminal(item))
    )
      return
    const token = refreshToken
    setState("refreshing", true)
    void load(false, false, token)
      .catch(() => {
        if (!lifetime.signal.aborted && token === refreshToken)
          setState("error", "Refresh failed. Your actions remain available.")
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("refreshing", false)
      })
  }, 1500)
  onCleanup(() => {
    lifetime.abort()
    clearInterval(timer)
  })
  useBindings(() => ({
    priority: 2,
    bindings: [
      {
        key: "escape",
        desc: "Close code review",
        group: "Code review",
        cmd: () => {
          if (state.editing) {
            setState(state.editing, editor?.plainText ?? "")
            setState("editing", false)
            return
          }
          props.onClose()
        },
      },
    ],
  }))
  useKeyboard((key) => {
    if (key.name === "escape" || state.pending || !state.available) return
    if (state.editing) {
      if (key.ctrl && key.name === "s") {
        key.preventDefault()
        setState(state.editing, editor?.plainText ?? "")
        setState("editing", false)
      }
      return
    }
    if (key.ctrl || key.meta) return
    key.preventDefault()
    if (key.name === "pageup") viewport?.scrollBy(-8)
    if (key.name === "pagedown") viewport?.scrollBy(8)
    if (key.name === "t") setState("editing", "target")
    if (key.name === "f") setState("editing", "focus")
    if (key.name === "r") void run(() => load())
    if (key.name === "m" && state.hasMore) void run(() => load(true))
    if (key.name === "p") {
      const priorities = ["all", "P0", "P1", "P2", "P3"]
      setState({ priority: priorities[(priorities.indexOf(state.priority) + 1) % priorities.length]!, finding: 0 })
    }
    if (key.name === "left" || key.name === "right")
      void run(async () => {
        setState({
          selected: Math.max(0, Math.min(state.items.length - 1, state.selected + (key.name === "left" ? -1 : 1))),
          finding: 0,
          detail: undefined,
        })
        await loadDetail()
      })
    if (key.name === "up") setState("finding", Math.max(0, state.finding - 1))
    if (key.name === "down") setState("finding", Math.min(findings().length - 1, state.finding + 1))
    if (key.name === "c" && state.detail && !terminal(state.detail))
      void run(async () => {
        await props.actions.cancel(state.detail!.id, lifetime.signal)
        await load()
      })
    if (key.name === "n")
      void run(async () => {
        const [kind, ...parts] = state.target.trim().split(/\s+/)
        if (kind !== "uncommitted" && kind !== "base" && kind !== "commit" && kind !== "pr") {
          setState("error", "Target: uncommitted, base <ref>, commit <ref>, or pr <number/URL>")
          return
        }
        const target: CodeReviewInput["target"] =
          kind === "uncommitted" ? { type: kind } : { type: kind, ref: parts.join(" ") }
        if (target.type !== "uncommitted" && !target.ref) {
          setState("error", "A target reference is required.")
          return
        }
        const created = await props.actions.start(
          { target, ...(state.focus.trim() ? { focus: state.focus.trim() } : {}) },
          lifetime.signal,
        )
        setState({ items: [created, ...state.items], selected: 0, finding: 0, detail: undefined })
        await load()
      })
  })
  return (
    <box
      flexDirection="column"
      padding={1}
      gap={1}
      height={props.height ?? Math.max(14, Math.min(28, Math.floor(dimensions().height * 0.75) - 2))}
    >
      <text fg={props.theme().highlight}>Code review · frozen, read-only report</text>
      <Show when={!state.available && !state.pending}>
        <text>Structured code review requires a native server.</text>
      </Show>
      <Show
        when={state.editing}
        fallback={
          <>
            <text>
              Target: {state.target} · Focus: {state.focus || "—"}
            </text>
            <Show when={state.detail} fallback={<text>No reports yet</text>}>
              {(entry) => (
                <>
                  <text>
                    {state.selected + 1}/{state.items.length} · {entry().status} ·{" "}
                    {entry().workspaceStatus === "not_applicable"
                      ? "Frozen revision"
                      : entry().workspaceStatus === "stale"
                        ? "STALE: workspace changed"
                        : entry().workspaceStatus === "unavailable"
                          ? "Workspace comparison unavailable"
                          : "Captured workspace"}
                  </text>
                  <text>
                    {new Date(entry().createdAt).toISOString()} · {entry().input.target.type}{" "}
                    {(() => {
                      const target = entry().input.target
                      return target.type === "uncommitted" ? "" : target.ref
                    })()}
                  </text>
                  <scrollbox
                    ref={(value: ScrollBoxRenderable) => {
                      viewport = value
                    }}
                    flexGrow={1}
                  >
                    <text>
                      {entry().result?.summary ??
                        entry().error ??
                        (terminal(entry()) ? `Review ${entry().status}` : "Review in progress")}
                      {"\n"}
                      {entry().result?.assessment}
                      {entry().result
                        ? `\nCoverage exclusions: ${entry().result!.coverage.exclusions.length} · invalid locations: ${entry().result!.coverage.invalidLocations}`
                        : ""}
                      {entry()
                        .result?.coverage.exclusions.map((item) => `\n${item.path}: ${item.reason}`)
                        .join("")}
                    </text>
                    <Show when={finding()}>
                      {(item) => (
                        <>
                          <text fg={props.theme().highlight}>
                            {state.finding + 1}/{findings().length} [{item().priority}] {item().title}
                          </text>
                          <text>
                            {item().explanation}
                            {"\n"}
                            {item().path} ·{" "}
                            {item().anchor.type === "file"
                              ? "file-level"
                              : (() => {
                                  const anchor = item().anchor
                                  return anchor.type === "line"
                                    ? `${anchor.side} ${anchor.startLine}–${anchor.endLine}`
                                    : ""
                                })()}
                            {"\n"}
                          </text>
                          <text>
                            {(() => {
                              const anchor = item().anchor
                              return anchor.type === "line" && !anchor.inHunk
                                ? anchor.snippet?.text
                                : entry().captured?.files.find(
                                    (file) => file.path === item().path || file.oldPath === item().path,
                                  )?.patch
                            })()}
                          </text>
                        </>
                      )}
                    </Show>
                  </scrollbox>
                </>
              )}
            </Show>
            <text fg={props.theme().muted}>
              {state.pending
                ? "Loading · actions disabled"
                : "Ready · n start · t target · f focus · c cancel · r refresh · m more"}
            </text>
            <text fg={props.theme().muted}>
              ←/→ reports · ↑/↓ findings · p priority: {state.priority} · pgup/dn scroll · esc close
            </text>
          </>
        }
      >
        <text>
          {state.editing === "target" ? "uncommitted | base main | commit SHA | pr URL" : "Review focus"} · ctrl+s save
          · esc return
        </text>
        <textarea
          ref={(value: TextareaRenderable) => {
            editor = value
            queueMicrotask(() => {
              if (!value.isDestroyed) value.cursorOffset = Bun.stringWidth(value.plainText)
            })
          }}
          focused
          initialValue={state.editing === "target" ? state.target : state.focus}
          flexGrow={1}
          textColor={props.theme().text}
        />
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>{state.error}</text>
      </Show>
    </box>
  )
}
