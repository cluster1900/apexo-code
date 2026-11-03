import type { ApexoClient } from "@apexo/sdk/v2/client"
import { Schema } from "effect"
import { SessionMessage } from "@apexo/schema/session-message"
import { SessionInput } from "@apexo/schema/session-input"
import { nativeSessionTransport } from "@apexo/tui/transport/native-session"
import { nativeHeadlessOutput } from "./native-headless-output"
import {
  appendOutputSchemaPrompt,
  parseStructuredText,
  validateRunOutputOptions,
  writeLastMessage,
  type LoadedOutputSchema,
  type ParsedRunGuardrails,
} from "./run-output-options"
import type { RunInput } from "./cmd/run/types"

export function validateNativeInputID(input: {
  inputID?: string
  session?: string
  continue?: boolean
  fork?: boolean
  mini?: boolean
}) {
  if (input.inputID === undefined) return
  if (!input.session || input.continue || input.fork || input.mini)
    throw new Error("--input-id requires native headless execution with an explicit --session")
  Schema.decodeUnknownSync(SessionMessage.ID)(input.inputID)
}

export async function runNativeHeadless(input: {
  sdk: ApexoClient
  directory?: string
  session?: string
  continue?: boolean
  fork?: boolean
  inputID?: string
  sandbox?: string
  agent?: string
  model?: RunInput["model"]
  variant?: string
  files: RunInput["files"]
  text: string
  auto?: boolean
  thinking?: boolean
  format: "default" | "json" | "streaming-json"
  outputSchema?: LoadedOutputSchema
  outputLastMessage?: string
  ephemeral?: boolean
  guardrails?: ParsedRunGuardrails
  dispose?: () => Promise<void>
}) {
  validateNativeInputID(input)
  validateRunOutputOptions({
    ephemeral: input.ephemeral,
    session: input.session,
    continue: input.continue,
    fork: input.fork,
    inputID: input.inputID,
  })
  if (input.fork && !input.session && !input.continue)
    throw new Error("--fork requires --continue or --session")
  if (!input.text.trim() && !input.files.length)
    throw new Error("A new prompt or file is required for native headless execution")
  const requests = new AbortController()
  const state = {
    signal: undefined as "SIGINT" | "SIGTERM" | undefined,
    admissionAttempted: false,
    cleanupAttempted: false,
    cleanupConfirmed: false,
    cleanupFailed: false,
    identity: undefined as { sessionID: string; inputID: string } | undefined,
    ephemeralSessionID: undefined as string | undefined,
  }
  let cancel: (() => Promise<void>) | undefined
  const interrupt = () => {
    state.signal ??= "SIGINT"
    requests.abort()
  }
  const terminate = () => {
    state.signal ??= "SIGTERM"
    requests.abort()
  }
  process.on("SIGINT", interrupt)
  process.on("SIGTERM", terminate)
  const streamOwner = new AbortController()
  const live: unknown[] = []
  let stream: Promise<void> | undefined
  try {
    const transport = nativeSessionTransport(input.sdk, input.directory, requests.signal)
    const existing = input.session
      ? await transport.get(input.session, AbortSignal.timeout(10000))
      : input.continue
        ? (await transport.list(undefined, AbortSignal.timeout(10000))).data.find((item) => !item.parentID)
        : undefined
    if ((input.continue || input.fork) && !existing) throw new Error("No native Session is available to continue")
    const catalog = await transport.catalog(AbortSignal.timeout(10000))
    const agent =
      input.agent ?? existing?.agent ?? catalog.agents.find((item) => item.mode !== "subagent" && !item.hidden)?.id
    const configured = catalog.agents.find((item) => item.id === agent)?.model
    const fallback = catalog.models.find(
      (item) =>
        item.enabled && catalog.providers.some((provider) => provider.id === item.providerID && !provider.disabled),
    )
    const stored = existing?.model ?? configured ?? fallback
    const selected = input.model
      ? { providerID: input.model.providerID, id: input.model.modelID, variant: input.variant }
      : stored
        ? {
            providerID: stored.providerID,
            id: stored.id,
            variant: input.variant ?? ("variant" in stored ? stored.variant : undefined),
          }
        : undefined
    if (state.signal) {
      state.cleanupConfirmed = true
      process.exitCode = state.signal === "SIGINT" ? 130 : 143
      return
    }
    const session = existing
      ? input.fork
        ? await transport.fork({ sessionID: existing.id }, AbortSignal.timeout(10000))
        : existing
      : await transport.create(
          {
            agent,
            model: selected,
            ...(input.sandbox && input.sandbox !== "off" ? { commandSandbox: input.sandbox } : {}),
          },
          AbortSignal.timeout(10000),
        )
    if (!existing && input.ephemeral) state.ephemeralSessionID = session.id
    if (existing && input.agent && input.agent !== session.agent)
      await transport.switchAgent({ sessionID: session.id, agent: input.agent }, AbortSignal.timeout(10000))
    if (existing && (input.model || input.variant) && selected)
      await transport.switchModel({ sessionID: session.id, model: selected }, AbortSignal.timeout(10000))
    const inputID = input.inputID ?? SessionMessage.ID.create()
    const target = { sessionID: session.id, inputID }
    state.identity = target
    const output = nativeHeadlessOutput({
      ...target,
      directory: session.location.directory,
      format: input.format,
      thinking: input.thinking ?? false,
      write: (text) => {
        process.stdout.write(text)
      },
      error: (text) => {
        process.stderr.write(text)
      },
    })
    if (existing && input.sandbox?.trim()) {
      const requestedProfile = input.sandbox.trim() === "none" ? "off" : input.sandbox.trim()
      const currentSandbox = await transport.sandbox(session.id, AbortSignal.timeout(10000)).catch(() => undefined)
      const actualProfile = currentSandbox?.profile ?? "off"
      if (requestedProfile !== actualProfile) {
        process.stderr.write(
          `Warning: --sandbox ${input.sandbox.trim()} did not take effect because existing Session ${session.id} uses immutable sandbox profile "${actualProfile}". Start a new Session without --session/--continue to use "${input.sandbox.trim()}".\n`,
        )
      }
    }
    // Live fragments are advisory. Durable history is replayed in sequence before fragments,
    // so a reconnect never skips a terminal full-value event or consumes another input's output.
    // The SSE generator opens its HTTP request lazily; durable receipt/history reads
    // remain authoritative if the advisory connection never produces its first event.
    const handshake = setTimeout(() => streamOwner.abort(), 10000)
    handshake.unref()
    const subscription = await transport.subscribe(streamOwner.signal)
    stream = (async () => {
      try {
        for await (const event of subscription.stream) {
          clearTimeout(handshake)
          if (live.length < 4096) live.push(event)
        }
      } finally {
        clearTimeout(handshake)
      }
    })().catch(() => {})
    const playback = { sequence: 0, prompted: false, closed: false }
    const replay = async (
      boundary?: number,
      signal = AbortSignal.any([requests.signal, AbortSignal.timeout(10000)]),
    ) => {
      while (!playback.closed) {
        const before = playback.sequence
        const page = (
          await input.sdk.v2.session.history(
            { sessionID: session.id, after: before, limit: 100 },
            { throwOnError: true, signal },
          )
        ).data
        for (const event of page.data) {
          const durable = event.durable
          if (!durable) throw new Error("Native history contains an event without a durable sequence")
          if (boundary !== undefined && durable.seq > boundary) {
            playback.closed = true
            break
          }
          if (event.type === "session.next.prompted") {
            if (event.data.messageID === inputID) playback.prompted = true
            else if (playback.prompted) {
              playback.closed = true
              break
            }
          }
          output.apply(event)
          playback.sequence = durable.seq
          if (boundary !== undefined && durable.seq >= boundary) {
            playback.closed = true
            break
          }
        }
        if (!page.hasMore || playback.closed) break
        if (playback.sequence <= before) throw new Error("Native history did not advance")
      }
      for (const value of live.splice(0)) {
        if (!playback.closed && typeof value === "object" && value !== null && !("durable" in value))
          output.apply(value)
      }
    }
    const promptText = input.outputSchema
      ? appendOutputSchemaPrompt(input.text, input.outputSchema.rawText)
      : input.text
    const request = {
      sessionID: session.id,
      id: inputID,
      prompt: {
        text: promptText,
        ...(input.files.length
          ? { files: input.files.map((file) => ({ uri: file.url, mime: file.mime, name: file.filename })) }
          : {}),
      },
      executionPolicy: {
        mode: "headless" as const,
        permissions: input.auto ? ("approve_once" as const) : ("reject" as const),
        ...(input.guardrails?.maxTurns === undefined ? {} : { maxTurns: input.guardrails.maxTurns }),
        ...(input.guardrails?.maxTokens === undefined ? {} : { maxTokens: input.guardrails.maxTokens }),
        ...(input.guardrails?.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: input.guardrails.maxBudgetUsd }),
        ...(input.guardrails?.fallbackModel === undefined
          ? {}
          : {
              fallbackModel: {
                providerID: input.guardrails.fallbackModel.providerID,
                id: input.guardrails.fallbackModel.id,
              },
            }),
        ...(input.outputSchema === undefined
          ? {}
          : { outputSchema: input.outputSchema.schema as Record<string, never> }),
      },
    }
    const decode = Schema.decodeUnknownSync(SessionInput.Execution)
    cancel = async () => {
      state.cleanupAttempted = true
      const deadline = Date.now() + 10000
      while (true) {
        // Cleanup must not inherit the aborted foreground request signal.
        const result = await input.sdk.v2.session.input.interrupt(target, {
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        })
        if (result.data) {
          const execution = decode(result.data.data)
          state.cleanupConfirmed = true
          playback.sequence = Math.max(playback.sequence, execution.admittedSeq - 1)
          await replay(execution.endedSeq, AbortSignal.timeout(Math.max(1, deadline - Date.now())))
          output.finish(execution)
          return
        }
        if (result.response.status !== 409 || Date.now() >= deadline)
          throw new Error("Native input cleanup is unconfirmed; inspect its input receipt before retrying")
        await Bun.sleep(20)
      }
    }
    if (state.signal) {
      state.cleanupConfirmed = true
      process.exitCode = state.signal === "SIGINT" ? 130 : 143
      return
    }
    // An aborted response does not prove that this request failed to commit.
    state.admissionAttempted = true
    const admitted = await transport.admit({ ...request, resume: false }, AbortSignal.timeout(10000))
    playback.sequence = admitted.admittedSeq - 1
    if (!state.signal) await transport.admit(request, AbortSignal.timeout(10000))
    while (true) {
      if (state.signal) {
        await cancel()
        process.exitCode = state.signal === "SIGINT" ? 130 : 143
        return
      }
      const waited = (
        await input.sdk.v2.session.input.wait(
          { ...target, timeoutMs: 100 },
          { throwOnError: true, signal: AbortSignal.any([requests.signal, AbortSignal.timeout(10000)]) },
        )
      ).data.data
      const execution = decode(waited.execution)
      await replay(execution.endedSeq)
      if (waited.timedOut) continue
      output.finish(execution)
      if (execution.status !== "completed") {
        process.exitCode = 1
        return
      }
      const lastText = output.lastMessage() ?? ""
      if (input.outputSchema) {
        const checked = parseStructuredText(lastText, input.outputSchema)
        if (!checked.ok) {
          if (input.format === "default") process.stderr.write(`${checked.message}\n`)
          if (input.format !== "default")
            process.stdout.write(
              JSON.stringify(
                input.format === "json"
                  ? { type: "error", timestamp: Date.now(), sessionID: session.id, message: checked.message }
                  : { type: "error", message: checked.message },
              ) + "\n",
            )
          process.exitCode = 1
          return
        }
        if (input.outputLastMessage)
          await writeLastMessage(input.outputLastMessage, JSON.stringify(checked.value, null, 2) + "\n")
        process.exitCode = 0
        return
      }
      if (input.outputLastMessage) await writeLastMessage(input.outputLastMessage, lastText)
      process.exitCode = 0
      return
    }
  } catch (error) {
    if (state.signal) {
      if (!state.admissionAttempted) state.cleanupConfirmed = true
      else if (!state.cleanupAttempted && cancel) {
        await cancel().catch(() => {
          state.cleanupFailed = true
        })
      } else state.cleanupFailed = true
      if (!state.cleanupConfirmed || state.cleanupFailed)
        process.stderr.write(
          state.cleanupConfirmed
            ? "Native input cleanup settled, but final output could not be read.\n"
            : `Native input cleanup is unconfirmed; inspect the durable input before retrying. ${state.identity ? `Session ${state.identity.sessionID}, input ${state.identity.inputID}.` : ""}\n`,
        )
      process.exitCode = state.cleanupConfirmed ? (state.signal === "SIGINT" ? 130 : 143) : 1
      return
    }
    if (state.admissionAttempted && state.identity)
      process.stderr.write(
        `Native input identity: Session ${state.identity.sessionID}, input ${state.identity.inputID}. Inspect its receipt before retrying.\n`,
      )
    throw error
  } finally {
    streamOwner.abort()
    try {
      await stream
      if (state.ephemeralSessionID) {
        await input.sdk.v2.session
          .remove({ sessionID: state.ephemeralSessionID }, { signal: AbortSignal.timeout(10000) })
          .catch(() => {})
      }
      await input.dispose?.()
      if (state.signal && state.cleanupConfirmed) process.exitCode = state.signal === "SIGINT" ? 130 : 143
    } finally {
      process.off("SIGINT", interrupt)
      process.off("SIGTERM", terminate)
    }
  }
}
