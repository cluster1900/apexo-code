/** @jsxImportSource @opentui/solid */
import type { ColorInput, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { McpElicitationRequest } from "@apexo/sdk/v2/client"
import {
  elicitationContent,
  elicitationConstraints,
  elicitationDefaults,
  elicitationError,
  selectedValues,
  type McpElicitationApi,
} from "@apexo/sdk/v2/mcp-elicitation"
import { useApexoModeStack, useBindings } from "../keymap"

/** The same typed dock is mounted by mini and fullscreen; its outer box stays stable. */
export function McpElicitationPrompt(props: {
  request: McpElicitationRequest
  api: McpElicitationApi
  theme: () => { text: ColorInput; muted: ColorInput; error: ColorInput; highlight: ColorInput }
  onSubmit: () => void
}) {
  const dimensions = useTerminalDimensions()
  const modes = useApexoModeStack()
  const lifetime = new AbortController()
  const [state, setState] = createStore({
    values: elicitationDefaults(props.request),
    tab: 0,
    option: 0,
    pending: false,
    error: "",
    invalid: "",
    now: Date.now(),
  })
  const field = createMemo(() => props.request.form.fields[state.tab])
  const options = createMemo(() => {
    const item = field()
    return item?.type === "select" || item?.type === "multi" ? item.options : []
  })
  let editor: TextareaRenderable | undefined
  let optionViewport: ScrollBoxRenderable | undefined
  let reviewViewport: ScrollBoxRenderable | undefined
  const save = () => {
    const item = field()
    if (item && item.type !== "boolean" && item.type !== "multi" && item.type !== "select" && editor)
      setState("values", item.name, editor.plainText)
  }
  const move = (delta: number) => {
    save()
    setState({
      tab: (state.tab + delta + props.request.form.fields.length + 1) % (props.request.form.fields.length + 1),
      option: 0,
    })
  }
  const choose = () => {
    const item = field()
    if (!item) return
    if (item.type === "boolean") {
      setState("values", item.name, state.values[item.name] !== true)
      return
    }
    const option = options()[state.option]
    if (!option) return
    if (item.type === "select") {
      setState("values", item.name, option.value)
      return
    }
    const selected = selectedValues(state.values[item.name])
    setState(
      "values",
      item.name,
      selected.includes(option.value)
        ? selected.filter((value) => value !== option.value)
        : [...selected, option.value],
    )
  }
  const submit = async (action: "accept" | "decline" | "cancel") => {
    if (state.pending) return
    save()
    const parsed = action === "accept" ? elicitationContent(props.request, state.values) : undefined
    if (parsed?.invalid !== undefined) {
      setState({
        invalid: parsed.invalid,
        error: "Enter a finite number.",
        tab: props.request.form.fields.findIndex((item) => item.name === parsed.invalid),
      })
      return
    }
    setState({ pending: true, error: "", invalid: "" })
    await props.api
      .reply(
        {
          sessionID: props.request.sessionID,
          requestID: props.request.id,
          action,
          ...(parsed?.content ? { content: parsed.content } : {}),
        },
        { signal: lifetime.signal, throwOnError: false },
      )
      .then((result) => {
        if (lifetime.signal.aborted) return
        if (result.response.ok || result.response.status === 404) {
          props.onSubmit()
          return
        }
        const invalid = elicitationError(result.error).field
        setState({ error: "Check the requested field constraints and try again.", invalid: invalid ?? "" })
        if (invalid)
          setState(
            "tab",
            Math.max(
              0,
              props.request.form.fields.findIndex((item) => item.name === invalid),
            ),
          )
      })
      .catch(() => {
        if (!lifetime.signal.aborted) setState("error", "Could not send the response. Try again.")
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setState("pending", false)
      })
  }
  onMount(() => {
    const pop = modes.push("mcp-form")
    onCleanup(pop)
  })
  const timer = setInterval(() => setState("now", Date.now()), 1000)
  onCleanup(() => {
    clearInterval(timer)
    lifetime.abort()
  })
  useBindings(() => ({
    mode: "mcp-form",
    priority: 3,
    bindings: [
      { key: "escape", desc: "Cancel form", group: "MCP form", cmd: () => void submit("cancel") },
      { key: "ctrl+d", desc: "Decline form", group: "MCP form", cmd: () => void submit("decline") },
      {
        key: "ctrl+s",
        desc: "Submit form",
        group: "MCP form",
        cmd: () => {
          if (!field()) void submit("accept")
        },
      },
      {
        key: "tab",
        desc: "Next field",
        group: "MCP form",
        cmd: () => {
          if (!state.pending) move(1)
        },
      },
      {
        key: "shift+tab",
        desc: "Previous field",
        group: "MCP form",
        cmd: () => {
          if (!state.pending) move(-1)
        },
      },
      {
        key: "return",
        desc: "Edit selection or review",
        group: "MCP form",
        cmd: () => {
          if (state.pending) return
          const item = field()
          if (!item) {
            void submit("accept")
            return
          }
          if (item.type === "string" || item.type === "number" || item.type === "integer") {
            move(1)
            return
          }
          choose()
        },
      },
      ...["pageup", "pagedown"].map((key) => ({
        key,
        desc: "Scroll form",
        group: "MCP form",
        cmd: () => {
          const viewport = field() ? optionViewport : reviewViewport
          viewport?.scrollBy((key === "pageup" ? -1 : 1) * viewport.height)
        },
      })),
      ...(!field() || field()?.type === "boolean" || options().length
        ? [
            {
              key: "space",
              desc: "Toggle selection",
              group: "MCP form",
              cmd: () => {
                if (!state.pending) choose()
              },
            },
            ...["up", "down"].map((key) => ({
              key,
              desc: "Choose option",
              group: "MCP form",
              cmd: () => {
                if (state.pending || !options().length) return
                setState("option", (state.option + (key === "up" ? -1 : 1) + options().length) % options().length)
                optionViewport?.scrollTo(Math.max(0, state.option - 3))
              },
            })),
          ]
        : []),
    ],
  }))
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} flexShrink={0}>
      <text fg={props.theme().highlight}>
        Input requested by {props.request.server} ·{" "}
        {Math.max(0, Math.ceil((Number(props.request.deadlineAt) - state.now) / 1000))}s remaining
      </text>
      <text fg={props.theme().text}>{props.request.message}</text>
      <text fg={props.theme().muted}>Do not enter passwords, tokens, or other secrets.</text>
      <text fg={props.theme().muted}>
        Field {Math.min(state.tab + 1, props.request.form.fields.length)} / {props.request.form.fields.length} · Tab
        next · Shift+Tab back
      </text>
      <Show
        when={field()}
        keyed
        fallback={
          <box flexDirection="column">
            <scrollbox
              ref={(value: ScrollBoxRenderable) => {
                reviewViewport = value
              }}
              height={Math.max(3, Math.min(10, dimensions().height - 12))}
            >
              <For each={props.request.form.fields}>
                {(item) => (
                  <text fg={props.theme().text}>
                    {item.title}: {JSON.stringify(state.values[item.name] ?? "(not set)")}
                  </text>
                )}
              </For>
            </scrollbox>
            <text fg={props.theme().highlight}>Review answers · Enter or Ctrl+S submit</text>
          </box>
        }
      >
        {(item) => (
          <box flexDirection="column">
            <text fg={state.invalid === item.name ? props.theme().error : props.theme().text}>
              {item.title}
              {item.required ? " *" : ""}
            </text>
            <For each={elicitationConstraints(item)}>
              {(hint) => (
                <text fg={props.theme().muted}>
                  {
                    {
                      minLength: "Minimum text length",
                      maxLength: "Maximum text length",
                      format: "Format",
                      integer: "Whole number",
                      minimum: "Minimum value",
                      maximum: "Maximum value",
                      minItems: "Minimum selections",
                      maxItems: "Maximum selections",
                    }[hint.kind]
                  }
                  {hint.value === "" ? "" : `: ${hint.value}`}
                </text>
              )}
            </For>
            <Show when={item.description}>
              <text fg={props.theme().muted}>{item.description}</text>
            </Show>
            <Show
              when={item.type === "string" || item.type === "number" || item.type === "integer"}
              fallback={
                <Show
                  when={item.type === "boolean"}
                  fallback={
                    <scrollbox
                      ref={(value: ScrollBoxRenderable) => {
                        optionViewport = value
                      }}
                      height={Math.max(2, Math.min(options().length, 7))}
                    >
                      <For each={options()}>
                        {(option, index) => (
                          <text fg={index() === state.option ? props.theme().highlight : props.theme().text}>
                            {index() === state.option ? "> " : "  "}[
                            {state.values[item.name] === option.value ||
                            selectedValues(state.values[item.name]).includes(option.value)
                              ? "x"
                              : " "}
                            ] {option.title}
                          </text>
                        )}
                      </For>
                    </scrollbox>
                  }
                >
                  <text fg={props.theme().highlight}>
                    [{state.values[item.name] === true ? "x" : " "}] {String(state.values[item.name] === true)} · Space
                    toggle
                  </text>
                </Show>
              }
            >
              <textarea
                ref={(value: TextareaRenderable) => {
                  editor = value
                  queueMicrotask(() => {
                    if (!value.isDestroyed) {
                      value.focus()
                      value.gotoLineEnd()
                    }
                  })
                }}
                initialValue={String(state.values[item.name] ?? "")}
                minHeight={1}
                maxHeight={3}
                textColor={props.theme().text}
                focusedTextColor={props.theme().text}
              />
              <text fg={props.theme().muted}>Enter next · {item.type}</text>
            </Show>
          </box>
        )}
      </Show>
      <Show when={state.error}>
        <text fg={props.theme().error}>{state.error}</text>
      </Show>
      <text fg={props.theme().muted}>
        {state.pending ? "Sending response…" : "Tab review/edit · Ctrl+D Decline · Esc Cancel"}
      </text>
    </box>
  )
}
