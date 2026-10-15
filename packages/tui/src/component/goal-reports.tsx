/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid"
import { For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { ColorInput } from "@opentui/core"
import type { GoalReport, GoalReportContent } from "@apexo/sdk/v2/client"
import type { GoalActions } from "./session-goal"
import { useBindings } from "../keymap"

export function GoalReports(props: {
  goalID: string
  canCleanup: boolean
  actions: GoalActions
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onClose: () => void
}) {
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    reports: [] as GoalReport[],
    content: undefined as GoalReportContent | undefined,
    selected: 0,
    pending: false,
    confirm: false,
    saving: false,
    output: "",
    error: "",
    notice: "",
  })
  const files = () => state.reports.flatMap((report) => report.files.map((file) => ({ reportID: report.id, ...file })))
  const run = async (work: () => Promise<void>) => {
    if (state.pending) return
    setState({ pending: true, error: "", notice: "" })
    await work()
      .catch(() => {
        if (!lifetime.signal.aborted)
          setState(
            "error",
            "Could not read, save, or remove the report. Check its integrity, destination, and Goal status, then retry.",
          )
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  const refresh = async () => {
    const reports = await props.actions.reports(props.goalID, lifetime.signal)
    if (!lifetime.signal.aborted) setState({ reports, content: undefined, selected: 0 })
  }
  const read = (save: boolean) =>
    run(async () => {
      const file = files()[state.selected]
      if (!file) return
      const content = await props.actions.report(props.goalID, file.reportID, file.key, lifetime.signal)
      if (lifetime.signal.aborted) return
      if (save) {
        const { open } = await import("node:fs/promises")
        await using output = await open(state.output, "wx", 0o600)
        await output.writeFile(content.text, "utf8")
        if (!lifetime.signal.aborted) setState({ saving: false, notice: `Saved ${state.output}` })
      }
      if (!lifetime.signal.aborted) setState("content", content)
    })
  const cleanup = () =>
    run(async () => {
      const result = await props.actions.cleanupReports(props.goalID, lifetime.signal)
      if (lifetime.signal.aborted) return
      setState("confirm", false)
      await refresh()
      if (result.failed.length) throw new Error("Some reports could not be removed")
    })
  onMount(() => void run(refresh))
  onCleanup(() => lifetime.abort())
  useBindings(() => ({
    priority: 2,
    bindings: [
      {
        key: "escape",
        desc: "Back from Goal reports",
        group: "Goal",
        cmd: () => {
          if (state.confirm || state.saving || state.content) {
            setState({ confirm: false, saving: false, content: undefined })
            return
          }
          props.onClose()
        },
      },
    ],
  }))
  useKeyboard((key) => {
    if (key.ctrl || key.meta || state.pending || state.saving) return
    if (state.confirm) {
      if (key.name === "y") {
        key.preventDefault()
        void cleanup()
      }
      if (key.name === "n") {
        key.preventDefault()
        setState("confirm", false)
      }
      return
    }
    if (key.name === "up" || key.name === "down") {
      key.preventDefault()
      setState({
        selected: Math.max(0, Math.min(files().length - 1, state.selected + (key.name === "up" ? -1 : 1))),
        content: undefined,
      })
    }
    if (key.name === "return") {
      key.preventDefault()
      void read(false)
    }
    if (key.name === "r") {
      key.preventDefault()
      void run(refresh)
    }
    if (key.name === "x" && props.canCleanup) {
      key.preventDefault()
      setState("confirm", true)
    }
    if (key.name === "d" && files()[state.selected]) {
      key.preventDefault()
      setState({ saving: true, output: `${files()[state.selected]!.reportID}-${files()[state.selected]!.name}` })
    }
  })
  const offset = () => Math.max(0, state.selected - 3)
  return (
    <box height={16} width="100%" flexDirection="column" gap={1}>
      <text fg={props.theme().highlight}>
        Report files · ↑↓ select · Enter view · d save · r refresh · x delete · esc back
      </text>
      <Show when={!props.canCleanup}>
        <text fg={props.theme().muted}>Reports are protected while the goal can be resumed.</text>
      </Show>
      <Show when={!state.pending && !state.reports.length}>
        <text>No report files are available.</text>
      </Show>
      <For each={files().slice(offset(), offset() + 4)}>
        {(file, index) => (
          <text
            fg={index() + offset() === state.selected ? props.theme().highlight : props.theme().text}
          >{`${index() + offset() === state.selected ? ">" : " "} ${file.reportID} / ${file.name}`}</text>
        )}
      </For>
      <Show when={state.reports.some((report) => !report.complete)}>
        <text>Some reports have not been finalized.</text>
      </Show>
      <Show when={state.content}>
        {(content) => (
          <box flexDirection="column">
            <text>{`Preview · ${content().name}`}</text>
            <scrollbox height={5}>
              <text wrapMode="word">{content().text.slice(0, 65536)}</text>
              <Show when={content().text.length > 65536}>
                <text>Preview truncated; save the full report to read it.</text>
              </Show>
            </scrollbox>
          </box>
        )}
      </Show>
      <Show when={state.saving}>
        <text>Save to a new local file (existing files will not be overwritten):</text>
        <input
          value={state.output}
          focused={!state.pending}
          onInput={(value) => setState("output", value)}
          onSubmit={() => void read(true)}
        />
      </Show>
      <Show when={state.confirm}>
        <text fg={props.theme().error}>
          Permanently delete private reports, evidence, and scratch files? Download anything to keep first. y confirm ·
          n cancel
        </text>
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error} wrapMode="word">
          {state.error}
        </text>
      </Show>
      <Show when={state.notice}>
        <text>{state.notice}</text>
      </Show>
    </box>
  )
}
