import { showToast } from "@/utils/toast"
import { memoryActions, MemoryActionError } from "@/utils/session-memory"
import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { MemoryNote } from "@apexo/schema/memory-note"
import { MemoryMode } from "@apexo/schema/memory-mode"
import { Button } from "@apexo/ui/button"
import { Dialog } from "@apexo/ui/dialog"
import { useDialog } from "@apexo/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useCommand } from "@/context/command"
import { MemoryReviewDialog } from "./memory-review"
import { MemoryOperationsDialog } from "./memory-operations"
import { MemoryWorkDialog } from "./memory-work"
import { MemoryHealthDialog } from "./memory-health"
import { createMemoryCaptureNotifications, MemoryCaptureNotifications } from "./memory-capture-notifications"

export function createSessionMemory(sessionID: () => string | undefined) {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const command = useCommand()
  const [state, setState] = createStore({ enabled: false, native: false, active: true })
  onCleanup(() => setState("active", false))
  createEffect(() => {
    const scope = sdk()
    const client = scope.client
    const abort = new AbortController()
    setState("enabled", false)
    void scope.protocol
      .then(async (protocol) => {
        if (protocol === "v2") return { native: true, enabled: true }
        const result = await client.experimental.capabilities.get({}, { signal: abort.signal })
        return { native: false, enabled: result.data?.memoryManagement ?? false }
      })
      .then((result) => {
        if (!abort.signal.aborted) setState(result)
      })
      .catch(() => {})
    onCleanup(() => abort.abort())
  })
  const capture = createMemoryCaptureNotifications(() => (state.native ? undefined : sessionID()))
  const available = () => !!sessionID() && state.enabled
  const show = (id: string) => {
    const scope = sdk()
    dialog.show(() => (
      <MemoryBrowser sessionID={id} active={() => state.active && sessionID() === id && sdk() === scope} />
    ))
  }
  const open = () => {
    const id = sessionID()
    if (id && available()) show(id)
  }
  const review = (id: string, content = "") => {
    if (!state.enabled || state.native) return false
    dialog.show(() => <MemoryReviewDialog sessionID={id} content={content} />)
    return true
  }
  const work = (id: string, kind?: "flush" | "dream") => {
    if (!state.enabled) return false
    const scope = sdk()
    if (state.native) {
      dialog.show(() => (
        <MemoryOperationsDialog
          sessionID={id}
          kind={kind}
          active={() => state.active && sessionID() === id && sdk() === scope}
        />
      ))
      return true
    }
    dialog.show(() => <MemoryWorkDialog sessionID={id} kind={kind} />)
    return true
  }
  const memoryCommand = async (text: string, attachments: boolean) => {
    if ((await sdk().protocol) !== "v2") return false
    const id = sessionID()
    if (text.trim() === "/memory" && id && !attachments) {
      show(id)
      return true
    }
    if (id && !attachments && (text.trim() === "/flush" || text.trim() === "/dream")) {
      work(id, text.trim() === "/flush" ? "flush" : "dream")
      return true
    }
    showToast({
      title: language.t("memory.title"),
      description: language.t(
        !id
          ? "memory.native.sessionRequired"
          : attachments
            ? "memory.native.attachments"
            : "memory.operations.unsupported",
      ),
    })
    return true
  }
  command.register("session-memory", () => [
    {
      id: "session.memory",
      title: language.t("memory.title"),
      slash: "memory",
      disabled: state.native ? !state.enabled : !available(),
      onSelect: () => (state.native ? void memoryCommand("/memory", false) : open()),
    },
    {
      id: "session.remember",
      title: language.t("memory.review.title"),
      slash: "remember",
      disabled: state.native ? !state.enabled : !available(),
      description: state.native ? language.t("memory.operations.unsupported") : undefined,
      onSelect: () => {
        if (state.native) {
          void memoryCommand("/remember", false)
          return
        }
        const id = sessionID()
        if (id) review(id)
      },
    },
    ...(["flush", "dream"] as const).map((kind) => ({
      id: `session.memory.${kind}`,
      title: language.t(kind === "flush" ? "memory.work.flush" : "memory.work.dream"),
      slash: kind,
      disabled: state.native ? !state.enabled : !available(),
      description: state.native ? language.t("memory.operations.description") : undefined,
      onSelect: () => {
        if (state.native) {
          void memoryCommand(`/${kind}`, false)
          return
        }
        const id = sessionID()
        if (id) work(id, kind)
      },
    })),
  ])
  return { available, open, review, work, capture, command: memoryCommand, native: () => state.native }
}

export function MemoryButton(props: { memory: ReturnType<typeof createSessionMemory> }) {
  const language = useLanguage()
  return (
    <Show when={props.memory.available()}>
      <Button data-action="session-memory" size="small" variant="ghost" onClick={props.memory.open}>
        {language.t("memory.title")}
      </Button>
      <Show when={!props.memory.native()}>
        <MemoryCaptureNotifications capture={props.memory.capture} />
      </Show>
    </Show>
  )
}

function MemoryBrowser(props: { sessionID: string; active?: () => boolean }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const language = useLanguage()
  const [state, setState] = createStore({
    query: "",
    items: [] as MemoryNote.Summary[],
    selected: undefined as string | undefined,
    detail: undefined as MemoryNote.Detail | undefined,
    loading: false,
    pending: false,
    confirm: false,
    error: undefined as MemoryActionError["code"] | undefined,
    native: undefined as boolean | undefined,
    reload: 0,
    mode: undefined as MemoryMode.Info | undefined,
  })
  createEffect(() => {
    if (props.active && !props.active()) return
    const scope = sdk()
    const client = memoryActions(scope.client, props.sessionID, scope.protocol)
    state.reload
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    void scope.protocol
      .then((protocol) => {
        if (!abort.signal.aborted) setState("native", protocol === "v2")
      })
      .catch(() => {})
    const refresh = async () => {
      await client
        .status(abort.signal)
        .then((result) => {
          if (!abort.signal.aborted && !state.pending) setState("mode", result.data)
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setState({
              error: error instanceof MemoryActionError ? error.code : "failed",
              mode: undefined,
              items: [],
              selected: undefined,
              detail: undefined,
              confirm: false,
            })
        })
        .finally(() => {
          if (!abort.signal.aborted) timer = setTimeout(refresh, state.mode?.busy ? 250 : 2000)
        })
    }
    void refresh()
    onCleanup(() => {
      abort.abort()
      clearTimeout(timer)
    })
  })
  createEffect(() => {
    if (props.active && !props.active()) return
    const scope = sdk()
    const client = memoryActions(scope.client, props.sessionID, scope.protocol)
    const search = state.query
    state.reload
    if (!state.mode?.enabled) {
      setState({ items: [], selected: undefined, detail: undefined, confirm: false, loading: false })
      return
    }
    const abort = new AbortController()
    setState({ loading: true, error: undefined, confirm: false })
    void client
      .list(search, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return
        setState("items", result.data)
        setState("selected", (previous) =>
          result.data.some((note) => note.path === previous) ? previous : result.data[0]?.path,
        )
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setState({
            error: error instanceof MemoryActionError ? error.code : "failed",
            items: [],
            selected: undefined,
            detail: undefined,
            confirm: false,
          })
      })
      .finally(() => {
        if (!abort.signal.aborted) setState("loading", false)
      })
    onCleanup(() => abort.abort())
  })
  createEffect(() => {
    if (props.active && !props.active()) return
    const scope = sdk()
    const client = memoryActions(scope.client, props.sessionID, scope.protocol)
    const path = state.selected
    state.reload
    const abort = new AbortController()
    setState({ detail: undefined, confirm: false })
    if (path)
      void client
        .get(path, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted) setState("detail", result.data)
        })
        .catch((error) => {
          if (!abort.signal.aborted) setState("error", error instanceof MemoryActionError ? error.code : "failed")
        })
    onCleanup(() => abort.abort())
  })
  const lifetime = new AbortController()
  onCleanup(() => lifetime.abort())
  const toggle = async () => {
    if (!state.mode?.canToggle || state.pending) return
    const enabled = !state.mode.enabled
    if (enabled && state.mode.busy) return
    setState({ pending: true, error: undefined, confirm: false })
    await memoryActions(sdk().client, props.sessionID, sdk().protocol)
      .toggle(enabled, lifetime.signal)
      .then((result) => {
        if (!lifetime.signal.aborted) setState("mode", result.data)
      })
      .catch((error) => {
        if (!lifetime.signal.aborted)
          setState({
            error: error instanceof MemoryActionError ? error.code : "failed",
            mode: undefined,
            items: [],
            selected: undefined,
            detail: undefined,
            confirm: false,
          })
      })
      .finally(() => {
        if (lifetime.signal.aborted) return
        setState("pending", false)
        setState("reload", (value) => value + 1)
      })
  }
  const forget = async () => {
    const note = state.detail
    if (!note?.hash || !note.deletable || state.pending) return
    setState({ pending: true, error: undefined })
    await memoryActions(sdk().client, props.sessionID, sdk().protocol)
      .forget({ path: note.path, hash: note.hash }, lifetime.signal)
      .then(() => {
        if (lifetime.signal.aborted) return
        setState({ selected: undefined, detail: undefined })
        setState("reload", (value) => value + 1)
      })
      .catch((error) => {
        if (lifetime.signal.aborted) return
        // A conflict requires a fresh preview and a new confirmation.
        setState({ error: error instanceof MemoryActionError ? error.code : "failed", detail: undefined })
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState({ pending: false, confirm: false })
      })
  }
  createEffect(() => {
    if (!props.active || props.active()) return
    lifetime.abort()
    setState({ mode: undefined, items: [], selected: undefined, detail: undefined, confirm: false })
    dialog.close()
  })
  const sources = { global: "memory.global", workspace: "memory.workspace", session: "memory.sessions" } as const
  return (
    <Dialog size="large" title={language.t("memory.title")} description={language.t("memory.description")}>
      <div class="flex flex-col min-h-0 gap-3 px-5 pb-5" data-component="memory-browser">
        <Show when={state.native === false}>
          <Button
            variant="secondary"
            onClick={() => dialog.show(() => <MemoryHealthDialog sessionID={props.sessionID} />)}
          >
            {language.t("memory.health.title")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => dialog.show(() => <MemoryWorkDialog sessionID={props.sessionID} />)}
          >
            {language.t("memory.work.title")}
          </Button>
        </Show>
        <Show when={state.native}>
          <p data-component="memory-capabilities">{language.t("memory.operations.capabilities")}</p>
          <Button
            data-action="memory-operations-open"
            variant="secondary"
            disabled={props.active ? !props.active() : false}
            onClick={() =>
              dialog.show(() => <MemoryOperationsDialog sessionID={props.sessionID} active={props.active} />)
            }
          >
            {language.t("memory.operations.title")}
          </Button>
        </Show>
        <div class="flex items-center justify-between gap-3">
          <p role="status" data-component="memory-mode">
            {language.t(
              !state.mode
                ? "common.loading"
                : !state.mode.enabled && state.mode.busy
                  ? "memory.busy"
                  : state.mode.enabled
                    ? "memory.enabled"
                    : "memory.disabled",
            )}
          </p>
          <Button
            data-action="memory-toggle"
            disabled={state.pending || !state.mode?.canToggle || (!state.mode.enabled && state.mode.busy)}
            onClick={() => void toggle()}
          >
            {language.t(state.mode?.enabled ? "memory.disable" : "memory.enable")}
          </Button>
        </div>
        <Show when={state.error}>
          <p role="alert">
            {language.t(state.error && state.error !== "failed" ? `memory.native.${state.error}` : "memory.error")}
          </p>
        </Show>
        <Show when={state.mode?.enabled}>
          <div class="flex gap-2">
            <input
              class="flex-1 min-w-0 rounded border border-border-base px-3 py-2"
              type="search"
              aria-label={language.t("memory.search")}
              placeholder={language.t("memory.search")}
              value={state.query}
              disabled={state.pending}
              onInput={(event) => setState("query", event.currentTarget.value)}
            />
            <Button
              variant="secondary"
              disabled={state.pending}
              data-action="memory-refresh"
              onClick={() => setState("reload", (value) => value + 1)}
            >
              {language.t("memory.refresh")}
            </Button>
          </div>
          <Show when={state.loading}>
            <p role="status">{language.t("common.loading")}</p>
          </Show>
          <div class="grid grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] sm:grid-cols-2 sm:grid-rows-[minmax(0,1fr)] gap-3 h-[50vh] min-h-0 overflow-hidden">
            <div
              class="flex flex-col min-h-0 min-w-0 gap-2 overflow-auto"
              role="list"
              aria-label={language.t("memory.title")}
            >
              <Show when={!state.loading && state.items.length === 0}>
                <p>{language.t("memory.empty")}</p>
              </Show>
              <For each={["global", "workspace", "session"] as const}>
                {(source) => (
                  <Show when={state.items.some((note) => note.source === source)}>
                    <h3 class="text-12-regular text-text-weak">{language.t(sources[source])}</h3>
                    <For each={state.items.filter((note) => note.source === source)}>
                      {(note) => (
                        <button
                          type="button"
                          class="text-left rounded border border-border-weak-base p-2 break-all"
                          data-memory-path={note.path}
                          aria-pressed={state.selected === note.path}
                          disabled={state.pending}
                          onClick={() => setState({ selected: note.path, error: undefined })}
                        >
                          {note.name}
                        </button>
                      )}
                    </For>
                  </Show>
                )}
              </For>
            </div>
            <Show when={state.detail}>
              {(note) => (
                <section
                  class="min-w-0 min-h-0 flex flex-col gap-2 overflow-auto"
                  aria-label={language.t("memory.preview")}
                >
                  <p class="text-12-mono break-all">{note().path}</p>
                  <pre
                    tabIndex={0}
                    class="whitespace-pre-wrap break-words text-12-mono overflow-auto flex-1 min-h-0"
                    data-component="memory-preview"
                  >
                    {note().content}
                  </pre>
                  <Show when={note().truncated}>
                    <p>{language.t("memory.truncated")}</p>
                  </Show>
                  <Show when={note().deletable}>
                    <Show
                      when={state.confirm}
                      fallback={
                        <Button
                          variant="secondary"
                          disabled={state.pending}
                          data-action="memory-delete"
                          onClick={() => setState("confirm", true)}
                        >
                          {language.t("common.delete")}
                        </Button>
                      }
                    >
                      <p>{language.t("memory.confirm", { name: note().name })}</p>
                      <div class="flex gap-2">
                        <Button
                          disabled={state.pending}
                          data-action="memory-delete-confirm"
                          onClick={() => void forget()}
                        >
                          {language.t("memory.deleteConfirm")}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={state.pending}
                          data-action="memory-delete-cancel"
                          onClick={() => setState("confirm", false)}
                        >
                          {language.t("common.cancel")}
                        </Button>
                      </div>
                    </Show>
                  </Show>
                </section>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
