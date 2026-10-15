import { createSignal, onCleanup, Show } from "solid-js"
import { taskMessageDraft } from "@apexo/sdk/v2/task-message"
import type { ApexoClient } from "@apexo/sdk/v2/client"
import { Button } from "@apexo/ui/button"
import { useLanguage } from "@/context/language"
import type { TaskItem } from "@/utils/session-tasks"

export function TaskMessage(props: { client: ApexoClient; task: TaskItem }) {
  const language = useLanguage()
  const available = () => props.task.status === "running" || props.task.status === "completed"
  const draft = taskMessageDraft(props.client, props.task.sessionID, props.task.id, props.task.started_at)
  const [state, setState] = createSignal(draft?.state())
  const abort = new AbortController()
  const unsubscribe = draft?.subscribe(setState)
  const refresh = () => draft?.refresh(AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]))
  const timer = setInterval(() => void refresh(), 2_000)
  void refresh()
  onCleanup(() => {
    abort.abort()
    clearInterval(timer)
    unsubscribe?.()
  })
  return (
    <div class="flex flex-col gap-2 border-t border-border-weak-base pt-3" data-component="task-message">
      <h3>{language.t("tasks.message.title")}</h3>
      <p class="text-12-mono break-all">
        {props.task.title || props.task.id} · {props.task.id}
      </p>
      <p class="text-12-regular text-text-weak">{language.t("tasks.message.hint")}</p>
      <Show when={state()} fallback={<p role="alert">{language.t("tasks.message.limit")}</p>}>
        {(current) => (
          <>
            <label class="flex flex-col gap-1">
              {language.t("tasks.message.text")}
              <textarea
                data-task-message-text
                class="min-h-24 rounded-md border border-border-base bg-background-base p-2 text-14-regular disabled:opacity-70"
                value={current().text}
                disabled={!!current().input || current().pending || !available()}
                onInput={(event) => draft?.edit(event.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1">
              {language.t("tasks.message.delivery")}
              <select
                data-task-message-delivery
                class="rounded-md border border-border-base bg-background-base p-2"
                value={current().delivery}
                disabled={!!current().input || current().pending || !available()}
                onChange={(event) => {
                  const delivery = event.currentTarget.value
                  if (delivery === "steer" || delivery === "queue" || delivery === "interject")
                    draft?.edit(current().text, delivery)
                }}
              >
                <option value="steer">{language.t("tasks.message.steer")}</option>
                <option value="queue">{language.t("tasks.message.queue")}</option>
                <option value="interject">{language.t("tasks.message.interject")}</option>
              </select>
            </label>
            <p class="text-12-regular text-text-weak">{language.t(`tasks.message.${current().delivery}Hint`)}</p>
            <Show when={current().input}>
              {(input) => (
                <p class="text-12-mono break-all" data-task-message-id>
                  {input().inputID}
                </p>
              )}
            </Show>
            <Show when={current().receipt}>
              {(receipt) => (
                <p role="status" data-task-message-receipt={receipt().status}>
                  {language.t(`tasks.message.${receipt().status}`)}
                </p>
              )}
            </Show>
            <Show when={current().issue}>
              {(issue) => (
                <p role="alert" data-task-message-error={issue()}>
                  {language.t(`tasks.message.error.${issue()}`)}
                </p>
              )}
            </Show>
            <Show when={!available()}>
              <p>{language.t("tasks.message.closed")}</p>
            </Show>
            <div class="flex flex-wrap gap-2">
              <Button
                size="small"
                variant="secondary"
                data-action="task-message-send"
                disabled={current().pending || !!current().receipt || !available() || !current().text.trim()}
                onClick={() => void draft?.send(AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]))}
              >
                {language.t(
                  current().pending
                    ? "tasks.message.sending"
                    : current().receipt
                      ? "tasks.message.sent"
                      : current().input
                        ? "tasks.message.retry"
                        : "tasks.message.send",
                )}
              </Button>
              <Show when={current().input}>
                <Button
                  size="small"
                  variant="ghost"
                  data-action="task-message-refresh"
                  disabled={current().pending}
                  onClick={() => void refresh()}
                >
                  {language.t("tasks.message.refresh")}
                </Button>
              </Show>
              <Show when={current().receipt && available()}>
                <Button
                  size="small"
                  variant="ghost"
                  data-action="task-message-next"
                  disabled={current().pending}
                  onClick={() => draft?.next()}
                >
                  {language.t("tasks.message.next")}
                </Button>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
