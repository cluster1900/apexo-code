import { createEffect, For, lazy, onCleanup, Show, Suspense } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { GoalInfo, GoalStart } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

const GoalReports = lazy(() => import("./goal-reports"))

export function createSessionGoal(sessionID: () => string | undefined, selection: () => GoalStart | undefined) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()
  const show = (id: string, objective = "", selected = selection()) => {
    dialog.show(() => <SessionGoalDialog sessionID={id} objective={objective} selection={selected} />)
    return true
  }
  const open = () => {
    const id = sessionID()
    if (id) show(id)
  }
  command.register("session-goal", () => [
    {
      id: "session.goal",
      title: language.t("goal.title"),
      slash: "goal",
      disabled: !sessionID(),
      onSelect: open,
    },
  ])
  return { available: () => !!sessionID(), open, show }
}

export function GoalButton(props: { goal: ReturnType<typeof createSessionGoal> }) {
  const language = useLanguage()
  return (
    <Show when={props.goal.available()}>
      <Button data-action="session-goal" size="small" variant="ghost" onClick={props.goal.open}>
        {language.t("goal.title")}
      </Button>
    </Show>
  )
}

export function SessionGoalDialog(props: { sessionID: string; objective?: string; selection?: GoalStart }) {
  const sdk = useSDK()()
  const api = sdk.protocol.then((protocol) => (protocol === "v2" ? sdk.client.v2.goal : sdk.client.goal))
  const language = useLanguage()
  const dialog = useDialog()
  const lifetime = new AbortController()
  const options = { throwOnError: true as const, signal: lifetime.signal }
  const intent = props.objective?.trim()
  const control = { handled: false }
  const operation =
    intent === "pause" || intent === "resume" || intent === "clear" || intent === "status" ? intent : undefined
  const [state, setState] = createStore({
    info: undefined as GoalInfo | null | undefined,
    objective: operation ? "" : (props.objective ?? ""),
    budget: "",
    pending: false,
    error: false,
    confirm: false,
    reports: false,
    reload: 0,
    id: `goal_${crypto.randomUUID().replaceAll("-", "")}`,
  })
  onCleanup(() => lifetime.abort())
  createEffect(() => {
    state.reload
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      await (
        await api
      )
        .get({ sessionID: props.sessionID }, { throwOnError: true, signal: abort.signal })
        .then((result) => {
          if (abort.signal.aborted || state.pending) return
          // Keep report elements stable so polling preserves expansion and scroll position.
          setState("info", reconcile(result.data, { key: "callID" }))
          if (!operation || control.handled) return
          control.handled = true
          if (!result.data || operation === "status") return
          if (operation === "clear") {
            setState("confirm", true)
            return
          }
          void run(operation)
        })
        .catch(() => {
          if (!abort.signal.aborted) setState("error", true)
        })
        .finally(() => {
          if (!abort.signal.aborted)
            timer = setTimeout(
              refresh,
              state.info?.status === "active" || state.info?.summary?.status === "running" ? 500 : 2000,
            )
        })
    }
    void refresh()
    onCleanup(() => {
      abort.abort()
      clearTimeout(timer)
    })
  })
  const validBudget = () =>
    !state.budget || (/^[1-9]\d*$/.test(state.budget) && Number.isSafeInteger(Number(state.budget)))
  const run = async (action: "create" | "start" | "pause" | "resume" | "clear") => {
    if (state.pending) return
    setState({ pending: true, error: false })
    await (async () => {
      if (action === "create") {
        if (!props.selection || !state.objective.trim() || !validBudget()) return
        const created = await (
          await api
        ).create(
          {
            sessionID: props.sessionID,
            goalCreate: {
              id: state.id,
              objective: state.objective.trim(),
              ...(state.budget ? { tokenBudget: Number(state.budget) } : {}),
            },
          },
          options,
        )
        if (lifetime.signal.aborted) return
        setState("info", created.data)
      }
      const info = state.info
      if (!info) return
      const target = { sessionID: props.sessionID, goalID: info.id }
      if (action === "clear") {
        await (await api).clear(target, options)
        if (!lifetime.signal.aborted)
          setState({ info: null, confirm: false, id: `goal_${crypto.randomUUID().replaceAll("-", "")}` })
        return
      }
      const selected = info.launch ?? props.selection
      const result =
        action === "create" || action === "start"
          ? selected
            ? await (await api).start({ ...target, goalStart: selected }, options)
            : await (await api).run(target, options)
          : await (await api)[action](target, options)
      if (!lifetime.signal.aborted) setState("info", reconcile(result.data, { key: "callID" }))
    })()
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (lifetime.signal.aborted) return
        setState("pending", false)
        setState("reload", (value) => value + 1)
      })
  }
  return (
    <Dialog title={language.t("goal.title")} size="large" class="h-full">
      <div data-component="session-goal" class="flex flex-1 flex-col gap-4 px-6 pb-6 min-h-0 overflow-y-auto">
        <Show when={state.error}>
          <p role="alert" class="text-text-critical-base">
            {language.t("goal.error")}
          </p>
        </Show>
        <Show when={state.info !== undefined} fallback={<p>{language.t("common.loading")}</p>}>
          <Show
            when={state.info}
            fallback={
              <form
                class="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run("create")
                }}
              >
                <label class="flex flex-col gap-2">
                  {language.t("goal.objective")}
                  <textarea
                    data-field="goal-objective"
                    class="min-h-28 rounded-md border border-border-base p-3"
                    maxLength={32768}
                    value={state.objective}
                    disabled={state.pending}
                    onInput={(event) => setState("objective", event.currentTarget.value)}
                  />
                </label>
                <label class="flex flex-col gap-2">
                  {language.t("goal.budget")}
                  <input
                    data-field="goal-budget"
                    class="rounded-md border border-border-base p-2"
                    inputMode="numeric"
                    value={state.budget}
                    disabled={state.pending}
                    onInput={(event) => setState("budget", event.currentTarget.value)}
                    placeholder={language.t("goal.unlimited")}
                  />
                </label>
                <Show when={!validBudget()}>
                  <p role="alert">{language.t("goal.invalidBudget")}</p>
                </Show>
                <Show when={!props.selection}>
                  <p>{language.t("goal.selectModel")}</p>
                </Show>
                <p class="text-text-weak">{language.t("goal.createHint")}</p>
                <Button
                  data-action="goal-create"
                  type="submit"
                  disabled={state.pending || !props.selection || !state.objective.trim() || !validBudget()}
                >
                  {language.t("goal.create")}
                </Button>
              </form>
            }
          >
            {(info) => (
              <>
                <p class="whitespace-pre-wrap break-words">{info().objective}</p>
                <div role="status" class="flex flex-wrap gap-3">
                  <span data-goal-status={info().status}>{language.t(`goal.status.${info().status}`)}</span>
                  <Show when={info().status === "active"}>
                    <span>{language.t(`goal.phase.${info().phase}`)}</span>
                  </Show>
                </div>
                <p>
                  {language.t("goal.usage", {
                    used: info().tokensUsed,
                    budget: info().tokenBudget ?? language.t("goal.unlimited"),
                  })}
                </p>
                <Show when={info().usageIncomplete}>
                  <p>{language.t("goal.usageIncomplete")}</p>
                </Show>
                <Show when={info().summary?.reason !== "disabled" && info().summary}>
                  {(summary) => (
                    <section
                      data-component="goal-summary"
                      data-summary-status={summary().status}
                      class="flex flex-col gap-2"
                    >
                      <h3 class="text-14-medium">{language.t("goal.summary")}</h3>
                      <p class="whitespace-pre-wrap break-words">
                        {summary().text ??
                          language.t(
                            summary().status === "running"
                              ? "goal.summaryPreparing"
                              : summary().reason === "budget"
                                ? "goal.summaryBudget"
                                : "goal.summaryUnavailable",
                          )}
                      </p>
                    </section>
                  )}
                </Show>
                <Show when={info().message && !["user_paused", "budget_limited"].includes(info().status)}>
                  <details open={info().status !== "complete"}>
                    <summary>{language.t("goal.details")}</summary>
                    <p class="whitespace-pre-wrap break-words">{info().message}</p>
                  </details>
                </Show>
                <Show when={info().plan}>
                  <details>
                    <summary>{language.t("goal.plan")}</summary>
                    <p class="whitespace-pre-wrap break-words">{info().plan}</p>
                  </details>
                </Show>
                <Show when={info().planProgress}>
                  {(progress) => (
                    <section data-component="goal-plan-progress" class="flex flex-col gap-2">
                      <h3 class="text-14-medium">{language.t("goal.planProgress")}</h3>
                      <p class="text-text-weak">{language.t("goal.planProgressHint")}</p>
                      <For each={progress().completed}>
                        {(ordinal) => <p>{language.t("goal.planTaskComplete", { number: ordinal + 1 })}</p>}
                      </For>
                      <Show when={progress().deviations.length}>
                        <h4 class="text-14-medium">{language.t("goal.planDeviations")}</h4>
                        <For each={progress().deviations}>
                          {(deviation) => <p class="whitespace-pre-wrap break-words">{deviation}</p>}
                        </For>
                      </Show>
                    </section>
                  )}
                </Show>
                <Button
                  data-action="goal-reports-open"
                  size="small"
                  variant="ghost"
                  onClick={() => setState("reports", (value) => !value)}
                >
                  {language.t("goal.reports")}
                </Button>
                <Show when={state.reports && info().id} keyed>
                  {(goalID) => (
                    <Suspense>
                      <GoalReports
                        api={api}
                        sessionID={props.sessionID}
                        goalID={goalID}
                        canCleanup={["complete", "budget_limited"].includes(info().status)}
                      />
                    </Suspense>
                  )}
                </Show>
                <Show when={info().evaluation}>
                  {(evaluation) => (
                    <details open>
                      <summary>{language.t("goal.evaluation")}</summary>
                      <p class="whitespace-pre-wrap break-words">{evaluation().evidence}</p>
                      <p class="whitespace-pre-wrap break-words">{evaluation().next_step}</p>
                    </details>
                  )}
                </Show>
                <Show when={info().verification}>
                  {(panel) => (
                    <section data-component="goal-verification" class="flex flex-col gap-3">
                      <h3>
                        {language.t("goal.panel", {
                          received: panel().results.length,
                          total: panel().count,
                          round: panel().round,
                        })}
                      </h3>
                      <For each={panel().results}>
                        {(result) => (
                          <details data-verifier={result.index}>
                            <summary>
                              {language.t("goal.reviewer", { index: result.index + 1 })} ·{" "}
                              {language.t(result.achieved ? "goal.reviewPassed" : "goal.reviewRejected")}
                            </summary>
                            <p>{language.t("goal.reviewerUsage", { used: result.tokensUsed })}</p>
                            <p class="whitespace-pre-wrap break-words">{result.evidence}</p>
                            <For each={result.unmet}>
                              {(item) => <p class="whitespace-pre-wrap break-words">{item}</p>}
                            </For>
                          </details>
                        )}
                      </For>
                    </section>
                  )}
                </Show>
                <Show when={info().unmet.length}>
                  <div>
                    <h3>{language.t("goal.unmet")}</h3>
                    <ul class="list-disc ps-5">
                      <For each={info().unmet}>{(item) => <li class="whitespace-pre-wrap break-words">{item}</li>}</For>
                    </ul>
                  </div>
                </Show>
                <div class="flex flex-wrap gap-2">
                  <Show when={info().status === "active" && info().phase === "idle" && info().workerRounds === 0}>
                    <Button data-action="goal-start" disabled={state.pending} onClick={() => void run("start")}>
                      {language.t("goal.start")}
                    </Button>
                  </Show>
                  <Show when={info().status === "active"}>
                    <Button data-action="goal-pause" disabled={state.pending} onClick={() => void run("pause")}>
                      {language.t("goal.pause")}
                    </Button>
                  </Show>
                  <Show when={!["active", "complete", "budget_limited"].includes(info().status)}>
                    <Button data-action="goal-resume" disabled={state.pending} onClick={() => void run("resume")}>
                      {language.t("goal.resume")}
                    </Button>
                  </Show>
                  <Button
                    data-action="goal-clear"
                    variant="ghost"
                    disabled={state.pending}
                    onClick={() => setState("confirm", true)}
                  >
                    {language.t("goal.clear")}
                  </Button>
                </div>
                <Show when={state.confirm}>
                  <div role="alert" class="flex flex-col gap-2">
                    <p>{language.t("goal.clearReportsConfirm")}</p>
                    <div class="flex gap-2">
                      <Button
                        data-action="goal-clear-confirm"
                        disabled={state.pending}
                        onClick={() => void run("clear")}
                      >
                        {language.t("goal.clear")}
                      </Button>
                      <Button variant="ghost" disabled={state.pending} onClick={() => setState("confirm", false)}>
                        {language.t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </Show>
        <p class="text-text-weak">{language.t("goal.closeHint")}</p>
        <Button variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      </div>
    </Dialog>
  )
}
