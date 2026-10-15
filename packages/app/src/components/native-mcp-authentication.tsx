import { createEffect, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Mcp } from "@apexo/schema/mcp"
import { Button } from "@apexo/ui/button"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

const phases = {
  waiting: "mcp.auth.waiting",
  exchanging: "mcp.auth.exchanging",
  connected: "mcp.auth.connected",
  credentials_ready: "mcp.auth.ready",
  retry_required: "mcp.auth.retry",
  failed: "mcp.auth.failed",
  cancelled: "mcp.auth.cancelled",
} as const

export function NativeMcpAuthentication(props: {
  authentication: Mcp.Authentication
  start: () => Promise<Mcp.AuthenticationStart>
  cancel: (id: string) => Promise<void>
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({
    pending: false,
    error: false,
    authorization: undefined as { id: string; url: string } | undefined,
  })
  const active = () => ["waiting", "exchanging"].includes(props.authentication.flow?.phase ?? "")
  const error = () => props.authentication.flow?.error ?? props.authentication.error
  createEffect(() => {
    if (state.authorization && (!active() || state.authorization.id !== props.authentication.flow?.id))
      setState("authorization", undefined)
  })
  const open = () => {
    if (!state.authorization) return
    try {
      platform.openExternal(state.authorization.url)
    } catch {
      setState("error", true)
    }
  }
  const copy = async () => {
    if (!state.authorization) return
    try {
      await navigator.clipboard.writeText(state.authorization.url)
    } catch {
      setState("error", true)
    }
  }
  const start = async () => {
    setState({ pending: true, error: false })
    await props
      .start()
      .then((result) => {
        const url = new URL(result.authorizationUrl)
        if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid authorization URL")
        setState("authorization", { id: result.id, url: url.href })
        open()
      })
      .catch(() => setState("error", true))
      .finally(() => setState("pending", false))
  }
  const cancel = async () => {
    const id = props.authentication.flow?.id
    if (!id) return
    setState({ pending: true, error: false })
    await props
      .cancel(id)
      .catch(() => setState("error", true))
      .finally(() => setState("pending", false))
  }
  return (
    <div data-component="native-mcp-authentication" class="flex flex-col gap-1">
      <Show when={state.error || error()}>
        <p role="alert" class="text-11-regular text-text-danger-base">
          {language.t(
            error() === "cancelled"
              ? "mcp.auth.cancelled"
              : error() === "storage"
                ? "mcp.auth.storage"
                : error() === "expired"
                  ? "mcp.auth.expired"
                  : error() === "invalid" || error() === "unsupported"
                    ? "mcp.auth.config"
                    : "mcp.auth.failed",
          )}
        </p>
      </Show>
      <Show when={!error() && props.authentication.flow}>
        {(flow) => (
          <p role="status" class="text-11-regular text-text-weak">
            {language.t(phases[flow().phase])}
          </p>
        )}
      </Show>
      <Show when={!props.authentication.flow && props.authentication.credentials === "available"}>
        <p class="text-11-regular text-text-weak">{language.t("mcp.auth.saved")}</p>
      </Show>
      <Show when={props.authentication.supported}>
        <p class="text-11-regular text-text-weak">{language.t("mcp.auth.remote")}</p>
        <div class="flex flex-wrap gap-1">
          <Button
            size="small"
            variant="ghost"
            data-action="authenticate"
            disabled={state.pending || active()}
            onClick={start}
          >
            {language.t("mcp.auth.start")}
          </Button>
          <Show when={active()}>
            <Button size="small" variant="ghost" data-action="auth-cancel" disabled={state.pending} onClick={cancel}>
              {language.t("mcp.auth.cancel")}
            </Button>
          </Show>
          <Show when={state.authorization}>
            <Button size="small" variant="ghost" data-action="auth-open" onClick={open}>
              {language.t("mcp.auth.open")}
            </Button>
            <Button size="small" variant="ghost" data-action="auth-copy" onClick={copy}>
              {language.t("mcp.auth.copy")}
            </Button>
          </Show>
        </div>
        <Show when={state.authorization}>
          {(authorization) => (
            <input
              readOnly
              dir="ltr"
              class="w-full min-w-0 text-11-regular"
              aria-label={language.t("mcp.auth.link")}
              value={authorization().url}
            />
          )}
        </Show>
      </Show>
    </div>
  )
}
