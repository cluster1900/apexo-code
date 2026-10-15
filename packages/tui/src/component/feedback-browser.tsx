/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ColorInput, TextareaRenderable } from "@opentui/core"
import type {
  FeedbackDraft,
  FeedbackIssue,
  FeedbackSave,
  FeedbackImageContent,
  FeedbackImageInput,
} from "@apexo/sdk/v2/client"
import { feedbackExport, feedbackImageSnapshot } from "@apexo/sdk/v2/feedback-images"
import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"

export type FeedbackActions = {
  list: (signal: AbortSignal) => Promise<FeedbackDraft[]>
  save: (input: FeedbackSave, signal: AbortSignal) => Promise<FeedbackDraft>
  review: (id: string, revision: number, signal: AbortSignal) => Promise<FeedbackIssue>
  image: (id: string, revision: number, imageID: string, signal: AbortSignal) => Promise<FeedbackImageContent>
  remove: (id: string, revision: number, signal: AbortSignal) => Promise<unknown>
}

export function FeedbackBrowser(props: {
  actions: FeedbackActions
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
  height?: number
}) {
  const dimensions = useTerminalDimensions()
  const clipboard = useClipboard()
  const lifetime = new AbortController()
  let editor: TextareaRenderable | undefined
  const empty: Omit<FeedbackSave, "draft_id" | "revision"> = { title: "", details: "", type: "bug" }
  const [state, setState] = createStore({
    items: [] as FeedbackDraft[],
    selected: 0,
    draft: undefined as FeedbackDraft | undefined,
    input: { ...empty },
    issue: undefined as FeedbackIssue | undefined,
    editing: undefined as "title" | "details" | "product_area" | undefined,
    pending: false,
    confirm: false,
    saving: false,
    attaching: false,
    imagePath: "",
    images: [] as { input: FeedbackImageInput; name: string; size: number }[],
    output: "",
    error: "",
    notice: "",
  })
  const run = async (work: () => Promise<void>) => {
    if (state.pending) return
    setState({ pending: true, error: "", notice: "" })
    await work()
      .catch(() => {
        if (!lifetime.signal.aborted)
          setState(
            "error",
            "Operation failed; your text and image selection are kept. Refresh and reopen the latest draft if its revision changed.",
          )
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const load = async () => {
    const items = await props.actions.list(lifetime.signal)
    if (!lifetime.signal.aborted) setState({ items, selected: Math.max(0, Math.min(state.selected, items.length - 1)) })
  }
  const select = (draft?: FeedbackDraft) =>
    setState({
      draft,
      input: draft
        ? {
            title: draft.title,
            details: draft.details,
            type: draft.type,
            product_area: draft.product_area,
            task_category: draft.task_category,
            failure_mode: draft.failure_mode,
          }
        : { ...empty },
      images: (draft?.images ?? []).map((image) => ({
        input: { id: image.id },
        name: image.fileName,
        size: image.size,
      })),
      issue: undefined,
      confirm: false,
      error: "",
      notice: "",
    })
  const save = (review: boolean) =>
    run(async () => {
      if (!state.input.title.trim() || (!state.input.details.trim() && !state.images.length)) {
        setState("error", "Enter a title and details or an image first.")
        return
      }
      const draft = await props.actions.save(
        {
          ...state.input,
          draft_id: state.draft?.id,
          revision: state.draft?.revision,
          images: state.images.map((image) => image.input),
        },
        lifetime.signal,
      )
      if (lifetime.signal.aborted) return
      setState({
        draft,
        notice: "Saved locally. Not submitted.",
        issue: undefined,
        images: (draft.images ?? []).map((image) => ({
          input: { id: image.id },
          name: image.fileName,
          size: image.size,
        })),
      })
      if (review) {
        const issue = await props.actions.review(draft.id, draft.revision, lifetime.signal)
        if (!lifetime.signal.aborted) setState("issue", issue)
      }
      await load()
    })
  const attach = async (file: Blob & { readonly name?: string }) => {
    if (
      state.images.length >= 4 ||
      state.images.reduce((total, image) => total + image.size, 0) + file.size > 16 * 1024 * 1024
    )
      throw new Error("feedback_image_limit")
    const input = await feedbackImageSnapshot(file)
    if (!lifetime.signal.aborted)
      setState({
        images: [...state.images, { input, name: input.fileName ?? "Clipboard image", size: file.size }],
        issue: undefined,
        attaching: false,
        notice: "Image selected. Save to keep it with this draft.",
      })
  }
  onMount(() => void run(load))
  onCleanup(() => lifetime.abort())
  useBindings(() => ({
    priority: 2,
    bindings: [
      {
        key: "escape",
        desc: "Close feedback review",
        group: "Feedback",
        cmd: () => {
          if (state.pending) return
          if (state.editing || state.issue || state.confirm || state.saving || state.attaching) {
            setState({ editing: undefined, issue: undefined, confirm: false, saving: false, attaching: false })
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
        setState("input", state.editing, editor?.plainText ?? "")
        setState({ editing: undefined, issue: undefined, notice: "" })
      }
      return
    }
    if (state.saving || state.attaching || key.ctrl || key.meta) return
    key.preventDefault()
    if (state.confirm) {
      if (key.name === "n") setState("confirm", false)
      if (key.name === "y" && state.draft)
        void run(async () => {
          await props.actions.remove(state.draft!.id, state.draft!.revision, lifetime.signal)
          if (!lifetime.signal.aborted) {
            select()
            await load()
          }
        })
      return
    }
    if (state.issue) {
      if (key.name === "o")
        void run(async () => {
          const { openUrl } = await import("@apexo/core/open")
          await openUrl(state.issue!.url)
          if (!lifetime.signal.aborted)
            setState("notice", "Issue form opened. Submit it manually; this local draft is retained.")
        })
      if (key.name === "c")
        void run(async () => {
          if (!clipboard.write) throw new Error("Clipboard unavailable")
          await clipboard.write(state.issue!.body)
          if (!lifetime.signal.aborted) setState("notice", "Issue body copied")
        })
      if (key.name === "d") setState({ saving: true, output: "" })
      return
    }
    if (key.name === "i") setState({ attaching: true, imagePath: "" })
    if (key.name === "p")
      void run(async () => {
        const image = await clipboard.read?.()
        if (
          !image ||
          !["image/png", "image/jpeg", "image/gif"].includes(image.mime) ||
          image.data.length > 4 * Math.ceil((8 * 1024 * 1024) / 3)
        )
          throw new Error("feedback_clipboard_image")
        await attach(new Blob([Buffer.from(image.data, "base64")], { type: image.mime }))
      })
    if (/^[1-4]$/.test(key.name))
      setState({
        images: state.images.filter((_, index) => index !== Number(key.name) - 1),
        issue: undefined,
        notice: "Image removed from selection. Save to update the draft.",
      })
    if (key.name === "up") setState("selected", Math.max(0, state.selected - 1))
    if (key.name === "down") setState("selected", Math.min(state.items.length - 1, state.selected + 1))
    if (key.name === "return" && state.items[state.selected]) select(state.items[state.selected])
    if (key.name === "n") select()
    if (key.name === "r") void run(load)
    if (key.name === "t") setState("editing", "title")
    if (key.name === "e") setState("editing", "details")
    if (key.name === "a") setState("editing", "product_area")
    if (key.name === "y") {
      const values = ["bug", "idea", "missing_capability"] as const
      setState("input", "type", values[(values.indexOf(state.input.type) + 1) % values.length])
    }
    if (key.name === "c") {
      const values = [undefined, "code_edit", "debug", "explain", "plan", "shell", "search", "review", "other"] as const
      setState("input", "task_category", values[(values.indexOf(state.input.task_category) + 1) % values.length])
    }
    if (key.name === "f") {
      const values = [
        undefined,
        "overeager",
        "stopped_early",
        "unwanted_scope",
        "didnt_ask_for_help",
        "excessive_questions",
        "subagent_overspawn",
        "over_correction",
        "ignored_instructions",
        "hallucinated",
        "sloppy_code",
        "destructive",
        "lost_context",
        "stuck_in_a_loop",
        "model_regression",
        "disputed",
        "wrong_tone",
        "unclear_output",
        "other",
      ] as const
      setState("input", "failure_mode", values[(values.indexOf(state.input.failure_mode) + 1) % values.length])
    }
    if (key.name === "s") void save(false)
    if (key.name === "v") void save(true)
    if (key.name === "x" && state.draft) setState("confirm", true)
  })
  return (
    <box
      flexDirection="column"
      padding={1}
      gap={1}
      height={props.height ?? Math.max(14, Math.min(28, dimensions().height - 8))}
    >
      <text fg={props.theme().highlight}>Feedback drafts · local until you manually submit the GitHub issue</text>
      <Show
        when={state.editing}
        fallback={
          <Show
            when={state.issue}
            fallback={
              <>
                <box height={Math.min(4, Math.max(1, state.items.length))}>
                  <For each={state.items.slice(Math.max(0, state.selected - 3), Math.max(0, state.selected - 3) + 4)}>
                    {(draft) => (
                      <text
                        fg={
                          draft.id === state.items[state.selected]?.id ? props.theme().highlight : props.theme().muted
                        }
                      >
                        {draft.id === state.items[state.selected]?.id ? "> " : "  "}
                        {draft.title}
                      </text>
                    )}
                  </For>
                  <Show when={!state.items.length}>
                    <text>No saved drafts</text>
                  </Show>
                </box>
                <text>Title: {state.input.title || "(empty)"}</text>
                <text>
                  Type: {state.input.type} · Area: {state.input.product_area || "unspecified"}
                </text>
                <text>
                  Category: {state.input.task_category || "unspecified"} · Failure:{" "}
                  {state.input.failure_mode || "unspecified"}
                </text>
                <scrollbox flexGrow={1}>
                  <text>{state.input.details || "No details yet"}</text>
                </scrollbox>
                <For each={state.images}>
                  {(image, index) => (
                    <text>
                      {index() + 1}. {image.name} ({image.size} bytes)
                    </text>
                  )}
                </For>
                <text fg={props.theme().muted}>
                  i image file · p paste image · 1–4 remove image · PNG/JPEG/GIF · 4 images · 8 MiB each · 16 MiB total
                </text>
                <text fg={props.theme().muted}>
                  ↑↓ select · enter load · n new · r refresh · t title · e details · a area
                </text>
                <text fg={props.theme().muted}>
                  y type · c category · f failure · s save · v save + review · x delete · esc close
                </text>
              </>
            }
          >
            {(issue) => (
              <>
                <scrollbox flexGrow={1}>
                  <text>
                    {issue().title}
                    {"\n\n"}
                    {issue().body}
                  </text>
                </scrollbox>
                <Show when={!new URL(issue().url).searchParams.has("body")}>
                  <text>Large draft: copy or download the body, then paste it into GitHub.</text>
                </Show>
                <Show when={issue().draft.images?.length}>
                  <text>Export to preview and download images, then attach them to GitHub yourself.</text>
                </Show>
                <text fg={props.theme().muted}>
                  o open GitHub form (not submit) · c copy body · d save report · esc edit
                </text>
              </>
            )}
          </Show>
        }
      >
        <text>Editing {state.editing} · ctrl+s keep changes · esc cancel</text>
        <textarea
          ref={(value: TextareaRenderable) => {
            editor = value
          }}
          focused
          initialValue={state.input[state.editing!] ?? ""}
          flexGrow={1}
          textColor={props.theme().text}
          focusedTextColor={props.theme().text}
        />
      </Show>
      <Show when={state.attaching}>
        <text>Local PNG/JPEG/GIF file to attach (8 MiB maximum):</text>
        <input
          value={state.imagePath}
          focused={!state.pending}
          onInput={(value) => setState("imagePath", value)}
          onSubmit={() =>
            void run(async () => {
              const { open } = await import("node:fs/promises")
              const { basename } = await import("node:path")
              await using file = await open(state.imagePath, "r")
              const info = await file.stat()
              if (!info.isFile() || !info.size || info.size > 8 * 1024 * 1024) throw new Error("feedback_image_size")
              // Bounded read also rejects a file that grows after stat.
              const bytes = Buffer.alloc(Math.min(info.size + 1, 8 * 1024 * 1024 + 1))
              const read = await file.read(bytes, 0, bytes.length, 0)
              if (read.bytesRead !== info.size) throw new Error("feedback_image_changed")
              await attach(new File([bytes.subarray(0, read.bytesRead)], basename(state.imagePath)))
            })
          }
        />
      </Show>
      <Show when={state.saving}>
        <text>
          Save to a new local file ({state.issue?.draft.images?.length ? "HTML" : "Markdown"}; existing files are never
          overwritten):
        </text>
        <input
          value={state.output}
          focused={!state.pending}
          onInput={(value) => setState("output", value)}
          onSubmit={() =>
            void run(async () => {
              const issue = state.issue!
              const images = await Promise.all(
                (issue.draft.images ?? []).map((image) =>
                  props.actions.image(issue.draft.id, issue.draft.revision, image.id, lifetime.signal),
                ),
              )
              const exported = feedbackExport(issue, images, {
                manual: "Images stay local. Download these images and attach them to the GitHub issue yourself.",
                download: "Download image",
              })
              const { open } = await import("node:fs/promises")
              await using file = await open(state.output, "wx", 0o600)
              await file.writeFile(exported.content, "utf8")
              if (!lifetime.signal.aborted) setState({ saving: false, notice: `Saved ${state.output}` })
            })
          }
        />
      </Show>
      <Show when={state.confirm}>
        <text fg={props.theme().error}>Delete this saved local draft? y confirm · n cancel</text>
      </Show>
      <Show when={state.pending}>
        <text>Working…</text>
      </Show>
      <Show when={state.notice}>
        <text fg={props.theme().muted}>{state.notice}</text>
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>{state.error}</text>
      </Show>
    </box>
  )
}
