import { useNavigate, useParams } from "@solidjs/router"
import { useDialog } from "@apexo/ui/context/dialog"
import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { WorkflowInfo, WorkflowSource, WorkflowSourceEntry, WorkflowValidation } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function WorkflowDialog(props: {
  sessionID: string
  command?: string
  selection?: { agent?: string; model?: { id: string; providerID: string; variant?: string } }
}) {
  const language = useLanguage()
  const navigate = useNavigate()
  const params = useParams()
  const dialog = useDialog()
  const api = useSDK()().client.v2.workflow
  const lifetime = new AbortController()
  const initial = props.command?.trim() ?? ""
  const research = initial.match(/^\/deep-research(?:\s+([\s\S]*))?$/u)
  const command = initial.replace(/^\/workflow\s*/u, "").match(/^(run|validate)\s+([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/u)
  const [state, setState] = createStore({
    sources: [] as WorkflowSourceEntry[],
    runs: [] as WorkflowInfo[],
    source: research || command?.[2] === "deep-research" ? "builtin:deep-research" : command ? `saved:${command[2]}` : "builtin:deep-research",
    query: research?.[1] ?? "",
    args: command?.[3] ?? "{}",
    budget: "16",
    concurrency: "4",
    pending: false,
    error: false,
    invalid: undefined as
      | "workflow.invalidQuery"
      | "workflow.invalidBudget"
      | "workflow.invalidConcurrency"
      | "workflow.invalidArgs"
      | "workflow.invalidInput"
      | undefined,
    validation: undefined as WorkflowValidation | undefined,
    confirm: undefined as string | undefined,
    budgets: {} as Record<string, string>,
  })
  const run = async (work: () => Promise<void>) => {
    if (state.pending) return
    setState({ pending: true, error: false, invalid: undefined })
    await work().catch(() => { if (!lifetime.signal.aborted) setState("error", true) }).finally(() => {
      if (!lifetime.signal.aborted) setState("pending", false)
    })
  }
  const source = (): WorkflowSource => state.source === "builtin:deep-research"
    ? { type: "builtin", name: "deep-research" }
    : { type: "saved", name: state.source.slice(6) }
  const load = async () => {
    const results = await Promise.all([
      api.sources({ sessionID: props.sessionID }, { signal: lifetime.signal, throwOnError: true }),
      api.related({ sessionID: props.sessionID }, { signal: lifetime.signal, throwOnError: true }),
    ])
    if (!lifetime.signal.aborted) setState({ sources: results[0].data, runs: results[1].data })
  }
  const validate = async () => {
    const result = await api.validate({ sessionID: props.sessionID, source: source() }, { signal: lifetime.signal, throwOnError: true })
    if (!lifetime.signal.aborted) setState("validation", result.data)
  }
  const start = async () => {
    if (state.source === "builtin:deep-research" && !state.query.trim()) {
      setState("invalid", "workflow.invalidQuery")
      return
    }
    const budget = Number(state.budget)
    if (!Number.isInteger(budget) || budget < 1 || budget > 1024) {
      setState("invalid", "workflow.invalidBudget")
      return
    }
    const concurrency = Number(state.concurrency)
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
      setState("invalid", "workflow.invalidConcurrency")
      return
    }
    const args = state.source === "builtin:deep-research" ? { query: state.query } : JSON.parse(state.args)
    await api.launch({ sessionID: props.sessionID, workflowLaunch: { source: source(), args, agentBudget: budget, concurrency, ...props.selection } }, { signal: lifetime.signal, throwOnError: true })
    await load()
  }
  const control = async (entry: WorkflowInfo, action: "pause" | "resume" | "stop") => {
    const target = { sessionID: entry.sessionID, workflowID: entry.id }
    const options = { signal: lifetime.signal, throwOnError: true as const }
    if (action === "resume") {
      const budget = Number(state.budgets[entry.id] ?? entry.agentBudget)
      if (!Number.isInteger(budget) || budget < entry.agentBudget || budget > 1024 || (entry.status === "budget_limited" && budget <= entry.agentBudget)) {
        setState("invalid", "workflow.invalidInput")
        return
      }
      if (entry.resumeBlockedReason) return
      await api.resume({ ...target, agentBudget: budget }, options).catch(async (error) => {
        await load()
        if (state.runs.find((run) => run.id === entry.id)?.resumeBlockedReason) return
        throw error
      })
    }
    if (action === "pause") await api.pause(target, options)
    if (action === "stop") await api.stop(target, options)
    if (!lifetime.signal.aborted) setState("confirm", undefined)
    await load()
  }
  onMount(() => void run(async () => {
    await load()
    if (command?.[2] === "deep-research" && command[3]) {
      const args = JSON.parse(command[3])
      if (typeof args?.query === "string") setState("query", args.query)
    }
    if (command?.[1] === "validate") await validate()
    if (command?.[1] === "run" || research?.[1]?.trim()) await start()
  }))
  const timer = setInterval(() => {
    if (!state.pending && state.runs.some((entry) => entry.status === "running" || entry.status === "pending")) void run(load)
  }, 1500)
  onCleanup(() => { lifetime.abort(); clearInterval(timer) })
  return (
    <Dialog title={language.t("workflow.title")} size="large" fit>
      <div data-testid="workflow-panel" class="min-h-0 max-h-[65vh] overflow-y-auto px-6 pt-2 pb-6 space-y-4">
        <p class="text-13-regular text-text-weak">{language.t("workflow.description")}</p>
        <label class="flex flex-col gap-1.5 text-13-medium text-text-strong">{language.t("workflow.source")}
          <select data-testid="workflow-source" class="block w-full rounded-md border border-border-base bg-surface-inset-base p-2 text-14-regular text-text-base" value={state.source} onChange={(event) => setState({ source: event.currentTarget.value, validation: undefined })}>
            <For each={state.sources}>{(entry) => <option value={`${entry.scope === "builtin" ? "builtin" : "saved"}:${entry.name}`}>{entry.name} · {language.t(`workflow.scope.${entry.scope}`)}</option>}</For>
          </select>
        </label>
        <Show when={state.source === "builtin:deep-research"} fallback={<label class="flex flex-col gap-1.5 text-13-medium text-text-strong">{language.t("workflow.arguments")}<textarea data-testid="workflow-args" class="w-full min-h-20 rounded-md border border-border-base bg-surface-inset-base p-2.5 text-14-regular text-text-base" value={state.args} onInput={(event) => setState("args", event.currentTarget.value)} /></label>}>
          <label class="flex flex-col gap-1.5 text-13-medium text-text-strong">{language.t("workflow.query")}<textarea data-testid="workflow-query" class="w-full min-h-20 rounded-md border border-border-base bg-surface-inset-base p-2.5 text-14-regular text-text-base" value={state.query} onInput={(event) => setState("query", event.currentTarget.value)} /></label>
        </Show>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1.5 text-13-medium text-text-strong">{language.t("workflow.budget")}<input data-testid="workflow-budget" class="block w-full rounded-md border border-border-base bg-surface-inset-base p-2 text-14-regular text-text-base" type="number" min="1" max="1024" value={state.budget} onInput={(event) => setState("budget", event.currentTarget.value)} /></label>
          <label class="flex flex-col gap-1.5 text-13-medium text-text-strong">{language.t("workflow.concurrency")}<input data-testid="workflow-concurrency" class="block w-full rounded-md border border-border-base bg-surface-inset-base p-2 text-14-regular text-text-base" type="number" min="1" max="16" value={state.concurrency} onInput={(event) => setState("concurrency", event.currentTarget.value)} /></label>
        </div>
        <div class="flex gap-2">
          <Button data-testid="workflow-start" variant="primary" disabled={state.pending} onClick={() => void run(start)}>{language.t("workflow.start")}</Button>
          <Button data-testid="workflow-validate" variant="secondary" disabled={state.pending} onClick={() => void run(validate)}>{language.t("workflow.validate")}</Button>
          <Button data-testid="workflow-refresh" variant="ghost" disabled={state.pending} onClick={() => void run(load)}>{language.t("workflow.refresh")}</Button>
        </div>
        <Show when={state.validation}>{(result) => <div data-testid="workflow-validation"><p>{language.t(result().valid ? "workflow.valid" : "workflow.invalid")}</p><For each={result().diagnostics}>{(diagnostic) => <p class="whitespace-pre-wrap">{diagnostic}</p>}</For></div>}</Show>
        <Show when={state.invalid}>{(key) => <p role="alert" class="text-text-critical-base">{language.t(key())}</p>}</Show>
        <Show when={state.error}><p role="alert" class="text-text-critical-base">{language.t("workflow.error")}</p></Show>
        <h3 class="text-14-medium text-text-strong">{language.t("workflow.runs")}</h3>
        <Show when={!state.runs.length}><p class="text-13-regular text-text-weak">{language.t("workflow.empty")}</p></Show>
        <For each={state.runs}>{(entry) => <section data-testid="workflow-run" data-status={entry.status} class="rounded-md border border-border-base p-3 space-y-2">
          <p class="text-14-medium">{entry.name} · {language.t(`workflow.status.${entry.status}`)}</p>
          <Show when={entry.phase}><p class="text-13-regular text-text-weak">{entry.phase}</p></Show>
          <p class="text-13-regular">{language.t("workflow.usage", { spent: entry.agentsSpent, budget: entry.agentBudget, tokens: entry.tokens })}</p>
          <Show when={entry.usageIncomplete}><p data-testid="workflow-usage-incomplete">{language.t("goal.usageIncomplete")}</p></Show>
          <Show when={entry.resumeBlockedReason}>{(reason) => <p data-testid="workflow-resume-blocked">{language.t(`workflow.resumeBlocked.${reason()}`)}</p>}</Show>
          <Show when={entry.message}><p class="whitespace-pre-wrap">{entry.message}</p></Show>
          <Show when={entry.status === "running" || entry.status === "pending"}><Button data-testid="workflow-pause" disabled={state.pending} onClick={() => void run(() => control(entry, "pause"))}>{language.t("workflow.pause")}</Button></Show>
          <Show when={!entry.resumeBlockedReason && (entry.status === "paused" || entry.status === "budget_limited")}>
            <label class="flex flex-col gap-1.5 text-13-medium">{language.t("workflow.resumeBudget")}<input data-testid="workflow-resume-budget" class="block w-full rounded-md border border-border-base bg-surface-inset-base p-2 text-14-regular text-text-base" type="number" min={entry.agentBudget} max="1024" value={state.budgets[entry.id] ?? entry.agentBudget} onInput={(event) => setState("budgets", entry.id, event.currentTarget.value)} /></label>
            <Button data-testid="workflow-resume" disabled={state.pending} onClick={() => void run(() => control(entry, "resume"))}>{language.t("workflow.resume")}</Button>
          </Show>
          <Show when={["pending", "running", "paused", "budget_limited"].includes(entry.status)}>
            <Show when={state.confirm === entry.id} fallback={<Button data-testid="workflow-stop" onClick={() => setState("confirm", entry.id)}>{language.t("workflow.stop")}</Button>}>
              <p>{language.t("workflow.confirmStop")}</p><Button data-testid="workflow-confirm-stop" disabled={state.pending} onClick={() => void run(() => control(entry, "stop"))}>{language.t("workflow.stop")}</Button><Button onClick={() => setState("confirm", undefined)}>{language.t("workflow.keep")}</Button>
            </Show>
          </Show>
          <Show when={entry.result !== undefined}><pre class="whitespace-pre-wrap break-words">{JSON.stringify(entry.result, null, 2)}</pre></Show>
          <Show when={entry.children.length}><details><summary>{language.t("workflow.children")}</summary><For each={entry.children}>{(id) => <Button variant="ghost" onClick={() => { dialog.close(); navigate(`/${params.dir}/session/${id}`) }}>{id}</Button>}</For></details></Show>
        </section>}</For>
      </div>
    </Dialog>
  )
}
