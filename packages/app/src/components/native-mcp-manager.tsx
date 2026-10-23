import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@apexo/ui/button"
import { useDialog } from "@apexo/ui/context/dialog"
import { Dialog } from "@apexo/ui/dialog"
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
  const dialog = useDialog()
  const manager = useMcpManager()
  const [runtimeStatus, setRuntimeStatus] = createSignal<Record<string, ReturnType<typeof sync>["data"]["mcp"][string]>>(
    {},
  )
  const [localConfigMcp, setLocalConfigMcp] = createSignal<NonNullable<ReturnType<typeof serverSync>["data"]["config"]["mcp"]>>(
    {},
  )
  const effectiveConfigMcp = () => ({
    ...(serverSync().data.config.mcp ?? {}),
    ...localConfigMcp(),
  })
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
    confirmDelete: "",
  })
  const startAdd = () => {
    setState({
      adding: true,
      editingName: "",
      name: "",
      type: "local",
      target: "",
      addError: "",
      confirmDelete: "",
    })
  }
  const startEdit = (name: string) => {
    const cfg = effectiveConfigMcp()[name]
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
      confirmDelete: "",
    })
  }
  const deleteServer = async (name: string) => {
    const nextMcp = { ...effectiveConfigMcp() }
    delete nextMcp[name]
    setState("confirmDelete", "")
    setState("deletedNames", (prev) => [...prev.filter((item) => item !== name), name])
    setLocalConfigMcp((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
    setRuntimeStatus((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
    await sdk()
      .client.mcp.disconnect({ name })
      .catch(() => undefined)
    await serverSync()
      .updateConfig({ mcp: nextMcp })
      .catch(() => undefined)
    manager.refresh.mutate()
  }
  const promptDeleteServer = (name: string) => {
    setState("confirmDelete", name)
    dialog.push(() => (
      <Dialog title={language.t("common.delete")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <span class="text-14-regular text-text-strong">{name}</span>
          <div class="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="large"
              onClick={() => {
                setState("confirmDelete", "")
                dialog.close()
              }}
            >
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                dialog.close()
                void deleteServer(name)
              }}
            >
              {language.t("common.delete")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }
  const addServer = async (event: SubmitEvent) => {
    event.preventDefault()
    const name = state.name.trim()
    const target = state.target.trim()
    if (!name || !target) return
    setState({ saving: true, addError: "" })
    const config =
      state.type === "local"
        ? { type: "local" as const, command: target.split(/\s+/).filter(Boolean), enabled: true, timeout: 5000 }
        : { type: "remote" as const, url: target, enabled: true, timeout: 5000 }
    try {
      const nextMcp = { ...effectiveConfigMcp() }
      if (state.editingName && state.editingName !== name) {
        delete nextMcp[state.editingName]
        await sdk()
          .client.mcp.disconnect({ name: state.editingName })
          .catch(() => undefined)
      }
      nextMcp[name] = config
      setLocalConfigMcp(nextMcp)
      setRuntimeStatus((prev) => ({
        ...prev,
        [name]: { status: "pending" },
      }))
      setState({
        adding: false,
        editingName: "",
        name: "",
        target: "",
        saving: false,
        addError: "",
        deletedNames: state.deletedNames
          .filter((item) => item !== name)
          .concat(state.editingName && state.editingName !== name ? [state.editingName] : []),
      })
      const addRes = await Promise.race([
        sdk()
          .client.mcp.add({ name, config })
          .catch(() => ({ data: undefined })),
        new Promise<{ data: undefined }>((resolve) => setTimeout(() => resolve({ data: undefined }), 5500)),
      ])
      let nextStatus: ReturnType<typeof sync>["data"]["mcp"][string] = {
        status: "failed",
        error: language.t("common.requestFailed"),
      }
      if (addRes.data && typeof addRes.data === "object") {
        const entries = addRes.data as Record<string, ReturnType<typeof sync>["data"]["mcp"][string]>
        if (name in entries && entries[name]) {
          nextStatus = entries[name]
        }
        setRuntimeStatus((prev) => ({
          ...prev,
          ...(name in entries ? entries : { [name]: nextStatus }),
        }))
      } else {
        setRuntimeStatus((prev) => ({
          ...prev,
          [name]: nextStatus,
        }))
      }
      void serverSync()
        .updateConfig({
          mcp: nextMcp,
        })
        .then(() => {
          if (nextStatus.status === "connected") manager.refresh.mutate()
        })
        .catch(() => undefined)
    } catch (err) {
      setState({
        saving: false,
        addError: err instanceof Error ? err.message : language.t("common.requestFailed"),
      })
    }
  }
  const canManageConfig = () => Boolean(props.allowManageConfig)
  const failed = () => sync().data.mcp_error || manager.refresh.isError
  const loading = () => !sync().data.mcp_ready || manager.refresh.isPending
  const statusMap = createMemo(() => {
    const merged: Record<string, ReturnType<typeof sync>["data"]["mcp"][string]> = {
      ...(sync().data.mcp ?? {}),
      ...runtimeStatus(),
    }
    if (canManageConfig()) {
      for (const [name, cfg] of Object.entries(effectiveConfigMcp())) {
        if (!cfg || !("type" in cfg)) continue
        if (!(name in merged)) {
          merged[name] =
            cfg.enabled === false
              ? { status: "disabled" }
              : loading()
                ? { status: "pending" }
                : { status: "failed", error: language.t("common.requestFailed") }
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
            <Show
              when={state.confirmDelete === name}
              fallback={
                <Button
                  size="small"
                  variant="ghost"
                  data-action="delete"
                  onClick={() => promptDeleteServer(name)}
                >
                  {language.t("common.delete")}
                </Button>
              }
            >
              <Button
                size="small"
                variant="secondary"
                data-action="delete-confirm"
                onClick={() => void deleteServer(name)}
              >
                {language.t("common.delete")}
              </Button>
              <Button
                size="small"
                variant="ghost"
                data-action="delete-cancel"
                onClick={() => setState("confirmDelete", "")}
              >
                {language.t("common.cancel")}
              </Button>
            </Show>
          </Show>
        </div>
      </div>
    )
  }

  return (
    <div data-component="native-mcp-manager" class={props.allowManageConfig ? "flex flex-col" : "flex flex-col gap-3 p-3"}>
      <Show when={props.allowManageConfig}>
        <div class="settings-v2-tab-header">
          <div class="settings-v2-tab-header-row">
            <h2 class="settings-v2-tab-title">{language.t("settings.mcp.title")}</h2>
            <Show when={!state.adding}>
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
        </div>
      </Show>
      <div class={props.allowManageConfig ? "settings-v2-tab-body flex flex-col gap-3" : "flex flex-col gap-3"}>
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
    </div>
  )
}
