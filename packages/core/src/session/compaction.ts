export * as SessionCompaction from "./compaction"

import { LLM, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@apexo/llm"
import { DateTime, Effect, Schema, Stream } from "effect"
import type { Config } from "../config"
import type { EventV2 } from "../event"
import type { SessionGoal } from "./goal"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { Token } from "../util/token"
import { HookObserver } from "../hook-observer"
import type { HookSnapshotLocation } from "../hook-snapshot-location"

export class Failure extends Schema.TaggedErrorClass<Failure>()("Session.CompactionFailure", {
  message: Schema.String,
}) {}

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_OUTPUT_TOKENS = 4_096
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`
const SUMMARY_UPDATE_INSTRUCTIONS = `The <prior-summary> summarizes everything that happened before the <conversation>. Construct a new summary that combines both. The <prior-summary> is discarded after this: anything you do not carry into the new summary is lost.

When combining:
- Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary> even when the <conversation> does not mention them. Drop only what is finished and no longer needed.
- The <conversation> is more recent than the <prior-summary>. Where they conflict, the conversation wins: state the corrected fact and drop the old claim.
- Add new progress, decisions, constraints, and context from the conversation.
- Move completed work from "Active" to "Completed".
- If a blocker has been resolved, update the summary to reflect that while keeping any details still needed to continue the work.
- Update "Objective" and "Next Move" to reflect the current work state.`

type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

type Settings = {
  readonly auto: boolean
  readonly buffer: number
  readonly tokens: number
}

export type MemoryBoundary = {
  readonly sessionID: SessionSchema.ID
  readonly compactionID: SessionMessage.ID
  readonly reason: "auto" | "manual"
  readonly source: { readonly messageID: SessionMessage.ID; readonly seq: number } | undefined
  readonly estimatedInputTokens: number
  readonly contextTokens: number
  readonly outputReserveTokens: number
  readonly compactThresholdTokens: number
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (
      request: LLMRequest,
      sessionID: SessionSchema.ID,
    ) => Stream.Stream<LLMEvent, LLMError | SessionGoal.Error>
  }
  readonly config: readonly Config.Entry[]
  readonly hooks?: Pick<HookSnapshotLocation.Interface, "capture">
  readonly before?: (boundary: MemoryBoundary) => Effect.Effect<void>
}

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly request: LLMRequest
}

const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serialize = (message: SessionMessage.Message) => {
  if (message.type === "user") {
    const files = message.files?.map((file) => `[Attached ${file.mime}: ${file.name ?? file.uri}]`) ?? []
    return [`[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content))}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output)}`
  return ""
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS },
  )
}

const select = (
  entries: readonly Entry[],
  tokens: number,
): { readonly head: string; readonly recent: string } | undefined => {
  const conversation = entries
    .filter((entry) => entry.message.type !== "compaction")
    .map((entry) => serialize(entry.message))
    .filter(Boolean)
  if (conversation.length === 0) return
  let total = 0
  let split = conversation.length
  for (let index = conversation.length - 1; index >= 0; index--) {
    const next = total + Token.estimate(conversation[index])
    if (next > tokens) break
    total = next
    split = index
  }
  return {
    head: conversation.slice(0, split).join("\n\n"),
    recent: conversation.slice(split).join("\n\n"),
  }
}

export const buildPrompt = (input: { readonly previousSummary?: string; readonly context: readonly string[] }) => {
  const conversation = `Here is the conversation so far:\n\n<conversation>\n${input.context.join("\n\n")}\n</conversation>`
  if (!input.previousSummary)
    return [
      conversation,
      "Create a new anchored summary from the conversation history in the <conversation> tags above so another coding agent can continue the work.",
      SUMMARY_TEMPLATE,
    ].join("\n\n")
  return [
    conversation,
    `Here is the summary of the conversation before the <conversation> above:\n\n<prior-summary>\n${input.previousSummary}\n</prior-summary>`,
    SUMMARY_UPDATE_INSTRUCTIONS,
    SUMMARY_TEMPLATE,
  ].join("\n\n")
}

export const make = (dependencies: Dependencies) => {
  const config = settings(dependencies.config)
  const compact = Effect.fn("SessionCompaction.compact")(function* (input: Input, reason: "auto" | "manual") {
    const unavailable = (message: string) =>
      reason === "manual" ? Effect.fail(new Failure({ message })) : Effect.succeed(false)
    const previousSummary = input.entries.find((entry) => entry.message.type === "compaction")?.message
    const selected = select(input.entries, reason === "manual" ? 0 : config.tokens)
    if (!selected && previousSummary?.type !== "compaction") return false
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0)
      return yield* unavailable("The model has no usable compaction context limit")
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    if (reason === "auto" && (!selected || (selected.head.length === 0 && previousSummary?.type !== "compaction")))
      return false
    const summaryPrompt = buildPrompt({
      previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
      context: [previousSummary?.type === "compaction" ? previousSummary.recent : "", selected?.head ?? ""].filter(
        Boolean,
      ),
    })
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    if (Token.estimate(summaryPrompt) > context - summaryOutput)
      return yield* unavailable("The conversation exceeds the model compaction context limit")
    const messageID = SessionMessage.ID.create()
    const source = input.entries.findLast(
      (entry) =>
        entry.message.type === "assistant" &&
        entry.message.time.completed !== undefined &&
        entry.message.finish === "stop" &&
        !entry.message.error,
    )
    const outputReserveTokens = Math.max(output, config.buffer)
    yield* dependencies.before?.({
      sessionID: input.sessionID,
      compactionID: messageID,
      reason,
      source: source ? { messageID: source.message.id, seq: source.seq } : undefined,
      estimatedInputTokens: estimate({
        system: input.request.system,
        messages: input.request.messages,
        tools: input.request.tools,
      }),
      contextTokens: context,
      outputReserveTokens,
      compactThresholdTokens: Math.max(0, context - outputReserveTokens),
    }) ?? Effect.void
    // Both observations belong to one captured registry even if a later explicit reload replaces it.
    const hooks = yield* dependencies.hooks?.capture(input.sessionID) ?? Effect.succeed(undefined)
    const observe = (event: "PreCompact" | "PostCompact") =>
      hooks
        ? HookObserver.observe({
            event,
            sessionID: input.sessionID,
            directory: hooks.location.directory,
            registry: hooks.registry,
            selection: hooks.selection,
            matcher: reason,
            payload: { source: reason },
          })
        : Effect.void
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason,
    })

    yield* observe("PreCompact")

    const chunks: string[] = []
    let failed = false
    let finished = false
    const summarized = yield* dependencies.llm
      .stream(
        LLM.request({
          model: input.model,
          http: input.request.http,
          messages: [Message.user(summaryPrompt)],
          tools: [],
          generation: { maxTokens: summaryOutput },
        }),
        input.sessionID,
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.finish(event)) finished = event.reason === "stop"
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          return Effect.void
        }),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
      )
    const summary = chunks.join("")
    if (!summarized || failed || !finished || !summary.trim())
      return yield* unavailable("The provider did not finish a usable compaction summary")
    yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason,
      text: summary,
      recent: selected?.recent ?? "",
    })
    yield* observe("PostCompact")
    return true
  })
  const compactAfterOverflow = (input: Input) =>
    compact(input, "auto").pipe(Effect.catchTag("Session.CompactionFailure", () => Effect.succeed(false)))
  const compactIfNeeded = Effect.fn("SessionCompaction.compactIfNeeded")(function* (input: Input) {
    if (!config.auto) return false
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    if (
      estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools }) <=
      context - Math.max(output, config.buffer)
    )
      return false
    return yield* compactAfterOverflow(input)
  })
  return {
    compactIfNeeded,
    compactAfterOverflow,
    manual: (input: Input) => compact(input, "manual").pipe(Effect.asVoid),
  }
}
