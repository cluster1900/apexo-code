/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ColorInput, TextareaRenderable } from "@opentui/core"
import type { ApexoClient, WorkflowInfo, WorkflowLaunch, WorkflowSource, WorkflowSourceEntry, WorkflowValidation } from "@apexo/sdk/v2/client"
import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useBindings } from "../keymap"

export type WorkflowActions = {
  list: (signal: AbortSignal) => Promise<WorkflowInfo[]>
  sources: (signal: AbortSignal) => Promise<WorkflowSourceEntry[]>
  validate: (source: WorkflowSource, signal: AbortSignal) => Promise<WorkflowValidation>
  launch: (input: WorkflowLaunch, signal: AbortSignal) => Promise<WorkflowInfo>
  pause: (entry: WorkflowInfo, signal: AbortSignal) => Promise<unknown>
  resume: (entry: WorkflowInfo, budget: number, signal: AbortSignal) => Promise<unknown>
  stop: (entry: WorkflowInfo, signal: AbortSignal) => Promise<unknown>
  openChild?: (id: string) => void
}
export function workflowActions(client: ApexoClient, session: () => Promise<string>, selection: () => Pick<WorkflowLaunch, "model" | "agent"> | undefined): WorkflowActions {
  const api = client.v2.workflow
  return {
    list: async (signal) => (await api.related({ sessionID: await session() }, { signal, throwOnError: true })).data,
    sources: async (signal) => (await api.sources({ sessionID: await session() }, { signal, throwOnError: true })).data,
    validate: async (source, signal) => (await api.validate({ sessionID: await session(), source }, { signal, throwOnError: true })).data,
    launch: async (input, signal) => (await api.launch({ sessionID: await session(), workflowLaunch: { ...input, ...selection() } }, { signal, throwOnError: true })).data,
    pause: (entry, signal) => api.pause({ sessionID: entry.sessionID, workflowID: entry.id }, { signal, throwOnError: true }),
    resume: (entry, agentBudget, signal) => api.resume({ sessionID: entry.sessionID, workflowID: entry.id, agentBudget }, { signal, throwOnError: true }),
    stop: (entry, signal) => api.stop({ sessionID: entry.sessionID, workflowID: entry.id }, { signal, throwOnError: true }),
  }
}

export function WorkflowBrowser(props: {
  actions: WorkflowActions
  command?: string
  onClose: () => void
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  height?: number
}) {
  const dimensions = useTerminalDimensions()
  const lifetime = new AbortController()
  let editor: TextareaRenderable | undefined
  const initial = props.command?.trim() ?? ""
  const research = initial.match(/^\/deep-research(?:\s+([\s\S]*))?$/u)
  const command = initial.replace(/^\/workflow\s*/u, "").match(/^(run|validate)\s+([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/u)
  const [state, setState] = createStore({
    runs: [] as WorkflowInfo[], sources: [] as WorkflowSourceEntry[], selected: 0,
    source: command && command[2] !== "deep-research" ? `saved:${command[2]}` : "builtin:deep-research",
    args: research?.[1] ? JSON.stringify({ query: research[1] }) : command?.[3] ?? '{"query":""}',
    budget: "16", concurrency: "4", pending: false, error: "", notice: "",
    editing: undefined as "args" | "budget" | "concurrency" | "resume" | undefined,
    confirm: false, preview: false,
  })
  const selected = () => state.runs[state.selected]
  const source = (): WorkflowSource => state.source === "builtin:deep-research" ? { type: "builtin", name: "deep-research" } : { type: "saved", name: state.source.slice(6) }
  const run = async (work: () => Promise<void>) => {
    if (state.pending) return
    setState({ pending: true, error: "", notice: "" })
    await work().catch(() => { if (!lifetime.signal.aborted) setState("error", "Operation failed. Input kept; refresh to check the latest state.") }).finally(() => { if (!lifetime.signal.aborted) setState("pending", false) })
  }
  const load = async () => {
    const results = await Promise.all([props.actions.list(lifetime.signal), props.actions.sources(lifetime.signal)])
    if (!lifetime.signal.aborted) setState({ runs: results[0], sources: results[1], selected: Math.min(state.selected, Math.max(0, results[0].length - 1)) })
  }
  const validate = async () => {
    const result = await props.actions.validate(source(), lifetime.signal)
    if (!lifetime.signal.aborted) setState("notice", result.valid ? "Source is valid." : result.diagnostics.join("\n"))
  }
  const launch = async () => {
    const budget = Number(state.budget)
    const concurrency = Number(state.concurrency)
    if (!Number.isInteger(budget) || budget < 1 || budget > 1024 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
      setState("error", "Budget must be 1–1024 and concurrency 1–16.")
      return
    }
    await props.actions.launch({ source: source(), args: JSON.parse(state.args), agentBudget: budget, concurrency }, lifetime.signal)
    await load()
  }
  onMount(() => void run(async () => {
    await load()
    if (command?.[1] === "validate") await validate()
    if (command?.[1] === "run" || research?.[1]?.trim()) await launch()
  }))
  const timer = setInterval(() => {
    if (!state.pending && !state.editing && !state.confirm && state.runs.some((entry) => entry.status === "running" || entry.status === "pending")) void run(load)
  }, 1500)
  onCleanup(() => { lifetime.abort(); clearInterval(timer) })
  useBindings(() => ({ priority: 2, bindings: [{ key: "escape", desc: "Close workflows", group: "Workflow", cmd: () => {
    if (state.editing || state.confirm || state.preview) { setState({ editing: undefined, confirm: false, preview: false }); return }
    props.onClose()
  } }] }))
  useKeyboard((key) => {
    if (key.name === "escape" || state.pending) return
    if (state.editing) {
      if (key.ctrl && key.name === "s") {
        key.preventDefault()
        const text = editor?.plainText ?? ""
        if (state.editing !== "resume") { setState(state.editing, text); setState("editing", undefined); return }
        const entry = selected()
        const budget = Number(text)
        if (!entry || !Number.isInteger(budget) || budget < entry.agentBudget || budget > 1024 || (entry.status === "budget_limited" && budget <= entry.agentBudget)) { setState("error", "Resume requires a valid total budget; increase it when budget limited."); return }
        setState("editing", undefined)
        if (entry.resumeBlockedReason) return
        void run(async () => {
          await props.actions.resume(entry, budget, lifetime.signal).catch(async (error) => {
            await load()
            if (state.runs.find((run) => run.id === entry.id)?.resumeBlockedReason) return
            throw error
          })
          await load()
        })
      }
      return
    }
    if (key.ctrl || key.meta) return
    key.preventDefault()
    if (state.preview) return
    if (state.confirm) {
      if (key.name === "n") setState("confirm", false)
      if (key.name === "y" && selected()) void run(async () => { await props.actions.stop(selected()!, lifetime.signal); setState("confirm", false); await load() })
      return
    }
    if (key.name === "up") setState("selected", Math.max(0, state.selected - 1))
    if (key.name === "down") setState("selected", Math.min(state.runs.length - 1, state.selected + 1))
    if (key.name === "r") void run(load)
    if (key.name === "v") void run(validate)
    if (key.name === "s") void run(launch)
    if (key.name === "a") setState("editing", "args")
    if (key.name === "b") setState("editing", "budget")
    if (key.name === "c") setState("editing", "concurrency")
    if (key.name === "tab") {
      const keys = state.sources.map((entry) => `${entry.scope === "builtin" ? "builtin" : "saved"}:${entry.name}`)
      if (keys.length) setState("source", keys[(keys.indexOf(state.source) + 1) % keys.length])
    }
    const entry = selected()
    if (!entry) return
    if (key.name === "p" && ["pending", "running"].includes(entry.status)) void run(async () => { await props.actions.pause(entry, lifetime.signal); await load() })
    if (key.name === "u" && !entry.resumeBlockedReason && ["paused", "budget_limited"].includes(entry.status)) setState("editing", "resume")
    if (key.name === "x" && ["pending", "running", "paused", "budget_limited"].includes(entry.status)) setState("confirm", true)
    if (key.name === "enter") setState("preview", true)
    if (key.name === "o" && entry.children[0]) props.actions.openChild?.(entry.children[0])
  })
  return <box height={props.height ?? Math.min(dimensions().height - 6, 26)} flexDirection="column" paddingLeft={1} paddingRight={1}>
    <text flexShrink={0} fg={props.theme().text}><b>Workflows</b> · separate child sessions; closing keeps runs active</text>
    <Show when={state.editing} fallback={<Show when={state.preview && selected()} fallback={<>
      <text flexShrink={0} fg={props.theme().highlight}>Source: {state.source} · Tab selects source</text>
      <text flexShrink={0} fg={props.theme().muted}>Budget {state.budget} · Concurrency {state.concurrency} · Args {state.args}</text>
      <text flexShrink={0} fg={props.theme().muted}>a arguments · b budget · c concurrency · v validate · s start · r refresh</text>
      <Show when={state.confirm}><text flexShrink={0} fg={props.theme().error}>Stop selected workflow and active children? y confirm · n keep</text></Show>
      <scrollbox flexGrow={1} flexBasis={0} minHeight={0}>
        <Show when={!state.runs.length}><text fg={props.theme().muted}>No workflow runs yet.</text></Show>
        <For each={state.runs}>{(entry, index) => <box flexDirection="column" paddingBottom={1}>
          <text fg={index() === state.selected ? props.theme().highlight : props.theme().text}>{index() === state.selected ? "> " : "  "}{entry.name} · {entry.status} · {entry.phase ?? ""}</text>
          <text fg={props.theme().muted}>Agents {entry.agentsSpent}/{entry.agentBudget} · Tokens {entry.tokens} · Children {entry.children.length}</text>
          <Show when={entry.usageIncomplete}><text fg={props.theme().muted}>Recorded usage is a lower bound.</text></Show>
          <Show when={entry.resumeBlockedReason}><text fg={props.theme().muted}>{entry.resumeBlockedReason === "process_restart" ? "This Workflow cannot resume after restart. Start a new Workflow run." : "This structured-output attempt cannot resume. Start a new Workflow run."}</text></Show>
          <Show when={entry.message}><text fg={props.theme().muted}>{entry.message}</text></Show>
        </box>}</For>
      </scrollbox>
      <text flexShrink={0} fg={props.theme().muted}>{`↑↓ select · p pause · ${selected()?.resumeBlockedReason ? "" : "u resume/budget · "}x stop · Enter result · o first child · Esc close`}</text>
    </>}>{(entry) => <scrollbox flexGrow={1} flexBasis={0} minHeight={0}><text fg={props.theme().text}>{JSON.stringify({ result: entry().result, children: entry().children, message: entry().message }, null, 2)}</text></scrollbox>}</Show>}>
      {(field) => <><text flexShrink={0} fg={props.theme().highlight}>{field()} · Ctrl+S apply · Esc cancel</text><textarea ref={(value) => { editor = value }} initialValue={field() === "resume" ? String(selected()?.agentBudget ?? 16) : state[field() as "args" | "budget" | "concurrency"]} focused flexGrow={1} /></>}
    </Show>
    <Show when={state.pending}><text flexShrink={0} fg={props.theme().muted}>Loading…</text></Show>
    <Show when={state.error}><text flexShrink={0} fg={props.theme().error}>{state.error}</text></Show>
    <Show when={state.notice}><text flexShrink={0} fg={props.theme().highlight}>{state.notice}</text></Show>
  </box>
}
