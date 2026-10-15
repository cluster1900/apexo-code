import { createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@apexo/ui/button"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { NativeMcpAuthentication } from "./native-mcp-authentication"
import { useMcpManager } from "@/context/mcp"

const labels = {
  connected: "mcp.status.connected",
  disabled: "mcp.status.disabled",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
} as const

export function NativeMcpManager() {
  const sync = useSync()
  const language = useLanguage()
  const manager = useMcpManager()
  const [state, setState] = createStore({ search: "" })
  const items = createMemo(() =>
    Object.keys(sync().data.mcp ?? {})
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
        </div>
      </div>
    )
  }

  return (
    <div data-component="native-mcp-manager" class="flex flex-col gap-3 p-3">
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
        <For each={items()}>{(name) => <Row name={name} status={sync().data.mcp[name]} />}</For>
      </div>
    </div>
  )
}
