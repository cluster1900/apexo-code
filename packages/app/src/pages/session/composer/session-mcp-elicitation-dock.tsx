import { For, Match, Show, Switch, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { McpElicitationRequest } from "@apexo/sdk/v2/client"
import {
  elicitationContent,
  elicitationConstraints,
  elicitationDefaults,
  elicitationError,
  elicitationValue,
  selectedValues,
} from "@apexo/sdk/v2/mcp-elicitation"
import { DockPrompt } from "@apexo/session-ui/dock-prompt"
import { Button } from "@apexo/ui/button"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export function SessionMcpElicitationDock(props: { request: McpElicitationRequest; onSubmit: () => void }) {
  const sdk = useSDK()()
  const language = useLanguage()
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    values: elicitationDefaults(props.request),
    pending: false,
    error: false,
    field: "",
    now: Date.now(),
  })
  let root: HTMLFormElement | undefined
  const timer = setInterval(() => setState("now", Date.now()), 1000)
  onCleanup(() => {
    clearInterval(timer)
    lifetime.abort()
  })
  onMount(() => root?.querySelector<HTMLElement>("input,select,button")?.focus())
  const submit = async (action: "accept" | "decline" | "cancel") => {
    if (state.pending) return
    const parsed = action === "accept" ? elicitationContent(props.request, state.values) : undefined
    if (parsed?.invalid !== undefined) {
      setState({ error: true, field: parsed.invalid })
      return
    }
    setState({ pending: true, error: false, field: "" })
    await sdk.client.v2.mcpElicitation
      .reply(
        {
          sessionID: props.request.sessionID,
          requestID: props.request.id,
          action,
          ...(parsed?.content ? { content: parsed.content } : {}),
        },
        { signal: lifetime.signal, throwOnError: false },
      )
      .then((result) => {
        if (lifetime.signal.aborted) return
        if (result.response.ok || result.response.status === 404) {
          props.onSubmit()
          return
        }
        setState({ error: true, field: elicitationError(result.error).field ?? "" })
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  return (
    <form
      ref={root}
      noValidate
      data-component="session-mcp-elicitation-dock"
      data-request-id={props.request.id}
      onSubmit={(event) => {
        event.preventDefault()
        void submit("accept")
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          void submit("cancel")
        }
      }}
    >
      <DockPrompt
        kind="question"
        header={
          <div class="px-4 py-3 space-y-1">
            <strong>{language.t("mcpElicitation.from", { server: props.request.server })}</strong>
            <p class="whitespace-pre-wrap">{props.request.message}</p>
            <p class="text-12-regular">{language.t("mcpElicitation.noSecrets")}</p>
            <p data-field="elicitation-countdown">
              {language.t("mcpElicitation.remaining", {
                seconds: Math.max(0, Math.ceil((Number(props.request.deadlineAt) - state.now) / 1000)),
              })}
            </p>
          </div>
        }
        footer={
          <div class="flex gap-2 px-4 py-2">
            <Button type="submit" variant="primary" disabled={state.pending} data-action="elicitation-accept">
              {language.t("mcpElicitation.submit")}
            </Button>
            <Button
              type="button"
              disabled={state.pending}
              data-action="elicitation-decline"
              onClick={() => void submit("decline")}
            >
              {language.t("mcpElicitation.decline")}
            </Button>
            <Button
              type="button"
              disabled={state.pending}
              data-action="elicitation-cancel"
              onClick={() => void submit("cancel")}
            >
              {language.t("common.cancel")}
            </Button>
          </div>
        }
      >
        <div class="px-4 py-2 space-y-3 max-h-[45vh] overflow-y-auto">
          <For each={props.request.form.fields}>
            {(field) => {
              const id = `${props.request.id}-${field.name}`
              return (
                <div class="space-y-1" data-elicitation-field={field.name}>
                  <For each={elicitationConstraints(field)}>
                    {(hint) => (
                      <p class="text-12-regular">{language.t(`mcpElicitation.${hint.kind}`, { value: hint.value })}</p>
                    )}
                  </For>
                  <label for={id}>
                    {field.title}
                    {field.required ? " *" : ""}
                  </label>
                  <Show when={field.description}>
                    <p class="text-12-regular whitespace-pre-wrap">{field.description}</p>
                  </Show>
                  <Switch
                    fallback={
                      <input
                        id={id}
                        class="w-full rounded border px-2 py-1"
                        disabled={state.pending}
                        value={String(elicitationValue(state.values, field.name) ?? "")}
                        type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                        step={field.type === "integer" ? 1 : "any"}
                        aria-invalid={state.field === field.name}
                        onInput={(event) => setState("values", field.name, event.currentTarget.value)}
                      />
                    }
                  >
                    <Match when={field.type === "boolean"}>
                      <input
                        id={id}
                        type="checkbox"
                        disabled={state.pending}
                        checked={elicitationValue(state.values, field.name) === true}
                        onChange={(event) => setState("values", field.name, event.currentTarget.checked)}
                      />
                    </Match>
                    <Match when={field.type === "select"}>
                      <select
                        id={id}
                        class="w-full rounded border px-2 py-1"
                        disabled={state.pending}
                        value={
                          field.type === "select" &&
                          field.options.some((option) => option.value === elicitationValue(state.values, field.name))
                            ? String(
                                field.options.findIndex(
                                  (option) => option.value === elicitationValue(state.values, field.name),
                                ),
                              )
                            : ""
                        }
                        aria-invalid={state.field === field.name}
                        onChange={(event) => {
                          const option =
                            field.type === "select" ? field.options[Number(event.currentTarget.value)] : undefined
                          if (option) setState("values", field.name, option.value)
                        }}
                      >
                        <option value="" disabled>
                          {language.t("mcpElicitation.choose")}
                        </option>
                        <For each={field.type === "select" ? field.options : []}>
                          {(option, index) => <option value={String(index())}>{option.title}</option>}
                        </For>
                      </select>
                    </Match>
                    <Match when={field.type === "multi"}>
                      <div
                        id={id}
                        role="group"
                        class="flex flex-wrap gap-3"
                        aria-label={field.title}
                        aria-invalid={state.field === field.name}
                      >
                        <For each={field.type === "multi" ? field.options : []}>
                          {(option) => (
                            <label class="flex items-center gap-1">
                              <input
                                type="checkbox"
                                disabled={state.pending}
                                checked={selectedValues(elicitationValue(state.values, field.name)).includes(
                                  option.value,
                                )}
                                onChange={(event) => {
                                  const values = selectedValues(elicitationValue(state.values, field.name))
                                  setState(
                                    "values",
                                    field.name,
                                    event.currentTarget.checked
                                      ? [...values, option.value]
                                      : values.filter((value) => value !== option.value),
                                  )
                                }}
                              />
                              {option.title}
                            </label>
                          )}
                        </For>
                      </div>
                    </Match>
                  </Switch>
                  <Show when={state.error && state.field === field.name}>
                    <p role="alert">{language.t("mcpElicitation.validation")}</p>
                  </Show>
                </div>
              )
            }}
          </For>
          <Show when={state.error && !state.field}>
            <p role="alert">{language.t("mcpElicitation.error")}</p>
          </Show>
        </div>
      </DockPrompt>
    </form>
  )
}
