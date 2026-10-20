import { useLayout } from "@/context/layout"
import { useServerSync } from "@/context/server-sync"
import { useServer } from "@/context/server"
import { createMemo, createEffect, For, on, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { PluginStoreRuntime } from "@apexo/sdk/v2/client"
import type { PluginStore } from "@apexo/schema/plugin-store"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { Icon } from "@apexo/ui/icon"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import "./plugins.css"

export function PluginsDialog() {
  const language = useLanguage()
  return (
    <Dialog title={language.t("plugins.title")} size="x-large" class="plugins-dialog">
      <Plugins />
    </Dialog>
  )
}

export function Plugins() {
  const language = useLanguage()
  const sdk = useServerSDK()
  const platform = usePlatform()
  const layout = useLayout()
  const serverSync = useServerSync()
  const server = useServer()
  const requests = { controller: new AbortController(), runtime: new AbortController() }
  const api = createMemo(() => {
    const current = sdk()
    return current.protocol.then((protocol) => (protocol === "v2" ? current.client.v2.plugins : current.client.plugins))
  })
  const directory = () => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return undefined
  }
  const [state, setState] = createStore({
    catalog: { sources: [], items: [] } as PluginStore.Catalog,
    tab: "discover",
    query: "",
    source: "",
    sourceInput: "",
    form: "",
    selected: "",
    readme: "",
    pending: false,
    loading: true,
    error: false,
    errorMessage: "",
    confirm: undefined as PluginStore.Action | undefined,
    changed: false,
    runtime: undefined as PluginStoreRuntime | undefined,
    reloadBusy: false,
    runtimeError: false,
    runtimeLoading: false,
  })
  const selected = createMemo(() => state.catalog.items.find((item) => item.id === state.selected))
  const items = createMemo(() =>
    state.catalog.items.filter(
      (item) =>
        (state.tab !== "installed" || item.status !== "available") &&
        (!state.source || item.sourceID === state.source) &&
        `${item.name} ${item.description} ${item.category} ${item.author ?? ""}`
          .toLowerCase()
          .includes(state.query.toLowerCase()),
    ),
  )
  const manage = async (action: PluginStore.Action) => {
    if (state.pending) return
    const signal = requests.controller.signal
    const client = api()
    setState({ pending: true, error: false, errorMessage: "", reloadBusy: false })
    await client
      .then((plugins) => plugins.manage({ pluginStoreAction: action }, { signal, throwOnError: true }))
      .then((result) => {
        if (signal.aborted) return
        setState("catalog", reconcile(result.data))
        setState({ form: "", sourceInput: "", confirm: undefined, error: false, errorMessage: "" })
        if (["install", "update", "enable", "disable", "uninstall"].includes(action.action)) setState("changed", true)
      })
      .catch((err) => {
        if (signal.aborted) return
        const msg =
          err && typeof err === "object" && "message" in err && typeof err.message === "string"
            ? err.message
            : err &&
                typeof err === "object" &&
                "data" in err &&
                err.data &&
                typeof err.data === "object" &&
                "message" in err.data &&
                typeof err.data.message === "string"
              ? err.data.message
              : ""
        setState({
          error: true,
          errorMessage: msg.startsWith("Plugin path does not exist:")
            ? language.t("plugins.error.pathNotFound", {
                path: msg.slice("Plugin path does not exist:".length).trim(),
              })
            : msg,
          ...(state.form ? { confirm: undefined } : {}),
        })
        if (state.form) {
          requestAnimationFrame(() => {
            const input = document.getElementById("plugins-source")
            if (input instanceof HTMLInputElement) input.focus()
          })
        }
      })
      .finally(() => {
        if (!signal.aborted) setState("pending", false)
      })
  }
  createEffect(() => {
    const client = api()
    const abort = new AbortController()
    requests.controller = abort
    setState({
      catalog: { sources: [], items: [] },
      selected: "",
      source: "",
      pending: false,
      loading: true,
      error: false,
      changed: false,
      confirm: undefined,
      form: "",
    })
    void client
      .then((plugins) => plugins.list({}, { signal: abort.signal, throwOnError: true }))
      .then(async (result) => {
        if (abort.signal.aborted) return
        setState("catalog", reconcile(result.data))
        if (!result.data.items.length && result.data.sources.some((source) => !source.updatedAt))
          await manage({ action: "refresh" })
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("error", true)
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("loading", false)
      })
    onCleanup(() => abort.abort())
  })
  createEffect(
    on(
      () => [state.selected, selected()?.path],
      ([id]) => {
        const client = api()
        const abort = new AbortController()
        setState("readme", "")
        if (id)
          void client
            .then((plugins) => plugins.detail({ id }, { signal: abort.signal, throwOnError: true }))
            .then((result) => {
              if (!abort.signal.aborted) setState("readme", result.data.readme)
            })
            .catch(() => {
              if (!abort.signal.aborted) setState("error", true)
            })
        onCleanup(() => abort.abort())
      },
    ),
  )
  const action = (action: PluginStore.Action) => {
    if (["install", "enable", "update", "uninstall", "remove-source"].includes(action.action)) {
      setState("confirm", action)
      return
    }
    void manage(action)
  }
  const status = (item: PluginStore.Item) => language.t(`plugins.status.${item.status}`)
  const category = (item: PluginStore.Item) =>
    item.category === "other" ? language.t("settings.providers.tag.other") : item.category
  const refreshRuntime = async () => {
    const current = sdk()
    const target = directory()
    const signal = requests.runtime.signal
    if (!target || (await current.protocol) !== "v2" || signal.aborted) return
    setState({ runtimeLoading: true, runtimeError: false })
    await current.client.v2.plugins
      .runtime({ location: { directory: target } }, { signal, throwOnError: true })
      .then((result) => {
        if (!signal.aborted) setState("runtime", reconcile(result.data))
      })
      .catch(() => {
        if (!signal.aborted) setState("runtimeError", true)
      })
      .finally(() => {
        if (!signal.aborted) setState("runtimeLoading", false)
      })
  }
  createEffect(() => {
    sdk()
    directory()
    const abort = new AbortController()
    requests.runtime = abort
    setState({ runtime: undefined, runtimeError: false, runtimeLoading: false })
    void refreshRuntime()
    onCleanup(() => abort.abort())
  })
  const reload = async () => {
    if (state.pending) return
    const current = sdk()
    const target = directory()
    const signal = requests.controller.signal
    setState({ pending: true, error: false, reloadBusy: false })
    await (async () => {
      if ((await current.protocol) === "v2") {
        if (!target) return
        const result = await current.client.v2.plugins.reload(
          { location: { directory: target } },
          { signal, throwOnError: false },
        )
        if (!result.response.ok) {
          if (!signal.aborted) setState("reloadBusy", result.response.status === 409)
          throw result.error
        }
        return
      }
      await current.client.plugins.reload({ directory: target }, { signal, throwOnError: true })
    })()
      .then(() => {
        if (!signal.aborted) setState("changed", false)
      })
      .catch(() => {
        if (!signal.aborted) setState("error", true)
      })
      .finally(async () => {
        if (signal.aborted) return
        await refreshRuntime()
        if (!signal.aborted) setState("pending", false)
      })
  }
  return (
    <section class="plugins-store" aria-label={language.t("plugins.title")} data-component="plugins-store">
      <header class="plugins-header">
        <div>
          <h1>{language.t("plugins.title")}</h1>
          <p>{language.t("plugins.description")}</p>
        </div>
        <div class="plugins-actions">
          <Button variant="ghost" disabled={state.pending} onClick={() => void manage({ action: "refresh" })}>
            {language.t("wsl.onboarding.refresh")}
          </Button>
          <Button
            onClick={() =>
              setState({ form: "install", selected: "", confirm: undefined, error: false, errorMessage: "" })
            }
          >
            {language.t("plugins.add")}
          </Button>
        </div>
      </header>
      <nav class="plugins-tabs" aria-label={language.t("plugins.title")}>
        <For each={["discover", "installed", "sources"] as const}>
          {(tab) => (
            <button
              type="button"
              aria-pressed={!state.form && state.tab === tab}
              onClick={() =>
                setState({ tab, selected: "", form: "", confirm: undefined, error: false, errorMessage: "" })
              }
            >
              {language.t(`plugins.${tab}`)}
            </button>
          )}
        </For>
      </nav>
      <Show when={state.error}>
        <div role="alert" class="plugins-notice">
          {state.reloadBusy
            ? language.t("plugins.activation.failure.busy")
            : state.errorMessage || language.t("plugins.error")}
        </div>
      </Show>
      <Show when={sdk().protocolKind() === "v2"}>
        <section
          class="plugins-notice plugins-runtime"
          data-component="plugins-runtime"
          aria-label={language.t("plugins.activation.title")}
        >
          <strong>{language.t("plugins.activation.title")}</strong>
          <p>{language.t("plugins.activation.hint")}</p>
          <Show when={directory()} fallback={<p>{language.t("plugins.activation.projectRequired")}</p>}>
            <Show when={state.runtime}>
              {(runtime) => (
                <>
                  <p data-component="plugins-runtime-generation">
                    {language.t("plugins.activation.generation", { generation: runtime().generation })}
                  </p>
                  <Show when={runtime().failure}>
                    {(failure) => (
                      <div role="alert" data-component="plugins-runtime-failure">
                        <p>{language.t(`plugins.activation.failure.${failure().code}`)}</p>
                        <Show when={failure().components?.length}>
                          <p>{failure().components?.join(", ")}</p>
                        </Show>
                        <p>{failure().message}</p>
                      </div>
                    )}
                  </Show>
                </>
              )}
            </Show>
            <Show when={state.runtimeError}>
              <p role="alert">{language.t("plugins.activation.unavailable")}</p>
            </Show>
            <div class="plugins-actions">
              <Button
                variant="ghost"
                data-action="plugins-runtime-refresh"
                disabled={state.pending || state.runtimeLoading}
                onClick={() => void refreshRuntime()}
              >
                {language.t("wsl.onboarding.refresh")}
              </Button>
              <Button
                data-action="plugins-runtime-reload"
                disabled={state.pending || state.runtimeLoading}
                onClick={() => void reload()}
              >
                {language.t("plugins.reload")}
              </Button>
            </div>
          </Show>
        </section>
      </Show>
      <Show when={state.changed && sdk().protocolKind() !== "v2"}>
        <div role="status" class="plugins-notice plugins-notice-row">
          <span>{language.t("plugins.changed")}</span>
          <Button variant="secondary" size="small" disabled={state.pending} onClick={() => void reload()}>
            {language.t("plugins.reload")}
          </Button>
        </div>
      </Show>
      <Show when={state.catalog.retainedData?.length}>
        <div role="status" class="plugins-notice">
          {language.t("plugins.cleanupDeferred")}
        </div>
      </Show>
      <Show when={state.pending || state.loading}>
        <div role="status" class="plugins-progress">
          {language.t("common.loading")}
        </div>
      </Show>
      <Show when={state.confirm}>
        {(confirmation) => {
          const targetItem = () => state.catalog.items.find((item) => item.id === confirmation().id)
          const confirmTitle = () => {
            if (confirmation().action === "uninstall") {
              return language.t("plugins.uninstallConfirmTitle", {
                name: targetItem()?.name ?? confirmation().id ?? "",
              })
            }
            if (confirmation().action === "remove-source") {
              return language.t("plugins.removeSourceConfirmTitle")
            }
            return language.t("plugins.confirm")
          }
          const confirmBody = () => {
            if (confirmation().action === "uninstall") return language.t("plugins.uninstallNotice")
            if (confirmation().action === "remove-source") return language.t("plugins.removeSourceNotice")
            return language.t("plugins.trust")
          }
          const isDestructive = () =>
            confirmation().action === "uninstall" || confirmation().action === "remove-source"
          return (
            <div role="alertdialog" aria-label={confirmTitle()} class="plugins-confirm">
              <h2>{confirmTitle()}</h2>
              <p>{confirmBody()}</p>
              <code>{confirmation().source ?? targetItem()?.source ?? confirmation().id}</code>
              <Show when={confirmation().action === "uninstall"}>
                <label class="plugins-confirm-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmation().keepData ?? false}
                    disabled={state.pending}
                    onChange={(event) =>
                      setState("confirm", { ...confirmation(), keepData: event.currentTarget.checked })
                    }
                  />
                  <span>{language.t("plugins.keepData")}</span>
                </label>
              </Show>
              <div class="plugins-actions">
                <Button variant="ghost" disabled={state.pending} onClick={() => setState("confirm", undefined)}>
                  {language.t("common.cancel")}
                </Button>
                <Button
                  class={isDestructive() ? "plugins-danger-button" : undefined}
                  disabled={state.pending}
                  onClick={() => void manage({ ...confirmation(), trust: true })}
                >
                  {language.t("common.continue")}
                </Button>
              </div>
            </div>
          )
        }}
      </Show>
      <Show when={state.form && !state.confirm}>
        <form
          class="plugins-form"
          onSubmit={(event) => {
            event.preventDefault()
            action({ action: state.form === "source" ? "add-source" : "install", source: state.sourceInput.trim() })
          }}
        >
          <h2>{language.t(state.form === "source" ? "plugins.addSource" : "plugins.add")}</h2>
          <label for="plugins-source">{language.t("plugins.sourceInput")}</label>
          <input
            id="plugins-source"
            value={state.sourceInput}
            onInput={(event) => setState({ sourceInput: event.currentTarget.value, error: false, errorMessage: "" })}
            placeholder={language.t("plugins.sourcePlaceholder")}
            required
          />
          <div class="plugins-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setState({ form: "", error: false, errorMessage: "" })}
            >
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" disabled={state.pending || !state.sourceInput.trim()}>
              {language.t("common.continue")}
            </Button>
          </div>
        </form>
      </Show>
      <Show when={!state.form && selected()}>
        {(item) => (
          <article class="plugins-detail">
            <Button
              variant="ghost"
              onClick={() => setState({ selected: "", confirm: undefined, error: false, errorMessage: "" })}
            >
              {language.t("common.goBack")}
            </Button>
            <div class="plugins-detail-heading">
              <div class="plugins-avatar" aria-hidden="true">
                {item().name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h2>{item().name}</h2>
                <p>{item().author ?? category(item())}</p>
              </div>
              <span class="plugins-badge">{status(item())}</span>
            </div>
            <Show when={state.runtime}>
              <p data-component="plugins-activation-status">
                {language.t(
                  state.runtime?.active.includes(item().id)
                    ? "plugins.activation.active"
                    : "plugins.activation.inactive",
                )}
              </p>
            </Show>
            <p>{item().description}</p>
            <div class="plugins-actions">
              <Show when={item().status === "available" || item().status === "downloaded"}>
                <Button disabled={state.pending} onClick={() => action({ action: "install", id: item().id })}>
                  {language.t("wsl.onboarding.install")}
                </Button>
              </Show>
              <Show when={item().status === "available"}>
                <Button
                  variant="secondary"
                  disabled={state.pending}
                  onClick={() => action({ action: "download", id: item().id })}
                >
                  {language.t("plugins.download")}
                </Button>
              </Show>
              <Show when={item().status === "enabled" || item().status === "disabled"}>
                <Button
                  variant="secondary"
                  disabled={state.pending}
                  onClick={() => action({ action: item().status === "enabled" ? "disable" : "enable", id: item().id })}
                >
                  {language.t(item().status === "enabled" ? "plugins.disable" : "plugins.enable")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={state.pending}
                  onClick={() => action({ action: "update", id: item().id })}
                >
                  {language.t("plugins.update")}
                </Button>
              </Show>
              <Show when={item().status !== "available"}>
                <Button
                  variant="ghost"
                  disabled={state.pending}
                  onClick={() => action({ action: "uninstall", id: item().id })}
                >
                  {language.t("plugins.uninstall")}
                </Button>
              </Show>
            </div>
            <dl class="plugins-metadata">
              <dt>{language.t("plugins.sources")}</dt>
              <dd>{item().source}</dd>
              <dt>{language.t("plugins.version")}</dt>
              <dd>
                {item().installedVersion ??
                  item().version ??
                  item().installedRevision?.slice(0, 12) ??
                  item().revision?.slice(0, 12) ??
                  "—"}
              </dd>
            </dl>
            <Show when={item().path}>
              <div class="plugins-path">
                <span>{language.t("plugins.files")}</span>
                <code>{item().path}</code>
                <Show when={platform.openPath && server.isLocal()}>
                  <Button variant="ghost" onClick={() => void platform.openPath?.(item().path!)}>
                    {language.t("common.open")}
                  </Button>
                </Show>
              </div>
            </Show>
            <Show when={item().warnings.includes("hooks")}>
              <div class="plugins-notice">{language.t("plugins.hooksWarning")}</div>
            </Show>
            <h3>{language.t("plugins.contents")}</h3>
            <div class="plugins-components">
              <For each={item().components}>
                {(component) => (
                  <div>
                    <span class="plugins-badge">{language.t(`plugins.component.${component.kind}`)}</span>
                    <strong>{component.name}</strong>
                    <Show when={component.description}>
                      <p>{component.description}</p>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Show when={state.readme}>
              <h3>{language.t("plugins.readme")}</h3>
              <pre class="plugins-readme">{state.readme}</pre>
            </Show>
          </article>
        )}
      </Show>
      <Show when={!state.form && !selected() && state.tab === "sources"}>
        <div class="plugins-source-heading">
          <h2>{language.t("plugins.sources")}</h2>
          <Button onClick={() => setState("form", "source")}>{language.t("plugins.addSource")}</Button>
        </div>
        <For each={state.catalog.sources}>
          {(source) => (
            <article class="plugins-source">
              <div>
                <h3>{source.name}</h3>
                <p>{source.location}</p>
                <Show when={source.error}>
                  <p role="alert">{language.t("plugins.sourceError")}</p>
                </Show>
              </div>
              <Button
                variant="ghost"
                disabled={state.pending}
                onClick={() => action({ action: "remove-source", id: source.id })}
              >
                {language.t("plugins.removeSource")}
              </Button>
            </article>
          )}
        </For>
      </Show>
      <Show when={!state.form && !selected() && state.tab !== "sources"}>
        <div class="plugins-filters">
          <input
            aria-label={language.t("common.search.placeholder")}
            placeholder={language.t("plugins.search")}
            value={state.query}
            onInput={(event) => setState("query", event.currentTarget.value)}
          />
          <select
            aria-label={language.t("plugins.sources")}
            value={state.source}
            onChange={(event) => setState("source", event.currentTarget.value)}
          >
            <option value="">{language.t("plugins.allSources")}</option>
            <For each={state.catalog.sources}>{(source) => <option value={source.id}>{source.name}</option>}</For>
          </select>
        </div>
        <h2>
          {language.t(
            state.tab === "installed"
              ? "plugins.installed"
              : items().length && items().every((item) => item.recommended)
                ? "plugins.recommended"
                : "plugins.discover",
          )}
        </h2>
        <Show when={!state.loading && !items().length}>
          <p class="plugins-empty">{language.t("plugins.empty")}</p>
        </Show>
        <div class="plugins-grid">
          <For each={items()}>
            {(item) => (
              <button
                type="button"
                class="plugins-card"
                onClick={() => setState({ selected: item.id, confirm: undefined, error: false, errorMessage: "" })}
              >
                <div class="plugins-card-top">
                  <div class="plugins-avatar" aria-hidden="true">
                    {item.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3>{item.name}</h3>
                    <span>{item.author ?? category(item)}</span>
                  </div>
                  <Show when={item.status !== "available"}>
                    <span class="plugins-badge">{status(item)}</span>
                    <Show when={state.runtime}>
                      <span class="plugins-badge" data-component="plugins-activation-status">
                        {language.t(
                          state.runtime?.active.includes(item.id)
                            ? "plugins.activation.active"
                            : "plugins.activation.inactive",
                        )}
                      </span>
                    </Show>
                  </Show>
                </div>
                <p>{item.description}</p>
                <div class="plugins-card-bottom">
                  <span>{category(item)}</span>
                  <Icon name="arrow-right" />
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}
