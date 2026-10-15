import { For, Match, Show, Switch, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useData } from "../context/data"
import type { FilePart } from "@apexo/sdk/v2"
import { useI18n } from "@apexo/ui/context/i18n"

export function ToolAttachments(props: { files: FilePart[] }) {
  const i18n = useI18n()
  const data = useData()
  return (
    <Show when={props.files.length}>
      <div data-component="tool-attachments">
        <For each={props.files}>
          {(file) => {
            const name = () => file.filename ?? i18n.t("ui.message.attachment.alt")
            return (
              <Show
                when={
                  file.url.startsWith("file:") && file.mime === "video/mp4" && data.readMedia ? file.url : undefined
                }
                keyed
                fallback={
                  <Show when={/^(data:|https?:\/\/)/.test(file.url)}>
                    <figure>
                      <Switch>
                        <Match when={file.mime.startsWith("image/")}>
                          <img src={file.url} alt={name()} loading="lazy" />
                        </Match>
                        <Match when={file.mime.startsWith("video/")}>
                          <video src={file.url} controls preload="metadata" aria-label={name()} />
                        </Match>
                        <Match when={file.mime.startsWith("audio/")}>
                          <audio src={file.url} controls preload="metadata" aria-label={name()} />
                        </Match>
                      </Switch>
                      <figcaption>
                        <a href={file.url} download={name()} target="_blank" rel="noopener noreferrer">
                          {name()}
                        </a>
                      </figcaption>
                    </figure>
                  </Show>
                }
              >
                {(url) => <LocalVideo file={{ ...file, url }} read={data.readMedia!} />}
              </Show>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

function LocalVideo(props: { file: FilePart; read: (file: FilePart, signal: AbortSignal) => Promise<Blob> }) {
  const i18n = useI18n()
  const lifetime = new AbortController()
  const [state, setState] = createStore<{ loading: boolean; error: boolean; url?: string }>({
    loading: false,
    error: false,
  })
  const name = () => props.file.filename ?? i18n.t("ui.message.attachment.alt")
  onCleanup(() => {
    lifetime.abort()
    if (state.url) URL.revokeObjectURL(state.url)
  })
  const load = () => {
    if (state.loading || state.url || lifetime.signal.aborted) return
    setState({ loading: true, error: false })
    void props.read(props.file, lifetime.signal).then(
      (blob) => {
        if (lifetime.signal.aborted) return
        setState({ loading: false, url: URL.createObjectURL(blob) })
      },
      () => {
        if (!lifetime.signal.aborted) setState({ loading: false, error: true })
      },
    )
  }
  return (
    <figure data-component="local-video-attachment" data-loading={state.loading}>
      <Show
        when={state.url}
        fallback={
          <button type="button" disabled={state.loading} onClick={load}>
            {state.loading
              ? i18n.t("ui.fileMedia.state.loading", { kind: i18n.t("ui.fileMedia.kind.video") })
              : i18n.t("ui.fileMedia.previewVideo")}
          </button>
        }
      >
        {(url) => <video src={url()} controls preload="metadata" aria-label={name()} />}
      </Show>
      <Show when={state.error}>
        <p role="status">{i18n.t("ui.fileMedia.state.unavailable", { kind: i18n.t("ui.fileMedia.kind.video") })}</p>
      </Show>
      <figcaption>
        <Show when={state.url} fallback={<span>{name()}</span>}>
          {(url) => (
            <a href={url()} download={name()}>
              {name()}
            </a>
          )}
        </Show>
      </figcaption>
    </figure>
  )
}
