import { createEffect, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createMcpAttachmentOperation,
  type McpAttachmentRequest,
  type McpAttachmentResult,
} from "@apexo/sdk/v2/mcp-attachment"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"

type Template = NonNullable<McpAttachmentResult["catalog"]>["templates"][number]
export function McpAttachmentPicker(props: {
  sessionID: string
  active: () => boolean
  attach: (prepared: NonNullable<McpAttachmentResult["prepared"]>) => void
}) {
  const sdk = useSDK()()
  const language = useLanguage()
  const [state, setState] = createStore({
    catalog: undefined as McpAttachmentResult["catalog"],
    template: undefined as Template | undefined,
    parameters: {} as Record<string, string>,
    pending: false,
    cancelling: false,
    error: "",
    attached: false,
  })
  let mounted = true
  let operation: ReturnType<typeof createMcpAttachmentOperation> | undefined
  const active = () => mounted && props.active()
  const cancel = async () => {
    const current = operation
    if (!current) return
    if (mounted) setState("cancelling", true)
    const joined = await current.cancel().then(
      () => true,
      () => {
        if (mounted) setState("error", language.t("mcp.resources.cancelError"))
        else
          showToast({
            title: language.t("mcp.resources.title"),
            description: language.t("mcp.resources.cancelError"),
            variant: "error",
          })
        return false
      },
    )
    if (joined && operation === current) operation = undefined
    if (mounted) setState({ pending: !joined, cancelling: false })
  }

  const run = async (request: McpAttachmentRequest) => {
    if (!active() || state.pending || state.cancelling) return
    const current = createMcpAttachmentOperation(sdk.client, props.sessionID)
    operation = current
    setState({ pending: true, error: "", attached: false })
    await current
      .run(request)
      .then((result) => {
        if (!active() || operation !== current || !result) return
        if (result.catalog) setState("catalog", result.catalog)
        if (result.prepared) {
          props.attach(result.prepared)
          setState("attached", true)
        }
      })
      .catch((error) => {
        if (active() && operation === current)
          setState("error", error instanceof Error ? error.message : language.t("mcp.resources.error"))
      })
      .finally(() => {
        if (operation === current && !current.cancelled) {
          operation = undefined
          if (mounted) setState("pending", false)
        }
      })
  }
  createEffect(() => {
    if (!props.active()) void cancel()
  })
  onMount(() => void run({ kind: "catalog", input: {} }))
  onCleanup(() => {
    mounted = false
    void cancel()
  })
  return (
    <Dialog title={language.t("mcp.resources.title")} size="large">
      <div data-component="mcp-resource-picker" class="max-h-[65vh] overflow-y-auto px-6 pb-6 space-y-3">
        <p>{language.t("mcp.resources.description")}</p>
        <Button
          data-action="mcp-resources-refresh"
          disabled={state.pending || !props.active()}
          onClick={() => void run({ kind: "catalog", input: {} })}
        >
          {language.t("mcp.resources.refresh")}
        </Button>
        <Show when={state.pending}>
          <p role="status">{language.t(state.cancelling ? "mcp.resources.cancelling" : "mcp.resources.loading")}</p>
          <Button data-action="mcp-resources-cancel" disabled={state.cancelling} onClick={() => void cancel()}>
            {language.t("common.cancel")}
          </Button>
        </Show>
        <Show when={!props.active()}>
          <p role="alert">{language.t("mcp.resources.changed")}</p>
        </Show>
        <Show when={state.error}>
          <p role="alert">{state.error}</p>
        </Show>
        <Show when={state.attached}>
          <p role="status">{language.t("mcp.resources.attached")}</p>
        </Show>
        <For each={state.catalog?.errors}>
          {(error) => (
            <p role="alert">
              {error.server}: {error.message}
            </p>
          )}
        </For>
        <Show when={state.catalog && !state.catalog.resources.length && !state.catalog.templates.length}>
          <p>{language.t("mcp.resources.empty")}</p>
        </Show>
        <For each={state.catalog?.resources}>
          {(resource) => (
            <section class="border border-border-base rounded-md p-3">
              <p>
                {resource.title ?? resource.name} · {resource.server}
              </p>
              <p class="text-12-regular break-all">{resource.uri}</p>
              <p>{resource.description}</p>
              <Button
                data-action="mcp-resource-attach"
                disabled={state.pending || !props.active()}
                onClick={() =>
                  void run({ kind: "prepare", input: { kind: "resource", server: resource.server, uri: resource.uri } })
                }
              >
                {language.t("mcp.resources.attach")}
              </Button>
            </section>
          )}
        </For>
        <For each={state.catalog?.templates}>
          {(template) => (
            <section class="border border-border-base rounded-md p-3">
              <p>
                {template.title ?? template.name} · {template.server}
              </p>
              <p class="text-12-regular break-all">{template.uriTemplate}</p>
              <p>{template.description}</p>
              <Button
                data-action="mcp-template-select"
                disabled={state.pending || !props.active()}
                onClick={() => setState({ template, parameters: {}, attached: false })}
              >
                {language.t("mcp.resources.parameters")}
              </Button>
            </section>
          )}
        </For>
        <Show when={state.template}>
          {(template) => (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void run({
                  kind: "prepare",
                  input: {
                    kind: "template",
                    server: template().server,
                    uriTemplate: template().uriTemplate,
                    parameters: { ...state.parameters },
                  },
                })
              }}
            >
              <p>{template().title ?? template().name}</p>
              <For each={template().variables}>
                {(variable) => (
                  <label class="block">
                    {variable}
                    <input
                      class="block border border-border-base rounded-md p-2 w-full"
                      name={variable}
                      value={state.parameters[variable] ?? ""}
                      disabled={state.pending}
                      onInput={(event) => setState("parameters", variable, event.currentTarget.value)}
                    />
                  </label>
                )}
              </For>
              <Button type="submit" data-action="mcp-template-attach" disabled={state.pending || !props.active()}>
                {language.t("mcp.resources.attach")}
              </Button>
            </form>
          )}
        </Show>
      </div>
    </Dialog>
  )
}
