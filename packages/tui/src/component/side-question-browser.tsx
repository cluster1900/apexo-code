/** @jsxImportSource @opentui/solid */
import { open } from "node:fs/promises"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ColorInput, TextareaRenderable } from "@opentui/core"
import type { SideQuestionEntry, SideQuestionInput } from "@apexo/sdk/v2/client"
import { Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useBindings } from "../keymap"

export type SideQuestionActions = {
  list: (signal: AbortSignal) => Promise<SideQuestionEntry[]>
  ask: (input: SideQuestionInput, signal: AbortSignal) => Promise<SideQuestionEntry>
  cancel: (id: string, signal: AbortSignal) => Promise<SideQuestionEntry>
}
export function SideQuestionBrowser(props: {
  actions: SideQuestionActions
  question?: string
  images?: SideQuestionInput["images"]
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  height?: number
}) {
  const dimensions = useTerminalDimensions()
  const lifetime = new AbortController()
  let editor: TextareaRenderable | undefined
  const [state, setState] = createStore({
    items: [] as SideQuestionEntry[],
    selected: 0,
    question: props.question ?? "",
    editing: false as false | "question" | "image",
    images: (props.images ?? []) as NonNullable<SideQuestionInput["images"]>,
    pending: false,
    error: "",
  })
  const load = async () => {
    const items = await props.actions.list(lifetime.signal)
    if (!lifetime.signal.aborted) setState({ items, selected: Math.min(state.selected, Math.max(0, items.length - 1)) })
  }
  const run = async (work: () => Promise<void>) => {
    if (state.pending) return
    setState({ pending: true, error: "" })
    await work()
      .catch(() => {
        if (!lifetime.signal.aborted)
          setState("error", "Request failed; your question is kept. Refresh before retrying.")
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const ask = () =>
    run(async () => {
      if (!state.question.trim()) return
      await props.actions.ask({ question: state.question, images: state.images }, lifetime.signal)
      if (lifetime.signal.aborted) return
      setState({ question: "", editing: false, images: [] })
      await load()
      setState("selected", Math.max(0, state.items.length - 1))
    })
  const attach = (path: string) =>
    run(async () => {
      const file = await open(path.trim(), "r")
      const data = await (async () => {
        try {
          const stat = await file.stat()
          if (!stat.isFile() || stat.size > 50_000_000) throw new Error("Image is too large")
          return await file.readFile()
        } finally {
          await file.close()
        }
      })()
      const mediaType = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : data[0] === 255 && data[1] === 216
          ? "image/jpeg"
          : data.subarray(0, 3).toString() === "GIF"
            ? "image/gif"
            : data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP"
              ? "image/webp"
              : undefined
      if (
        !mediaType ||
        state.images.length >= 20 ||
        state.images.reduce((sum, image) => sum + Buffer.byteLength(image.data, "base64"), data.length) > 50_000_000
      )
        throw new Error("Invalid image")
      if (!lifetime.signal.aborted)
        setState({ images: [...state.images, { mediaType, data: data.toString("base64") }], editing: false })
    })
  onMount(() => {
    if (props.question?.trim()) void ask()
    else void run(load)
  })
  const timer = setInterval(() => {
    if (!state.pending && state.items.some((item) => item.status === "running")) void run(load)
  }, 1000)
  onCleanup(() => {
    clearInterval(timer)
    lifetime.abort()
  })
  useBindings(() => ({
    priority: 2,
    bindings: [
      {
        key: "escape",
        desc: "Close side questions",
        group: "Side questions",
        cmd: () => {
          if (state.editing) {
            if (state.editing === "question") setState("question", editor?.plainText ?? "")
            setState("editing", false)
            return
          }
          props.onClose()
        },
      },
    ],
  }))
  useKeyboard((key) => {
    if (key.name === "escape" || state.pending) return
    if (state.editing) {
      if (key.ctrl && key.name === "s") {
        key.preventDefault()
        if (state.editing === "image") {
          void attach(editor?.plainText ?? "")
          return
        }
        setState("question", editor?.plainText ?? "")
        void ask()
      }
      return
    }
    if (key.ctrl || key.meta) return
    key.preventDefault()
    if (key.name === "n") setState("editing", "question")
    if (key.name === "i") setState("editing", "image")
    if (key.name === "x") setState("images", [])
    if (key.name === "r") void run(load)
    if (key.name === "up") setState("selected", Math.max(0, state.selected - 1))
    if (key.name === "down") setState("selected", Math.min(state.items.length - 1, state.selected + 1))
    if (key.name === "c" && state.items[state.selected]?.status === "running")
      void run(async () => {
        await props.actions.cancel(state.items[state.selected]!.id, lifetime.signal)
        await load()
      })
  })
  return (
    <box
      flexDirection="column"
      padding={1}
      gap={1}
      height={props.height ?? Math.max(14, Math.min(28, dimensions().height - 8))}
    >
      <text fg={props.theme().highlight}>Side questions · main conversation continues independently</text>
      <Show
        when={state.editing}
        fallback={
          <>
            <Show when={state.items[state.selected]} fallback={<text>No side questions yet</text>}>
              {(entry) => (
                <>
                  <text>
                    {state.selected + 1}/{state.items.length} · {entry().status} · {entry().model}
                  </text>
                  <scrollbox flexGrow={1}>
                    <text>
                      {entry().question}
                      {"\n\n"}
                      {entry().answer ||
                        (entry().status === "failed" ? "This question could not be answered. Try again." : "")}
                    </text>
                  </scrollbox>
                </>
              )}
            </Show>
            <text fg={props.theme().muted}>
              n new · i attach image · x clear images · ↑/↓ answers · c cancel · r refresh · esc close
            </text>
          </>
        }
      >
        <text>
          {state.editing === "image" ? "Image file path · ctrl+s attach" : "Question · ctrl+s ask separately"} · esc
          return
        </text>
        <textarea
          ref={(value: TextareaRenderable) => {
            editor = value
          }}
          focused
          initialValue={state.editing === "image" ? "" : state.question}
          flexGrow={1}
          textColor={props.theme().text}
          focusedTextColor={props.theme().text}
        />
      </Show>
      <Show when={state.images.length}>
        <text>Images attached: {state.images.length}</text>
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>{state.error}</text>
      </Show>
    </box>
  )
}

export function sideQuestionImages(
  parts: ReadonlyArray<{ type: string; mime?: string; url?: string }>,
): NonNullable<SideQuestionInput["images"]> {
  return parts.flatMap((part) => {
    if (part.type !== "file") return []
    const mediaType = part.mime
    if (
      mediaType !== "image/png" &&
      mediaType !== "image/jpeg" &&
      mediaType !== "image/webp" &&
      mediaType !== "image/gif"
    )
      throw new Error("Side questions accept only PNG, JPEG, WebP, or GIF attachments")
    const prefix = `data:${mediaType};base64,`
    if (!part.url?.startsWith(prefix)) throw new Error("Attach image bytes directly to the side question")
    return [{ mediaType, data: part.url.slice(prefix.length) }]
  })
}
