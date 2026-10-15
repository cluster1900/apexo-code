import { SessionEvent } from "@apexo/core/session/event"
import type { NativeSessionTransport } from "@apexo/tui/transport/native-session"
import { terminalPermission, terminalQuestion, terminalRequestEvent } from "@apexo/tui/transport/native-session-events"
import type { Event } from "@apexo/sdk/v2"
import { Option, Schema } from "effect"
import { createSessionData, pickBlockerView, reduceSessionData } from "./session-data"
import { replayLocalRows, replaySession } from "./session-replay"
import { writeSessionOutput } from "./stream"
import type { SessionTransport, StreamInput } from "./stream.transport"

const decode = Schema.decodeUnknownOption(SessionEvent.All)

export async function createNativeSessionTransport(
  input: StreamInput,
  native: NativeSessionTransport,
): Promise<SessionTransport> {
  const abort = new AbortController()
  const stop = () => abort.abort()
  input.signal?.addEventListener("abort", stop, { once: true })
  const state = {
    view: await native.history(input.sessionID, abort.signal),
    data: createSessionData(),
    sent: new Map<string, string>(),
    fault: undefined as unknown,
    running: false,
    activityRevision: 0,
  }
  const emit = (event: Event) =>
    writeSessionOutput(
      input,
      reduceSessionData({
        data: state.data,
        event,
        sessionID: input.sessionID,
        thinking: input.thinking,
        limits: input.limits(),
      }),
    )
  const render = () => {
    for (const message of state.view.snapshot()) {
      const encoded = JSON.stringify(message.info)
      if (state.sent.get(message.info.id) !== encoded) {
        state.sent.set(message.info.id, encoded)
        emit({
          id: message.info.id,
          type: "message.updated",
          properties: { sessionID: input.sessionID, info: message.info },
        })
      }
      for (const part of message.parts) {
        const encoded = JSON.stringify(part)
        if (state.sent.get(part.id) === encoded) continue
        state.sent.set(part.id, encoded)
        emit({
          id: part.id,
          type: "message.part.updated",
          properties: { sessionID: input.sessionID, part, time: Date.now() },
        })
      }
    }
  }
  const blockers = async () => {
    const [permissions, questions] = await Promise.all([
      native.permissions(input.sessionID, abort.signal),
      native.questions(input.sessionID, abort.signal),
    ])
    state.data.permissions = permissions.map(terminalPermission)
    state.data.questions = questions.map(terminalQuestion)
    input.footer.event({
      type: "stream.view",
      view: pickBlockerView({ permission: state.data.permissions[0], question: state.data.questions[0] }),
    })
  }
  const replay = async () => {
    await blockers()
    const replayed = replaySession({
      messages: state.view.snapshot(),
      permissions: state.data.permissions,
      questions: state.data.questions,
      thinking: input.thinking,
      limits: input.limits(),
      providers: input.providers?.(),
    })
    state.data = replayed.data
    state.sent.clear()
    for (const message of state.view.snapshot()) {
      state.sent.set(message.info.id, JSON.stringify(message.info))
      for (const part of message.parts) state.sent.set(part.id, JSON.stringify(part))
    }
    return replayed
  }
  const connected = await native.subscribe(abort.signal)
  // Subscribe before the authoritative replay, so events committed during hydration
  // remain buffered by the stream and are deduplicated by their durable sequence.
  state.view = await native.history(input.sessionID, abort.signal)
  const initial = await replay()
  if (input.replay !== false) writeSessionOutput(input, { commits: initial.commits, footer: { patch: initial.patch } })
  const listening = (async () => {
    let connection = connected
    while (!abort.signal.aborted) {
      for await (const event of connection.stream) {
        if (abort.signal.aborted) break
        if (event.type === "server.connected") {
          state.view = await native.history(input.sessionID, abort.signal)
          render()
          await blockers()
          continue
        }
        const session = decode(event)
        if (Option.isSome(session) && session.value.data.sessionID === input.sessionID) {
          if (session.value.durable && session.value.durable.seq > state.view.sequence + 1) {
            state.view = await native.history(input.sessionID, abort.signal)
            render()
          }
          if (session.value.type === "session.next.step.started") state.activityRevision++
          if (state.view.apply(event)) render()
          if (
            session.value.type === "session.next.agent.switched" ||
            session.value.type === "session.next.model.switched"
          )
            input.onSelection?.(await native.get(input.sessionID, abort.signal))
          continue
        }
        const request = terminalRequestEvent(event)
        if (request && "sessionID" in request.properties && request.properties.sessionID === input.sessionID)
          emit(request)
      }
      if (abort.signal.aborted) break
      // A reconnect never resubmits a prompt. Recover only durable history and
      // pending interaction state before consuming the next subscription.
      await Bun.sleep(250)
      abort.signal.throwIfAborted()
      connection = await native.subscribe(abort.signal)
      state.view = await native.history(input.sessionID, abort.signal)
      render()
      await blockers()
    }
  })()
  const activity = (async () => {
    while (!abort.signal.aborted) {
      const revision = state.activityRevision
      const active = await native.active(abort.signal)
      if (revision === state.activityRevision && (!state.running || active[input.sessionID])) {
        input.footer.event({
          type: "stream.patch",
          patch: { phase: active[input.sessionID] ? "running" : "idle", status: "" },
        })
      }
      await Bun.sleep(250)
    }
  })()
  activity.catch((error) => {
    if (abort.signal.aborted) return
    state.fault = error
    input.footer.event({ type: "stream.patch", patch: { status: "Could not read native Session activity" } })
  })
  listening.catch((error) => {
    if (abort.signal.aborted) return
    state.fault = error
    input.footer.event({ type: "stream.patch", patch: { status: "Native event stream disconnected" } })
  })
  return {
    async runPromptTurn(next) {
      if (state.fault) throw state.fault
      if (state.running) throw new Error("A native terminal prompt is already being admitted")
      if (next.prompt.mode === "shell" || (next.prompt.command && next.prompt.command.name !== "loop"))
        throw new Error("Native terminal user-shell and slash-command execution are not available")
      if (next.prompt.parts.some((part) => part.type !== "file" && part.type !== "agent"))
        throw new Error("Native terminal prompt parts must be files or agent mentions")
      state.running = true
      state.activityRevision++
      const signal = next.signal ? AbortSignal.any([abort.signal, next.signal]) : abort.signal
      try {
        const current = await native.get(input.sessionID, signal)
        if (next.agent && next.agent !== current.agent)
          await native.switchAgent({ sessionID: input.sessionID, agent: next.agent }, signal)
        if (
          next.model &&
          (next.model.modelID !== current.model?.id ||
            next.model.providerID !== current.model.providerID ||
            next.variant !== (current.model.variant ?? undefined))
        ) {
          await native.switchModel(
            {
              sessionID: input.sessionID,
              model: { id: next.model.modelID, providerID: next.model.providerID, variant: next.variant },
            },
            signal,
          )
        }
        const files = [
          ...(next.includeFiles ? next.files : []),
          ...next.prompt.parts.filter((part) => part.type === "file"),
        ]
        const agents = next.prompt.parts.filter((part) => part.type === "agent")
        const admitted = await native.admit(
          {
            sessionID: input.sessionID,
            id: next.prompt.messageID,
            prompt: {
              text: next.prompt.text,
              files: files.map((file) => ({ uri: file.url, mime: file.mime, name: file.filename })),
              agents: agents.map((agent) => ({
                name: agent.name,
                source: agent.source
                  ? { text: agent.source.value, start: agent.source.start, end: agent.source.end }
                  : undefined,
              })),
            },
          },
          signal,
        )
        input.footer.event({ type: "stream.patch", patch: { phase: "running", status: "" } })
        while (!signal.aborted) {
          if (state.fault) throw state.fault
          // Admission is durable before its advisory wake. Do not interpret an
          // initially idle coordinator as completion until the input is projected.
          const active = await native.active(signal)
          if (!active[input.sessionID]) {
            // The subscription owns projection publication. This independent
            // admission check must not replace a newer live event projection.
            const history = await native.history(input.sessionID, signal)
            if (history.snapshot().some((row) => row.info.id === admitted.id)) {
              input.footer.event({ type: "stream.patch", patch: { phase: "idle", status: "" } })
              break
            }
          }
          await Bun.sleep(100)
        }
        signal.throwIfAborted()
      } finally {
        state.running = false
      }
    },
    // Native Task output is available through the Tasks manager and direct
    // child attachment; compatibility stream-derived subagent tabs are absent.
    selectSubagent() {},
    async replayOnResize(next) {
      const replayed = await replay()
      await next.reset()
      writeSessionOutput(input, {
        commits: replayLocalRows(state.view.snapshot(), replayed.commits, next.localRows()),
        footer: { patch: replayed.patch },
      })
      return true
    },
    async close() {
      abort.abort()
      input.signal?.removeEventListener("abort", stop)
      await Promise.all([listening.catch(() => {}), activity.catch(() => {})])
    },
  }
}
