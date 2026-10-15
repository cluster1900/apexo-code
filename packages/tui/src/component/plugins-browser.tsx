/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ColorInput } from "@opentui/core"
import { createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { ApexoClient, PluginStoreAction, PluginStoreCatalog, PluginStoreRuntime } from "@apexo/sdk/v2"
import { useBindings } from "../keymap"
import { serverProtocol } from "../util/server-protocol"

export type PluginsBrowserActions = {
  list: (signal: AbortSignal) => Promise<PluginStoreCatalog>
  manage: (action: PluginStoreAction, signal: AbortSignal) => Promise<PluginStoreCatalog>
  runtime?: (signal: AbortSignal) => Promise<PluginStoreRuntime | undefined>
  reload: (signal: AbortSignal) => Promise<unknown>
}

// Mixed servers keep compatibility activation semantics; native probing is lazy.
export function pluginsActions(client: ApexoClient, directory: string | undefined): PluginsBrowserActions {
  const protocol = serverProtocol(client)
  const native = async (signal: AbortSignal) => (await protocol(signal)) === "v2"
  const api = async (signal: AbortSignal) => ((await native(signal)) ? client.v2.plugins : client.plugins)
  return {
    list: async (signal) => (await (await api(signal)).list({}, { signal, throwOnError: true })).data,
    manage: async (pluginStoreAction, signal) =>
      (await (await api(signal)).manage({ pluginStoreAction }, { signal, throwOnError: true })).data,
    runtime: async (signal) =>
      (await native(signal)) && directory
        ? (await client.v2.plugins.runtime({ location: { directory } }, { signal, throwOnError: true })).data
        : undefined,
    reload: async (signal) => {
      if (!(await native(signal))) return client.plugins.reload({ directory }, { signal, throwOnError: true })
      if (!directory) throw new Error("Open a project to apply plugins")
      const result = await client.v2.plugins.reload({ location: { directory } }, { signal, throwOnError: false })
      if (result.response.status === 409) throw new Error("Wait for running work to finish before applying plugins.")
      if (!result.response.ok) throw new Error("Plugins were not applied. Check the activation status.")
      return result.data
    },
  }
}

export function PluginsBrowser(props: {
  actions: PluginsBrowserActions
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  height?: number
}) {
  const dimensions = useTerminalDimensions()
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  const [state, setState] = createStore({
    catalog: { sources: [], items: [] } as PluginStoreCatalog,
    selected: 0,
    query: "",
    sources: false,
    input: "",
    value: "",
    pending: false,
    confirm: undefined as PluginStoreAction | undefined,
    error: "",
    detail: false,
    runtime: undefined as PluginStoreRuntime | undefined,
  })
  const items = createMemo(() =>
    state.catalog.items.filter((item) =>
      `${item.name} ${item.description}`.toLowerCase().includes(state.query.toLowerCase()),
    ),
  )
  const selected = createMemo(() => items()[state.selected])
  const rows = () => Math.max(2, (props.height ?? Math.min(24, dimensions().height - 8)) - (state.runtime ? 12 : 9))
  const offset = () => Math.max(0, state.selected - rows() + 1)
  const refreshRuntime = async () => {
    if (!props.actions.runtime) return
    const runtime = await props.actions.runtime(abort.signal)
    if (!abort.signal.aborted) setState("runtime", reconcile(runtime))
  }
  const perform = async (action?: PluginStoreAction) => {
    if (state.pending) return
    setState({ pending: true, error: "" })
    await (action ? props.actions.manage(action, abort.signal) : props.actions.list(abort.signal))
      .then(async (catalog) => {
        if (abort.signal.aborted) return
        setState("catalog", reconcile(catalog))
        setState({ selected: 0, confirm: undefined })
        await refreshRuntime()
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", "Operation failed. Check the source or try again.")
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => void perform())
  useBindings(() => ({
    priority: 1,
    bindings: [
      {
        key: "escape",
        desc: "Back in Plugins",
        group: "Plugins",
        cmd: () => {
          if (state.input) {
            setState("input", "")
            return
          }
          if (state.confirm) {
            setState("confirm", undefined)
            return
          }
          if (state.detail) {
            setState("detail", false)
            return
          }
          props.onClose()
        },
      },
    ],
  }))
  useKeyboard((event) => {
    if (event.name === "escape" || event.ctrl || event.meta || state.input) return
    event.preventDefault()
    if (state.pending) return
    if (state.confirm) {
      if (event.name === "space" && state.confirm.action === "uninstall")
        setState("confirm", { ...state.confirm, keepData: !state.confirm.keepData })
      if (event.name === "y") void perform({ ...state.confirm, trust: true })
      return
    }
    const length = state.sources ? state.catalog.sources.length : items().length
    if (event.name === "up") {
      setState("selected", (v) => Math.max(0, v - 1))
      return
    }
    if (event.name === "down") {
      setState("selected", (v) => Math.min(Math.max(0, length - 1), v + 1))
      return
    }
    if (event.name === "tab") {
      setState({ sources: !state.sources, selected: 0, detail: false })
      return
    }
    if (event.name === "/" || event.sequence === "/") {
      setState({ input: "search", value: state.query })
      return
    }
    if (event.name === "a" || event.name === "s") {
      setState({ input: event.name === "s" ? "source" : "install", value: "" })
      return
    }
    if (event.name === "r") {
      void perform({ action: "refresh" })
      return
    }
    if (event.name === "l") {
      setState({ pending: true, error: "" })
      void props.actions
        .reload(abort.signal)
        .catch((error: unknown) => {
          if (!abort.signal.aborted)
            setState("error", error instanceof Error ? error.message : "Plugins were not applied.")
        })
        .finally(async () => {
          if (abort.signal.aborted) return
          await refreshRuntime().catch(() => {
            if (!abort.signal.aborted && !state.error) setState("error", "Could not read plugin activation state.")
          })
          if (!abort.signal.aborted) setState("pending", false)
        })
      return
    }
    if (state.sources) {
      if (event.name === "x" && state.catalog.sources[state.selected])
        setState("confirm", { action: "remove-source", id: state.catalog.sources[state.selected].id })
      return
    }
    const item = selected()
    if (!item) return
    if (event.name === "return") {
      setState("detail", !state.detail)
      return
    }
    if (event.name === "d") {
      void perform({ action: "download", id: item.id })
      return
    }
    if (event.name === "i") {
      setState("confirm", { action: "install", id: item.id })
      return
    }
    if (event.name === "u") {
      setState("confirm", { action: "update", id: item.id })
      return
    }
    if (event.name === "x") {
      setState("confirm", { action: "uninstall", id: item.id })
      return
    }
    if (event.name === "space") {
      if (item.status === "enabled") {
        void perform({ action: "disable", id: item.id })
        return
      }
      setState("confirm", { action: "enable", id: item.id })
    }
  })
  return (
    <box
      flexDirection="column"
      height={props.height ?? Math.min(24, dimensions().height - 8)}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.theme().text}>
        <b>Plugins</b> — {state.sources ? "Sources" : "Discover and installed"}
      </text>
      <text fg={props.theme().muted}>r refresh · / search · a install from source · s add source · Tab switch</text>
      <text fg={props.theme().muted}>
        i install · d download · Space enable/disable · u update · x remove · l apply
      </text>
      <Show when={state.runtime}>
        {(runtime) => (
          <>
            <text fg={props.theme().muted}>
              Project snapshot {runtime().generation} · Enabled plugins need Apply to become active.
            </text>
            <Show when={runtime().failure}>
              {(failure) => (
                <text fg={props.theme().error}>
                  Activation {failure().code}: {failure().message} {failure().components?.join(", ")}
                </text>
              )}
            </Show>
          </>
        )}
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>{state.error}</text>
      </Show>
      <Show when={state.catalog.retainedData?.length}>
        <text fg={props.theme().highlight}>
          Plugin data is retained while in use or when ownership cannot be verified.
        </text>
      </Show>
      <Show when={state.pending}>
        <text fg={props.theme().muted}>Working…</text>
      </Show>
      <Show when={state.confirm}>
        <text fg={props.theme().highlight}>
          Confirm {state.confirm?.action}: {state.confirm?.source ?? state.confirm?.id}. Plugins can run code and access
          files. y confirm · Esc cancel
          {state.confirm?.action === "uninstall"
            ? ` · Space: keep plugin data [${state.confirm.keepData ? "yes" : "no"}]`
            : ""}
        </text>
      </Show>
      <Show when={state.input}>
        <text fg={props.theme().text}>
          {state.input === "search" ? "Search plugins" : "Git repository or local folder"}
        </text>
        <input
          focused
          value={state.value}
          onInput={(value) => setState("value", value)}
          onSubmit={() => {
            const value = state.value
            if (state.input === "search") {
              setState({ query: value, input: "", selected: 0 })
              return
            }
            if (state.input === "source") {
              setState("input", "")
              void perform({ action: "add-source", source: value })
              return
            }
            setState({ input: "", confirm: { action: "install", source: value } })
          }}
        />
      </Show>
      <Show when={!state.input && state.sources}>
        <For each={state.catalog.sources.slice(offset(), offset() + rows())}>
          {(source, i) => (
            <text fg={offset() + i() === state.selected ? props.theme().highlight : props.theme().text}>
              {offset() + i() === state.selected ? "› " : "  "}
              {source.name} — {source.location}
              {source.error ? " (refresh failed)" : ""}
            </text>
          )}
        </For>
      </Show>
      <Show when={!state.input && !state.sources && !state.detail}>
        <For each={items().slice(offset(), offset() + rows())}>
          {(item, i) => (
            <text fg={offset() + i() === state.selected ? props.theme().highlight : props.theme().text}>
              {offset() + i() === state.selected ? "› " : "  "}
              {item.name} [{item.status}]{" "}
              {state.runtime ? (state.runtime.active.includes(item.id) ? "[active]" : "[not active]") : ""}{" "}
              {item.version ?? ""}
            </text>
          )}
        </For>
        <Show when={!items().length}>
          <text fg={props.theme().muted}>No plugins. Press r to load recommended plugins or s to add a source.</text>
        </Show>
      </Show>
      <Show when={state.detail && selected()}>
        {(item) => (
          <scrollbox flexGrow={1}>
            <text fg={props.theme().text}>
              {item().name} [{item().status}]{" "}
              {state.runtime ? (state.runtime.active.includes(item().id) ? "[active]" : "[not active]") : ""}
            </text>
            <text fg={props.theme().muted}>{item().description}</text>
            <text fg={props.theme().muted}>{item().source}</text>
            <text fg={props.theme().muted}>{item().path ?? ""}</text>
            <For each={item().components}>
              {(component) => (
                <text fg={props.theme().text}>
                  {component.kind}: {component.name}
                </text>
              )}
            </For>
            <Show when={item().warnings.length}>
              <text fg={props.theme().error}>Some lifecycle hooks are not supported by this version.</text>
            </Show>
          </scrollbox>
        )}
      </Show>
      <box flexGrow={1} />
      <text fg={props.theme().muted}>Enter details · Esc back · Apply changes after running work finishes.</text>
    </box>
  )
}
