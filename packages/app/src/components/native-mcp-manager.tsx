import { createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@apexo/ui/button"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { NativeMcpAuthentication } from "./native-mcp-authentication"
import { useMcpManager } from "@/context/mcp"

const labels = {
  connected: "mcp.status.connected",
  disabled: "mcp.status.disabled",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
} as const

export function NativeMcpManager(props: { allowManageConfig?: boolean } = {}) {
  const sync = useSync()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const language = useLanguage()
  const manager = useMcpManager()
  const [state, setState] = createStore({
    search: "",
    adding: false,
    editingName: "",
    name: "",
    type: "local" as "local" | "remote",
    target: "",
    saving: false,
    addError: "",
    deletedNames: [] as string[],
  })
  const startAdd = () => {
    setState({
      adding: true,
      editingName: "",
      name: "",
      type: "local",
      target: "",
      addError: "",
    })
  }
  const startEdit = (name: string) => {
    const cfg = serverSync().data.config.mcp?.[name]
    const type = cfg && "type" in cfg ? cfg.type : "local"
    const target =
      cfg && "type" in cfg
        ? cfg.type === "local"
          ? cfg.command.join(" ")
          : cfg.url
        : ""
    setState({
      adding: true,
      editingName: name,
      name,
      type,
      target,
      addError: "",
    })
  }
  const deleteServer = async (name: string) => {
    const nextMcp = { ...(serverSync().data.config.mcp ?? {}) }
    delete nextMcp[name]
    setState("deletedNames", (prev) => [...prev.filter((item) => item !== name), name])
    serverSync().set("config", "mcp", nextMcp)
    await sdk()
      .client.mcp.disconnect({ name })
      .catch(() => undefined)
    await serverSync()
      .updateConfig({ mcp: nextMcp })
      .catch(() => undefined)
    manager.refresh.mutate()
  }
  const addServer = async (event: SubmitEvent) => {
    event.preventDefault()
    const name = state.name.trim()
    const target = state.target.trim()
    if (!name || !target) return
    setState({ saving: true, addError: "" })
    const config =
      state.type === "local"
        ? { type: "local" as const, command: target.split(/\s+/).filter(Boolean), enabled: true }
        : { type: "remote" as const, url: target, enabled: true }
    try {
      const nextMcp = { ...(serverSync().data.config.mcp ?? {}) }
      if (state.editingName && state.editingName !== name) {
        delete nextMcp[state.editingName]
        await sdk()
          .client.mcp.disconnect({ name: state.editingName })
          .catch(() => undefined)
      }
      nextMcp[name] = config
      await sdk().client.mcp.add({ name, config })
      serverSync().set("config", "mcp", nextMcp)
      await serverSync().updateConfig({
        mcp: nextMcp,
      })
      setState({
        adding: false,
        editingName: "",
        name: "",
        target: "",
        saving: false,
        addError: "",
        deletedNames: state.deletedNames.filter(
          (item) => item !== name && (state.editingName && state.editingName !== name ? true : true),
        ).concat(state.editingName && state.editingName !== name ? [state.editingName] : []),
      })
      manager.refresh.mutate()
    } catch (err) {
      setState({
        saving: false,
        addError: err instanceof Error ? err.message : language.t("common.requestFailed"),
      })
    }
  }
  const canManageConfig = () => Boolean(props.allowManageConfig)
  const statusMap = createMemo(() => {
    const merged: Record<string, ReturnType<typeof sync>["data"]["mcp"][string]> = {
      ...(sync().data.mcp ?? {}),
    }
    if (canManageConfig()) {
      for (const [name, cfg] of Object.entries(serverSync().data.config.mcp ?? {})) {
        if (!cfg || !("type" in cfg)) continue
        if (!(name in merged)) {
          merged[name] = cfg.enabled === false ? { status: "disabled" } : { status: "connected" }
        }
      }
    }
    for (const deleted of state.deletedNames) {
      delete merged[deleted]
    }
    return merged
  })
  const items = createMemo(() =>
    Object.keys(statusMap())
      .filter((name) => name.toLowerCase().includes(state.search.toLowerCase()))
      .sort((a, b) => a.localeCompare(b)),
  )
  const failed = () => sync().data.mcp_error || manager.refresh.isError
  const loading = () => !sync().data.mcp_ready || manager.refresh.isPending
  createEffect(on(sync, () => manager.refresh.mutate()))

  // Server identity owns ephemeral authorization controls across status refetches.
  function Row(props: { name: string; status: ReturnType<typeof sync>["data"]["mcp"][string] }) {
    const name = props.name
    return (
      <div data-mcp-server={name} class="flex flex-col gap-1 rounded-md border border-border-base p-2">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-14-regular" dir="auto">
            {name}
          </span>
          <span class="text-11-regular text-text-weak">
            {props.status.status === "pending" ? language.t("common.loading") : language.t(labels[props.status.status])}
          </span>
        </div>
        <Show when={"tools" in props.status}>
          <p class="text-11-regular text-text-weak">
            {language.t("mcp.runtime.tools", {
              count: "tools" in props.status ? props.status.tools : 0,
            })}
          </p>
        </Show>
        <Show when={"preferenceError" in props.status && props.status.preferenceError}>
          <p role="alert" class="text-11-regular text-text-danger-base">
            {language.t("mcp.preference.error")}
          </p>
        </Show>
        <Show when={"preference" in props.status && props.status.preference !== undefined}>
          <p data-mcp-preference class="text-11-regular text-text-weak">
            {language.t(
              "preference" in props.status && props.status.preference
                ? "mcp.preference.enabled"
                : "mcp.preference.disabled",
            )}
          </p>
        </Show>
        <Show
          when={
            "error" in props.status &&
            props.status.error &&
            !("preferenceError" in props.status && props.status.preferenceError)
          }
        >
          <p class="break-words text-11-regular text-text-weak" dir="auto">
            {"error" in props.status ? props.status.error : ""}
          </p>
        </Show>
        <Show when={"authentication" in props.status && props.status.authentication}>
          {(authentication) => (
            <NativeMcpAuthentication
              authentication={authentication()}
              start={() => manager.authStart(name)}
              cancel={(id) => manager.authCancel(name, id)}
            />
          )}
        </Show>
        <Show
          when={
            props.status.status === "needs_auth" &&
            !("authentication" in props.status && props.status.authentication?.supported)
          }
        >
          <p class="text-11-regular text-text-weak">{language.t("mcp.runtime.authUnavailable")}</p>
        </Show>
        <div class="flex flex-wrap gap-1">
          <Show when={props.status.status !== "pending"}>
            <Button
              size="small"
              variant="secondary"
              disabled={manager.action.isPending}
              data-action={props.status.status === "connected" ? "disconnect" : "connect"}
              onClick={() =>
                manager.action.mutate({
                  name,
                  action: props.status.status === "connected" ? "disconnect" : "connect",
                })
              }
            >
              {props.status.status === "connected" ? language.t("common.disconnect") : language.t("common.connect")}
            </Button>
          </Show>
          <Show
            when={
              props.status.status !== "disabled" &&
              props.status.status !== "pending" &&
              !("preference" in props.status && props.status.preference === false)
            }
          >
            <Button
              size="small"
              variant="ghost"
              data-action="retry"
              disabled={manager.action.isPending}
              onClick={() => manager.action.mutate({ name, action: "retry" })}
            >
              {language.t("mcp.runtime.retry")}
            </Button>
          </Show>
          <Show when={"preference" in props.status && props.status.preference !== undefined}>
            <Button
              size="small"
              variant="ghost"
              data-action="resetPreference"
              disabled={manager.action.isPending}
              onClick={() => manager.action.mutate({ name, action: "resetPreference" })}
            >
              {language.t("mcp.preference.reset")}
            </Button>
          </Show>
          <Show when={canManageConfig()}>
            <Button
              size="small"
              variant="ghost"
              data-action="edit"
              onClick={() => startEdit(name)}
            >
              {language.t("common.edit")}
            </Button>
            <Button
              size="small"
              variant="ghost"
              data-action="delete"
              onClick={() => void deleteServer(name)}
            >
              {language.t("common.delete")}
            </Button>
          </Show>
        </div>
      </div>
    )
  }

  return (
    <div data-component="native-mcp-manager" class="flex flex-col gap-3 p-3">
      <Show when={props.allowManageConfig}>
        <div class="settings-v2-tab-header">
          <h2 class="settings-v2-tab-title">{language.t("settings.mcp.title")}</h2>
        </div>
      </Show>
      <p class="text-12-regular text-text-weak">{language.t("mcp.runtime.hint")}</p>
      <div class="flex items-center gap-2">
        <input
          class="min-w-0 flex-1 rounded-md border border-border-base px-2 py-1 text-12-regular"
          aria-label={language.t("common.search.placeholder")}
          placeholder={language.t("common.search.placeholder")}
          value={state.search}
          onInput={(event) => setState("search", event.currentTarget.value)}
        />
        <Button size="small" variant="ghost" disabled={loading()} onClick={() => manager.refresh.mutate()}>
          {language.t("mcp.runtime.refresh")}
        </Button>
        <Show when={props.allowManageConfig && !state.adding}>
          <Button
            size="small"
            variant="secondary"
            data-action="mcp-add-toggle"
            onClick={() => startAdd()}
          >
            {`+ ${language.t("settings.mcp.title")}`}
          </Button>
        </Show>
      </div>
      <Show when={props.allowManageConfig && state.adding}>
        <form class="flex flex-col gap-2 rounded-md border border-border-base p-3" onSubmit={addServer}>
          <div class="flex gap-2">
            <input
              class="min-w-0 flex-1 rounded-md border border-border-base bg-background-base px-2 py-1 text-12-regular"
              placeholder={language.t("mcp.native.namePlaceholder")}
              value={state.name}
              onInput={(event) => setState("name", event.currentTarget.value)}
            />
            <select
              class="rounded-md border border-border-base bg-background-base px-2 py-1 text-12-regular"
              value={state.type}
              onChange={(event) => setState("type", event.currentTarget.value as "local" | "remote")}
            >
              <option value="local">{language.t("mcp.native.type.local")}</option>
              <option value="remote">{language.t("mcp.native.type.remote")}</option>
            </select>
          </div>
          <input
            class="rounded-md border border-border-base bg-background-base px-2 py-1 text-12-regular"
            placeholder={
              state.type === "local"
                ? "npx -y @modelcontextprotocol/server-filesystem ."
                : "https://example.com/mcp"
            }
            value={state.target}
            onInput={(event) => setState("target", event.currentTarget.value)}
          />
          <Show when={state.addError}>
            <p role="alert" class="text-11-regular text-text-danger-base">
              {state.addError}
            </p>
          </Show>
          <div class="flex justify-end gap-2">
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={state.saving}
              onClick={() => setState({ adding: false, editingName: "", addError: "" })}
            >
              {language.t("common.cancel")}
            </Button>
            <Button
              type="submit"
              size="small"
              disabled={state.saving || !state.name.trim() || !state.target.trim()}
            >
              {language.t("common.save")}
            </Button>
          </div>
        </form>
      </Show>
      <Show when={failed()}>
        <p role="alert" class="text-12-regular text-text-danger-base">
          {language.t("common.requestFailed")}
        </p>
      </Show>
      <Show when={loading()}>
        <p role="status" class="text-12-regular text-text-weak">
          {language.t("common.loading")}
        </p>
      </Show>
      <Show when={!failed() && !loading() && items().length === 0}>
        <p class="text-12-regular text-text-weak">{language.t("dialog.mcp.empty")}</p>
      </Show>
      <div class="flex flex-col gap-3">
        <For each={items()}>{(name) => <Row name={name} status={statusMap()[name]} />}</For>
      </div>
    </div>
  )
}
