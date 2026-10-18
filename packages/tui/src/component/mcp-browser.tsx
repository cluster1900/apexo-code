/** @jsxImportSource @opentui/solid */
import { Dynamic, useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core"
import { createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { ApexoClient, McpStatus, McpStatusMap, McpAuthenticationStart } from "@apexo/sdk/v2"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"
import { serverProtocol } from "../util/server-protocol"

import type { McpPreparedAttachment, McpResourceOwner } from "./mcp-resource-picker"

type McpAction = "connect" | "disconnect" | "retry" | "authenticate" | "resetPreference"
type McpSnapshot = {
  native: boolean
  servers: Record<string, McpStatus | McpStatusMap[string]>
}
export type McpBrowserActions = {
  attachments?: () => McpResourceOwner | undefined
  authStart?: (server: string, signal: AbortSignal) => Promise<McpAuthenticationStart>
  authCancel?: (server: string, id: string, signal: AbortSignal) => Promise<unknown>
  inspect: (signal: AbortSignal) => Promise<McpSnapshot>
  manage: (server: string, action: McpAction, signal: AbortSignal) => Promise<unknown>
}

export function mcpActions(
  client: ApexoClient,
  directory: string | undefined,
  sessionID?: () => string | undefined,
): McpBrowserActions {
  const protocol = serverProtocol(client)
  return {
    attachments: sessionID
      ? () => {
          const id = sessionID()
          return id ? { client, sessionID: id, active: () => sessionID() === id } : undefined
        }
      : undefined,
    authStart: async (server, signal) => {
      if ((await protocol(signal)) !== "v2") throw new Error("Native authentication is unavailable")
      return (await client.v2.mcp.authStart({ server, location: { directory } }, { signal, throwOnError: true })).data
    },
    authCancel: async (server, flowID, signal) => {
      if ((await protocol(signal)) !== "v2") throw new Error("Native authentication is unavailable")
      return client.v2.mcp.authCancel({ server, flowID, location: { directory } }, { signal, throwOnError: true })
    },
    inspect: async (signal) => {
      const native = (await protocol(signal)) === "v2"
      const servers = native
        ? (await client.v2.mcp.status({ location: { directory } }, { signal, throwOnError: true })).data
        : (await client.mcp.status({ directory }, { signal, throwOnError: true })).data
      return { native, servers }
    },
    manage: async (server, action, signal) => {
      if ((await protocol(signal)) === "v2") {
        if (action === "authenticate")
          return client.v2.mcp.authStart({ server, location: { directory } }, { signal, throwOnError: true })
        return client.v2.mcp[action]({ server, location: { directory } }, { signal, throwOnError: true })
      }
      if (action === "resetPreference") throw new Error("Saved connection choices are only managed by native MCP.")
      if (action === "authenticate")
        return client.mcp.auth.authenticate({ name: server, directory }, { signal, throwOnError: true })
      if (action === "disconnect")
        return client.mcp.disconnect({ name: server, directory }, { signal, throwOnError: true })
      return client.mcp.connect({ name: server, directory }, { signal, throwOnError: true })
    },
  }
}

export function McpBrowser(props: {
  actions: McpBrowserActions
  onAttach?: (prepared: McpPreparedAttachment) => void
  theme: () => {
    text: ColorInput
    muted: ColorInput
    error: ColorInput
    highlight: ColorInput
  }
  onClose: () => void
  /** Open the resource/template attachment picker as soon as a native snapshot is loaded (`/resources`). */
  openPicker?: boolean
  height?: number
}) {
  const clipboard = useClipboard()
  const dimensions = useTerminalDimensions()
  let viewport: ScrollBoxRenderable | undefined
  const abort = new AbortController()
  onCleanup(() => abort.abort())
  const [state, setState] = createStore({
    picker: undefined as typeof import("./mcp-resource-picker").McpResourcePicker | undefined,
    owner: undefined as McpResourceOwner | undefined,
    snapshot: undefined as McpSnapshot | undefined,
    selected: 0,
    pending: false,
    error: "",
    authError: "",
    authorization: undefined as { server: string; id: string; url: string } | undefined,
  })
  const items = createMemo(() => Object.entries(state.snapshot?.servers ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  const selected = () => items()[state.selected]
  const rows = () =>
    Math.max(2, (props.height ?? Math.min(24, dimensions().height - 8)) - (authentication()?.supported ? 16 : 9))
  const offset = () => Math.max(0, state.selected - rows() + 1)
  const perform = async (action?: McpAction) => {
    if (state.pending || state.picker) return
    const target = selected()
    if (action && !target) return
    setState({ pending: true, error: "" })
    if (action && target)
      await props.actions.manage(target[0], action, abort.signal).catch(() => {
        if (!abort.signal.aborted)
          setState("error", "MCP operation failed. Check the status and wait for active work to finish.")
      })
    if (!abort.signal.aborted)
      await props.actions
        .inspect(abort.signal)
        .then((snapshot) => {
          if (!abort.signal.aborted) {
            const auth = state.authorization
            const server = auth ? snapshot.servers[auth.server] : undefined
            const flow = server && "authentication" in server ? server.authentication?.flow : undefined
            if (auth && (flow?.id !== auth.id || !["waiting", "exchanging"].includes(flow?.phase ?? "")))
              setState("authorization", undefined)
            setState({
              snapshot,
              selected: Math.min(state.selected, Math.max(0, Object.keys(snapshot.servers).length - 1)),
            })
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) setState("error", "Could not load MCP connections. Press u to refresh.")
        })
        .finally(() => {
          if (!abort.signal.aborted) setState("pending", false)
        })
  }
  const authentication = () => {
    const status = selected()?.[1]
    return status && "authentication" in status ? status.authentication : undefined
  }
  const openAuthorization = async () => {
    if (!state.authorization || state.authorization.server !== selected()?.[0]) return
    const { openUrl } = await import("@apexo/core/open")
    await openUrl(state.authorization.url).catch(() =>
      setState("authError", "Could not open the browser. Press y to copy the authorization link."),
    )
  }
  const authorize = async () => {
    const server = selected()?.[0]
    if (state.pending || !server || !props.actions.authStart) return
    setState({ pending: true, authError: "" })
    await props.actions
      .authStart(server, abort.signal)
      .then(async (result) => {
        if (abort.signal.aborted) return
        const url = new URL(result.authorizationUrl)
        if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid authorization URL")
        setState("authorization", { server, id: result.id, url: url.href })
        await openAuthorization()
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setState("authError", "Authentication could not start. Refresh the status and try again.")
      })
    if (!abort.signal.aborted) {
      setState("pending", false)
      await perform()
    }
  }
  const cancelAuthorization = async () => {
    const server = selected()?.[0],
      id = authentication()?.flow?.id
    if (state.pending || !server || !id || !props.actions.authCancel) return
    setState({ pending: true, authError: "" })
    await props.actions.authCancel(server, id, abort.signal).catch(() => {
      if (!abort.signal.aborted)
        setState("authError", "Authentication could not be cancelled. Refresh the current status.")
    })
    if (!abort.signal.aborted) {
      setState({ pending: false, authorization: undefined })
      await perform()
    }
  }
  const openPicker = () => {
    if (!state.snapshot?.native || !props.onAttach) return
    const owner = props.actions.attachments?.()
    if (!owner) return
    void (async () => {
      const { McpResourcePicker } = await import("./mcp-resource-picker")
      if (!abort.signal.aborted && owner.active()) {
        setState("owner", owner)
        setState("picker", () => McpResourcePicker)
      }
    })()
  }
  onMount(() => {
    void perform().then(() => {
      if (props.openPicker) openPicker()
    })
    const timer = setInterval(() => {
      if (!["waiting", "exchanging"].includes(authentication()?.flow?.phase ?? "")) return
      void perform()
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })
  useBindings(() => ({
    priority: 1,
    enabled: !state.picker,
    bindings: [
      {
        key: "escape",
        desc: "Close MCP manager",
        group: "MCP",
        cmd: props.onClose,
      },
    ],
  }))
  useKeyboard((event) => {
    if (state.picker || event.name === "escape" || event.ctrl || event.meta) return
    event.preventDefault()
    if (state.pending) return
    if (event.name === "b" && state.snapshot?.native && props.onAttach) {
      openPicker()
      return
    }
    if (["pageup", "pagedown", "home", "end"].includes(event.name) && viewport) {
      if (event.name === "home") return viewport.scrollTo(0)
      if (event.name === "end") return viewport.scrollTo(viewport.scrollHeight)
      return viewport.scrollBy((event.name === "pageup" ? -1 : 1) * viewport.height)
    }
    if (event.name === "up") {
      setState("selected", (value) => Math.max(0, value - 1))
      return
    }
    if (event.name === "down") {
      setState("selected", (value) => Math.min(Math.max(0, items().length - 1), value + 1))
      return
    }
    if (event.name === "u") {
      void perform()
      return
    }
    const item = selected()
    if (!item) return
    if (event.name === "c" && state.snapshot?.native) {
      void perform("resetPreference")
      return
    }
    if (event.name === "r") {
      if (
        state.snapshot?.native &&
        (item[1].status === "disabled" || ("preference" in item[1] && item[1].preference === false))
      )
        return
      void perform("retry")
      return
    }
    if (
      state.snapshot?.native &&
      event.name === "a" &&
      authentication()?.supported &&
      !["waiting", "exchanging"].includes(authentication()?.flow?.phase ?? "")
    ) {
      void authorize()
      return
    }
    if (
      state.snapshot?.native &&
      event.name === "x" &&
      ["waiting", "exchanging"].includes(authentication()?.flow?.phase ?? "")
    ) {
      void cancelAuthorization()
      return
    }
    if (event.name === "o" && state.authorization?.server === item[0]) {
      void openAuthorization()
      return
    }
    if (event.name === "y" && state.authorization?.server === item[0]) {
      void clipboard
        .write?.(state.authorization.url)
        .catch(() => setState("authError", "Could not copy the authorization link."))
      return
    }
    if (event.name === "a" && !state.snapshot?.native && item[1].status === "needs_auth") {
      void perform("authenticate")
      return
    }
    if (event.name === "return")
      void perform(
        item[1].status === "connected"
          ? "disconnect"
          : item[1].status === "disabled" || ("preference" in item[1] && item[1].preference === false)
            ? "connect"
            : "retry",
      )
  })
  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      height={props.height ?? Math.max(12, Math.min(24, dimensions().height - 8))}
    >
      <Show
        when={!state.picker}
        fallback={
          <Dynamic
            component={state.picker}
            owner={state.owner!}
            theme={props.theme}
            onAttach={props.onAttach!}
            onClose={() => setState({ picker: undefined, owner: undefined })}
          />
        }
      >
        <text flexShrink={0} fg={props.theme().highlight}>
          MCP connections
        </text>
        <Show when={state.snapshot?.native && props.onAttach && props.actions.attachments?.()}>
          <text fg={props.theme().muted}>b browse resources</text>
        </Show>
        <Show when={state.snapshot?.native}>
          <text flexShrink={0} fg={props.theme().muted}>
            Connection choices are saved for this project. Retry does not change the saved choice.
          </text>
        </Show>
        <scrollbox
          ref={(value) => {
            viewport = value
          }}
          flexGrow={1}
          flexBasis={0}
          minHeight={0}
        >
          <Show when={state.pending}>
            <text fg={props.theme().muted}>Loading…</text>
          </Show>
          <Show when={state.authError}>
            <text fg={props.theme().error}>{state.authError}</text>
          </Show>
          <Show when={state.error}>
            <text fg={props.theme().error}>{state.error}</text>
          </Show>
          <Show when={state.snapshot && !state.pending && !state.error && items().length === 0}>
            <text fg={props.theme().muted}>No MCP servers configured.</text>
          </Show>
          <For each={items().slice(offset(), offset() + rows())}>
            {([name, status], index) => (
              <text fg={state.selected === offset() + index() ? props.theme().highlight : props.theme().text}>
                {state.selected === offset() + index() ? "› " : "  "}
                {name} · {status.status}
                {"tools" in status ? ` · tools: ${status.tools}` : ""}
              </text>
            )}
          </For>
          <Show when={selected()}>
            {(item) => {
              const error = () => {
                const status = item()[1]
                if ("preferenceError" in status && status.preferenceError)
                  return "Saved connection choices could not be read or updated. Check access to Apexo's data folder and repair damaged preferences before trying again."
                return "error" in status ? status.error : undefined
              }
              const preference = () => {
                const status = item()[1]
                return "preference" in status ? status.preference : undefined
              }
              return (
                <box flexDirection="column">
                  <Show when={preference() !== undefined}>
                    <text fg={props.theme().muted}>
                      {preference() ? "Saved choice: enabled" : "Saved choice: disabled"}
                    </text>
                  </Show>
                  <Show when={error()}>{(message) => <text fg={props.theme().error}>{message()}</text>}</Show>
                  <Show when={authentication()}>
                    {(auth) => (
                      <box flexDirection="column">
                        <Show when={auth().supported}>
                          <text fg={props.theme().muted}>
                            Authorize in a browser on the computer running the Apexo server. The callback uses that
                            computer's loopback address.
                          </text>
                        </Show>
                        <Show when={auth().credentials === "available"}>
                          <text fg={props.theme().muted}>
                            Saved authentication is available. Connect enables a disabled server.
                          </text>
                        </Show>
                        <Show when={auth().flow}>
                          <text fg={props.theme().muted}>Authentication: {auth().flow?.phase}</text>
                        </Show>
                        <Show when={(auth().flow?.error ?? auth().error) === "storage"}>
                          <text fg={props.theme().error}>
                            Could not access saved authentication. Check Apexo data-folder access and repair damaged
                            credential data before retrying.
                          </text>
                        </Show>
                        <Show
                          when={
                            (auth().flow?.error ?? auth().error) && (auth().flow?.error ?? auth().error) !== "storage"
                          }
                        >
                          <text fg={props.theme().error}>
                            Authentication did not complete. Check this server's OAuth settings and try again.
                          </text>
                        </Show>
                        <Show when={auth().flow?.phase === "retry_required"}>
                          <text fg={props.theme().muted}>
                            Credentials are saved. Retry when this project's work is idle.
                          </text>
                        </Show>
                      </box>
                    )}
                  </Show>
                  <Show
                    when={state.snapshot?.native && item()[1].status === "needs_auth" && !authentication()?.supported}
                  >
                    <text fg={props.theme().muted}>Authentication setup is not available yet.</text>
                  </Show>
                </box>
              )
            }}
          </Show>
        </scrollbox>
        <text flexShrink={0} fg={props.theme().muted}>
          Enter connect/disconnect · r retry · u refresh · PgUp/PgDn scroll · Esc close
        </text>
        <Show when={state.snapshot?.native && props.onAttach && props.actions.attachments?.()}>
          <text fg={props.theme().muted}>b browse resources</text>
        </Show>
        <Show when={state.snapshot?.native}>
          <text flexShrink={0} fg={props.theme().muted}>
            c use configuration
          </text>
        </Show>
        <Show when={state.snapshot?.native && authentication()?.supported}>
          <text flexShrink={0} fg={props.theme().muted}>
            a authenticate · x cancel authentication · o open page · y copy link
          </text>
        </Show>
        <Show when={!state.snapshot?.native && selected()?.[1].status === "needs_auth"}>
          <text flexShrink={0} fg={props.theme().muted}>
            a authenticate
          </text>
        </Show>
      </Show>
    </box>
  )
}
