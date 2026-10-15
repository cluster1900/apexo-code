/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createMcpAttachmentOperation,
  type McpAttachmentRequest,
  type McpAttachmentResult,
} from "@apexo/sdk/v2/mcp-attachment"
import type { ApexoClient } from "@apexo/sdk/v2/client"
import { useBindings } from "../keymap"

export type McpResourceOwner = { client: ApexoClient; sessionID: string; active: () => boolean }
export type McpPreparedAttachment = NonNullable<McpAttachmentResult["prepared"]>
export function McpResourcePicker(props: {
  owner: McpResourceOwner
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onAttach: (prepared: McpPreparedAttachment) => void
  onClose: () => void
}) {
  const [state, setState] = createStore({
    catalog: undefined as McpAttachmentResult["catalog"],
    selected: 0,
    parameter: -1,
    values: {} as Record<string, string>,
    pending: false,
    cancelling: false,
    error: "",
    attached: false,
  })
  let mounted = true
  let operation: ReturnType<typeof createMcpAttachmentOperation> | undefined
  const items = createMemo(() => [
    ...(state.catalog?.resources ?? []).map((resource) => ({ kind: "resource" as const, resource })),
    ...(state.catalog?.templates ?? []).map((template) => ({ kind: "template" as const, template })),
  ])
  const selected = () => items()[state.selected]
  const template = () => {
    const item = selected()
    return item?.kind === "template" ? item.template : undefined
  }
  const cancel = async () => {
    const current = operation
    if (!current) return true
    if (mounted) setState("cancelling", true)
    const joined = await current.cancel().then(
      () => true,
      () => {
        if (mounted)
          setState("error", "Cancellation could not be confirmed. The operation lease will expire automatically.")
        return false
      },
    )
    if (joined && operation === current) operation = undefined
    if (mounted) setState({ pending: !joined, cancelling: false })
    return joined
  }
  const close = async () => {
    if (await cancel()) props.onClose()
  }
  const run = async (request: McpAttachmentRequest) => {
    if (!props.owner.active() || state.pending) return
    const current = createMcpAttachmentOperation(props.owner.client, props.owner.sessionID)
    operation = current
    setState({ pending: true, error: "", attached: false })
    await current
      .run(request)
      .then((result) => {
        if (!mounted || !props.owner.active() || operation !== current || !result) return
        if (result.catalog) setState({ catalog: result.catalog, selected: 0, parameter: -1 })
        if (result.prepared) {
          props.onAttach(result.prepared)
          setState({ attached: true, parameter: -1 })
        }
      })
      .catch((error) => {
        if (mounted && operation === current)
          setState("error", error instanceof Error ? error.message : "Could not load or attach resource.")
      })
      .finally(() => {
        if (operation === current && !current.cancelled) {
          operation = undefined
          if (mounted) setState("pending", false)
        }
      })
  }
  const attach = () => {
    const item = selected()
    if (!item) return
    if (item.kind === "resource") {
      void run({ kind: "prepare", input: { kind: "resource", server: item.resource.server, uri: item.resource.uri } })
      return
    }
    if (state.parameter < 0 && item.template.variables.length) {
      setState({ parameter: 0, values: {}, attached: false })
      return
    }
    void run({
      kind: "prepare",
      input: {
        kind: "template",
        server: item.template.server,
        uriTemplate: item.template.uriTemplate,
        parameters: { ...state.values },
      },
    })
  }
  createEffect(() => {
    if (!props.owner.active()) {
      setState("error", "Session changed. Reopen resources in the current session.")
      void cancel()
    }
  })
  onMount(() => void run({ kind: "catalog", input: {} }))
  onCleanup(() => {
    mounted = false
    void cancel()
  })
  useBindings(() => ({
    priority: 2,
    bindings: [
      {
        key: "escape",
        desc: "Close resources",
        group: "MCP",
        cmd: () => {
          if (state.parameter >= 0 && !state.pending) setState("parameter", -1)
          else void close()
        },
      },
    ],
  }))
  useKeyboard((event) => {
    if (event.name === "escape" || event.ctrl || event.meta || state.parameter >= 0) return
    event.preventDefault()
    if (state.pending) {
      if (event.name === "x" && !state.cancelling) void cancel()
      return
    }
    if (event.name === "up") setState("selected", (value) => Math.max(0, value - 1))
    if (event.name === "down") setState("selected", (value) => Math.min(items().length - 1, value + 1))
    if (event.name === "u") void run({ kind: "catalog", input: {} })
    if (event.name === "return") attach()
  })
  return (
    <box flexDirection="column" flexGrow={1}>
      <text fg={props.theme().highlight}>MCP resources</text>
      <text fg={props.theme().muted}>Attach current contents to your next message.</text>
      <Show when={state.pending}>
        <text fg={props.theme().muted}>{state.cancelling ? "Cancelling…" : "Loading resources…"}</text>
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>{state.error}</text>
      </Show>
      <Show when={state.attached}>
        <text fg={props.theme().highlight}>Attached to your draft.</text>
      </Show>
      <For each={state.catalog?.errors}>
        {(error) => (
          <text fg={props.theme().error}>
            {error.server}: {error.message}
          </text>
        )}
      </For>
      <Show when={state.catalog && !items().length}>
        <text fg={props.theme().muted}>No resources or templates available.</text>
      </Show>
      <Show
        when={state.parameter < 0}
        fallback={
          <box flexDirection="column">
            <text fg={props.theme().text}>
              {template()?.name} · {template()?.variables[state.parameter]}
            </text>
            <input
              focused={!state.pending}
              value={state.values[template()?.variables[state.parameter] ?? ""] ?? ""}
              onInput={(value) => {
                const variable = template()?.variables[state.parameter]
                if (variable) setState("values", variable, value)
              }}
              onSubmit={() => {
                if (state.parameter + 1 < (template()?.variables.length ?? 0))
                  setState("parameter", (value) => value + 1)
                else attach()
              }}
            />
            <text fg={props.theme().muted}>Enter next parameter / attach · Esc back</text>
          </box>
        }
      >
        <For each={items().slice(Math.max(0, state.selected - 5), Math.max(0, state.selected - 5) + 6)}>
          {(item, index) => (
            <text
              fg={
                Math.max(0, state.selected - 5) + index() === state.selected
                  ? props.theme().highlight
                  : props.theme().text
              }
            >
              {Math.max(0, state.selected - 5) + index() === state.selected ? "› " : "  "}
              {item.kind === "resource" ? item.resource.name : `${item.template.name} [template]`} ·{" "}
              {item.kind === "resource" ? item.resource.server : item.template.server}
            </text>
          )}
        </For>
        <text fg={props.theme().muted}>
          {state.pending ? "x cancel · Esc close" : "Enter attach / parameters · u refresh · Esc back"}
        </text>
      </Show>
    </box>
  )
}
