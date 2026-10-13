import { For, Match, Show, Switch } from "solid-js"
import type { FilePart } from "@apexo/sdk/v2"
import { useI18n } from "@apexo/ui/context/i18n"

export function ToolAttachments(props: { files: FilePart[] }) {
  const i18n = useI18n()
  return (
    <Show when={props.files.length}>
      <div data-component="tool-attachments">
        <For each={props.files}>
          {(file) => {
            const name = () => file.filename ?? i18n.t("ui.message.attachment.alt")
            return (
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
            )
          }}
        </For>
      </div>
    </Show>
  )
}
