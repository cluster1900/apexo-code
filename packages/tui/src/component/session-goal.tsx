/** @jsxImportSource @opentui/solid */
import { parseGoalCommand } from "@apexo/sdk/v2/goal-command"
import { useKeyboard } from "@opentui/solid"
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core"
import { For, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { ApexoClient, GoalInfo, GoalStart, GoalReportFileKey } from "@apexo/sdk/v2/client"
import { useBindings } from "../keymap"
import { GoalReports } from "./goal-reports"
import { serverProtocol } from "../util/server-protocol"

export function goalActions(
  client: ApexoClient,
  session: () => Promise<string>,
  selection: () => GoalStart | undefined | Promise<GoalStart | undefined>,
  selected?: (signal: AbortSignal) => Promise<"native" | "compatibility">,
) {
  const detect = serverProtocol(client)
  const protocol =
    selected ?? (async (signal: AbortSignal) => ((await detect(signal)) === "v2" ? "native" : "compatibility"))
  const api = async (signal: AbortSignal) => ((await protocol(signal)) === "native" ? client.v2.goal : client.goal)
  return {
    reports: async (goalID: string, signal: AbortSignal) =>
      (await (await api(signal)).reports({ sessionID: await session(), goalID }, { throwOnError: true, signal })).data,
    report: async (goalID: string, reportID: string, file: GoalReportFileKey, signal: AbortSignal) =>
      (
        await (
          await api(signal)
        ).report({ sessionID: await session(), goalID, reportID, file }, { throwOnError: true, signal })
      ).data,
    cleanupReports: async (goalID: string, signal: AbortSignal) =>
      (await (await api(signal)).cleanupReports({ sessionID: await session(), goalID }, { throwOnError: true, signal }))
        .data,
    get: async (signal: AbortSignal) =>
      (await (await api(signal)).get({ sessionID: await session() }, { throwOnError: true, signal })).data,
    create: async (id: string, objective: string, tokenBudget: number | undefined, signal: AbortSignal) => {
      const selected = await selection()
      if (!selected) throw new Error("Select a model before starting a goal")
      const sessionID = await session()
      await (
        await api(signal)
      ).create({ sessionID, goalCreate: { id, objective, tokenBudget } }, { throwOnError: true, signal })
      return (
        await (await api(signal)).start({ sessionID, goalID: id, goalStart: selected }, { throwOnError: true, signal })
      ).data
    },
    control: async (goalID: string, action: "start" | "pause" | "resume" | "clear", signal: AbortSignal) => {
      const target = { sessionID: await session(), goalID }
      const options = { throwOnError: true as const, signal }
      if (action === "clear") {
        await (await api(signal)).clear(target, options)
        return null
      }
      if (action !== "start") return (await (await api(signal))[action](target, options)).data
      const current = (await (await api(signal)).get(target, options)).data
      const selected = current?.launch ?? (await selection())
      return selected
        ? (await (await api(signal)).start({ ...target, goalStart: selected }, options)).data
        : (await (await api(signal)).run(target, options)).data
    },
  }
}
export type GoalActions = ReturnType<typeof goalActions>

export function SessionGoal(props: {
  actions: GoalActions
  objective?: string
  onClose: () => void
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
}) {
  const abort = new AbortController()
  const intent = props.objective?.trim()
  const parsed = parseGoalCommand(intent)
  const operation = parsed.type === "operation" ? parsed.operation : undefined
  // `/goal <objective> [--budget N]` starts immediately, like Grok Build; the form is only a fallback.
  const autoCreate = parsed.type === "create"
  const [state, setState] = createStore({
    info: undefined as GoalInfo | null | undefined,
    objective: parsed.type === "create" || parsed.type === "invalid" ? parsed.objective : "",
    budget: parsed.type === "create" && parsed.tokenBudget ? String(parsed.tokenBudget) : "",
    field: "objective",
    pending: false,
    error: parsed.type === "invalid" ? "Enter an objective and an optional positive integer token budget" : "",
    confirm: false,
    reports: false,
    id: `goal_${crypto.randomUUID().replaceAll("-", "")}`,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  let progress: ScrollBoxRenderable | undefined
  const requests = { revision: 0, handled: false }
  const refresh = async () => {
    const revision = requests.revision
    await props.actions
      .get(abort.signal)
      .then((info) => {
        if (abort.signal.aborted || state.pending || revision !== requests.revision) return
        setState("info", reconcile(info, { key: "callID" }))
        if ((!operation && !autoCreate) || requests.handled) return
        requests.handled = true
        if (autoCreate) {
          if (!info) void run("create")
          return
        }
        if (!info || operation === "status") return
        if (operation === "clear") {
          setState("confirm", true)
          return
        }
        if (operation) void run(operation)
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", "Could not read the goal")
      })
      .finally(() => {
        if (!abort.signal.aborted)
          timer = setTimeout(
            refresh,
            state.info?.status === "active" || state.info?.summary?.status === "running" ? 500 : 2000,
          )
      })
  }
  const run = async (action: "create" | "start" | "pause" | "resume" | "clear") => {
    if (state.pending || state.info === undefined) return
    if (
      action === "create" &&
      (!state.objective.trim() ||
        state.objective.length > 32768 ||
        (state.budget && (!/^[1-9]\d*$/.test(state.budget) || !Number.isSafeInteger(Number(state.budget)))))
    ) {
      setState("error", "Enter an objective and an optional positive integer token budget")
      return
    }
    requests.revision++
    setState({ pending: true, error: "" })
    await (
      action === "create"
        ? props.actions.create(
            state.id,
            state.objective.trim(),
            state.budget ? Number(state.budget) : undefined,
            abort.signal,
          )
        : state.info
          ? props.actions.control(state.info.id, action, abort.signal)
          : Promise.resolve(null)
    )
      .then((info) => {
        if (!abort.signal.aborted)
          setState({
            info,
            confirm: false,
            ...(action === "clear" ? { id: `goal_${crypto.randomUUID().replaceAll("-", "")}` } : {}),
          })
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setState("error", "Could not update the goal. Check the connection and session status, then retry.")
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => void refresh())
  onCleanup(() => {
    abort.abort()
    clearTimeout(timer)
  })
  useBindings(() => ({
    priority: 1,
    bindings: [
      {
        key: "escape",
        desc: "Close goal",
        group: "Goal",
        cmd: () => (state.confirm ? setState("confirm", false) : props.onClose()),
      },
    ],
  }))
  useBindings(() => ({
    priority: 1,
    enabled: !!state.info && !state.pending && !state.reports && !state.confirm,
    // Capture before fullscreen Session navigation, whose commands clear dialogs.
    bindings: ["up", "down", "pageup", "pagedown", "home", "end"].map((key) => ({
      key,
      desc: "Scroll goal status",
      group: "Goal",
      cmd: () => {
        if (!progress) return
        if (key === "home") return progress.scrollTo(0)
        if (key === "end") return progress.scrollTo(progress.scrollHeight)
        const direction = key === "up" || key === "pageup" ? -1 : 1
        return progress.scrollBy(direction * (key.startsWith("page") ? progress.height : 1))
      },
    })),
  }))
  useKeyboard((key) => {
    if (key.ctrl || key.meta || state.pending || state.reports) return
    if (!state.info) {
      if (key.name === "tab") {
        key.preventDefault()
        setState("field", state.field === "objective" ? "budget" : "objective")
      }
      return
    }
    if (state.confirm) {
      if (key.name === "y") {
        key.preventDefault()
        void run("clear")
      }
      if (key.name === "n") {
        key.preventDefault()
        setState("confirm", false)
      }
      return
    }
    if (key.name === "x") {
      key.preventDefault()
      setState("confirm", true)
    }
    if (key.name === "f") {
      key.preventDefault()
      setState("reports", true)
    }
    if (key.name === "p" && state.info.status === "active") {
      key.preventDefault()
      void run("pause")
    }
    if (key.name === "r" && !["active", "complete", "budget_limited"].includes(state.info.status)) {
      key.preventDefault()
      void run("resume")
    }
    if (
      key.name === "s" &&
      state.info.status === "active" &&
      state.info.phase === "idle" &&
      state.info.workerRounds === 0
    ) {
      key.preventDefault()
      void run("start")
    }
  })
  return (
    <box height={16} width="100%" flexDirection="column">
      <Show
        when={state.reports && state.info?.id}
        keyed
        fallback={
          <box height={16} width="100%" flexDirection="column" gap={1}>
            <text fg={props.theme().text}>Goal · s start · p pause · r resume · f reports · x clear · esc close</text>
            <text fg={props.theme().muted}>Closing this panel does not pause the goal.</text>
            <Show when={state.info !== undefined} fallback={<text>Loading…</text>}>
              <Show
                when={state.info}
                fallback={
                  <box flexDirection="column" gap={1}>
                    <text fg={props.theme().text}>Objective · Tab switches fields · Enter creates and starts</text>
                    <input
                      placeholder="Describe the complete objective"
                      value={state.objective}
                      focused={state.field === "objective" && !state.pending}
                      onInput={(value) => setState("objective", value)}
                      onSubmit={() => void run("create")}
                    />
                    <text fg={props.theme().muted}>Token budget (empty means unlimited)</text>
                    <input
                      placeholder="Unlimited"
                      value={state.budget}
                      focused={state.field === "budget" && !state.pending}
                      onInput={(value) => setState("budget", value)}
                      onSubmit={() => void run("create")}
                    />
                  </box>
                }
              >
                {(info) => (
                  <scrollbox height={9} ref={(element) => (progress = element)}>
                    <text fg={props.theme().highlight}>{`${info().status} · ${info().phase}`}</text>
                    <text fg={props.theme().text} wrapMode="word">
                      {info().objective}
                    </text>
                    <text
                      fg={props.theme().muted}
                    >{`Tokens: ${info().tokensUsed} / ${info().tokenBudget ?? "unlimited"}`}</text>
                    <Show when={info().usageIncomplete}>
                      <text>Recorded usage is a lower bound.</text>
                    </Show>
                    <Show when={info().summary?.reason !== "disabled" && info().summary}>
                      {(summary) => (
                        <box flexDirection="column">
                          <text fg={props.theme().highlight}>Completion summary</text>
                          <text fg={props.theme().text} wrapMode="word">
                            {summary().text ??
                              (summary().status === "running"
                                ? "Preparing the completion summary…"
                                : summary().reason === "budget"
                                  ? "No token budget remains for a completion summary."
                                  : "The goal is complete. A completion summary is unavailable.")}
                          </text>
                        </box>
                      )}
                    </Show>
                    <Show when={info().planProgress}>
                      {(progress) => (
                        <box flexDirection="column">
                          <text fg={props.theme().highlight}>Plan progress</text>
                          <text fg={props.theme().muted} wrapMode="word">
                            Goal completion requires independent verification.
                          </text>
                          <For each={progress().completed}>
                            {(ordinal) => <text wrapMode="word">{`Task ${ordinal + 1} complete`}</text>}
                          </For>
                          <Show when={progress().deviations.length}>
                            <text fg={props.theme().highlight}>Plan changes</text>
                            <For each={progress().deviations}>
                              {(deviation) => <text wrapMode="word">{deviation}</text>}
                            </For>
                          </Show>
                        </box>
                      )}
                    </Show>
                    <Show when={info().verification}>
                      {(panel) => (
                        <>
                          <text
                            fg={props.theme().highlight}
                          >{`Verification round ${panel().round} · ${panel().results.length}/${panel().count} reports`}</text>
                          <For each={panel().results}>
                            {(result) => (
                              <>
                                <text wrapMode="word">{`Verifier ${result.index + 1}: ${result.achieved ? "confirmed" : "unmet requirements"} · ${result.tokensUsed} tokens`}</text>
                                <text wrapMode="word">{result.evidence}</text>
                                <For each={result.unmet}>{(item) => <text wrapMode="word">{item}</text>}</For>
                              </>
                            )}
                          </For>
                        </>
                      )}
                    </Show>
                    <Show when={info().message}>
                      <text wrapMode="word">{info().message}</text>
                    </Show>
                    <Show when={info().evaluation}>
                      <text wrapMode="word">{info().evaluation?.next_step}</text>
                    </Show>
                    <Show when={info().unmet.length}>
                      <text wrapMode="word">{info().unmet.join("\n")}</text>
                    </Show>
                  </scrollbox>
                )}
              </Show>
            </Show>
            <Show when={state.confirm}>
              <text fg={props.theme().error}>
                Stop and clear this goal and delete its private reports and scratch files? Conversation messages and
                project files are kept. y confirm · n cancel
              </text>
            </Show>
            <Show when={state.error}>
              <text fg={props.theme().error} wrapMode="word">
                {state.error}
              </text>
            </Show>
          </box>
        }
      >
        {(goalID) => (
          <GoalReports
            goalID={goalID}
            canCleanup={["complete", "budget_limited"].includes(state.info?.status ?? "")}
            actions={props.actions}
            theme={props.theme}
            onClose={() => setState("reports", false)}
          />
        )}
      </Show>
    </box>
  )
}
