import path from "node:path"
import { DateTime, Schema } from "effect"
import { SessionID } from "@apexo/schema/session-id"
import { SessionEvent } from "@apexo/schema/session-event"
import type { SessionV1 } from "@apexo/core/v1/session"
import type { ApexoClient } from "@apexo/sdk/v2/client"
import { ServerAuth } from "@/server/auth"
import { CliError } from "../effect-cmd"
import { cmd } from "./cmd"

export interface ModelUsageRow {
  inputTokens: number
  outputTokens: number
  cachedReadTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  totalTokens: number
  modelCalls: number
  costUsd: number | null
  costIsPartial: boolean
  usageIsIncomplete: boolean
  turnCount: number
}

export interface UsageSummary extends ModelUsageRow {
  primaryModelId?: string
  modelUsage: Record<string, ModelUsageRow>
}

export interface StepUsage {
  assistantMessageId: string
  userMessageId: string
  agent: string
  providerId: string
  modelId: string
  variant?: string
  startedAt: string
  endedAt?: string
  finishReason?: string
  inputTokens: number
  outputTokens: number
  cachedReadTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  totalTokens: number
  modelCalls: number
  costUsd: number | null
  usageIsIncomplete: boolean
  error?: string
}

export interface TurnUsage extends UsageSummary {
  turnNumber: number
  userMessageId: string
  startedAt: string
  endedAt: string
  steps: StepUsage[]
}

export interface SessionUsageReport {
  sessionId: string
  updatedAt: string
  backend: "native" | "compatibility"
  accountingScope: "durable-event-ledger" | "projected-message-history"
  costStatus: "unavailable" | "recorded"
  observedSeq?: number
  importedContextSteps?: number
  compactionCount?: number
  session: UsageSummary
  turns: TurnUsage[]
}

const isSessionID = Schema.is(SessionID)
const isDecodedDurableEvent = Schema.is(Schema.toType(SessionEvent.Durable))
const decodeDurableEvent = Schema.decodeUnknownSync(SessionEvent.Durable)

function asDurableEvent(raw: unknown): SessionEvent.DurableEvent {
  return isDecodedDurableEvent(raw) ? raw : decodeDurableEvent(raw)
}

export const UsageCommand = cmd({
  command: "usage <sessionID> [turn]",
  describe: "show persisted token and cost usage for a session or turn as JSON",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session ID to inspect",
        type: "string",
        demandOption: true,
      })
      .positional("turn", {
        describe: "1-based turn number; omit for session totals and every recorded turn",
        type: "string",
      })
      .option("attach", {
        describe: "URL of the running apexo server",
        type: "string",
      })
      .option("session-protocol", {
        choices: ["auto", "native", "compatibility"] as const,
        default: "auto" as const,
        describe: "Session API transport",
      })
      .option("dir", {
        describe: "project directory",
        type: "string",
      })
      .option("password", {
        describe: "server password (defaults to APEXO_SERVER_PASSWORD)",
        type: "string",
      })
      .option("username", {
        describe: "server username (defaults to APEXO_SERVER_USERNAME)",
        type: "string",
      }),
  async handler(args) {
    const turnNumber = parseTurnSelector(args.turn)
    const report = await loadSessionUsage({
      sessionID: args.sessionID,
      turn: turnNumber,
      attach: args.attach,
      sessionProtocol: args["session-protocol"] ?? "auto",
      directory: args.dir,
      password: args.password,
      username: args.username,
    })
    process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  },
})

export function parseTurnSelector(raw: string | number | undefined): number | undefined {
  if (raw === undefined) return undefined
  const text = String(raw).trim()
  if (!/^[1-9]\d*$/.test(text)) {
    throw new CliError({ message: `Turn must be a positive integer, got '${raw}'.`, exitCode: 1 })
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CliError({ message: `Turn must be a positive integer, got '${raw}'.`, exitCode: 1 })
  }
  return value
}

export async function loadSessionUsage(input: {
  sessionID: string
  turn?: number
  attach?: string
  sessionProtocol?: "auto" | "native" | "compatibility"
  directory?: string
  password?: string
  username?: string
}): Promise<SessionUsageReport> {
  const protocol = input.sessionProtocol ?? "auto"
  const directory = input.directory ? path.resolve(process.cwd(), input.directory) : undefined
  if (input.attach) {
    const { createApexoClient } = await import("@apexo/sdk/v2/client")
    const { sessionTransport } = await import("@apexo/tui/transport/session")
    const client = createApexoClient({
      baseUrl: input.attach,
      directory,
      headers: ServerAuth.headers({ password: input.password, username: input.username }),
    })
    const selected = await sessionTransport(client, directory, protocol)(AbortSignal.timeout(10_000))
    if (selected.kind === "native") {
      return readNativeUsageFromClient(client, input.sessionID, input.turn)
    }
    return readCompatibilityUsageFromClient(client, input.sessionID, input.turn, directory)
  }

  if (protocol === "compatibility") {
    return readCompatibilityUsageLocal(input.sessionID, input.turn, directory ?? process.cwd())
  }

  const { createApexoClient } = await import("@apexo/sdk/v2/client")
  const { createNativeLocalHost } = await import("../native-local-host")
  const host = createNativeLocalHost(undefined, true)
  try {
    const client = createApexoClient({
      baseUrl: "http://apexo.local",
      fetch: host.fetch,
      directory,
    })
    return await readNativeUsageFromClient(client, input.sessionID, input.turn)
  } finally {
    await host.close()
  }
}

export async function readNativeUsageFromClient(
  client: ApexoClient,
  sessionID: string,
  turn?: number,
): Promise<SessionUsageReport> {
  if (!isSessionID(sessionID)) {
    throw sessionNotFound(sessionID)
  }
  const signal = AbortSignal.timeout(10_000)
  const sessionRes = await client.v2.session.get({ sessionID }, { throwOnError: false, signal })
  if (!sessionRes.data?.data) {
    if (sessionRes.response.status === 404 || sessionRes.response.status === 400) {
      throw sessionNotFound(sessionID)
    }
    throw new CliError({
      message: `Failed to read session '${sessionID}' (HTTP ${sessionRes.response.status}).`,
      exitCode: 1,
    })
  }
  const events = await fetchNativeHistoryPages(
    (after) =>
      client.v2.session
        .history({ sessionID, after, limit: 100 }, { throwOnError: true, signal: AbortSignal.timeout(10_000) })
        .then((res) => res.data),
    sessionID,
  )
  return buildNativeSessionUsageReport({
    session: sessionRes.data.data,
    events,
    turn,
  })
}

export async function fetchNativeHistoryPages(
  fetchPage: (after: number) => Promise<{ data: readonly unknown[]; hasMore: boolean }>,
  sessionID: string,
): Promise<SessionEvent.DurableEvent[]> {
  const events: SessionEvent.DurableEvent[] = []
  let after = 0
  while (true) {
    const page = await fetchPage(after)
    let pageMaxSeq = after
    for (const raw of page.data) {
      const decoded = asDurableEvent(raw)
      if (!decoded.durable) {
        throw new CliError({
          message: `Native session '${sessionID}' history contains an event without a durable sequence.`,
          exitCode: 1,
        })
      }
      if (decoded.durable.seq > pageMaxSeq) {
        pageMaxSeq = decoded.durable.seq
      }
      events.push(decoded)
    }
    if (!page.hasMore) return events
    if (page.data.length === 0 || pageMaxSeq <= after) {
      throw new CliError({
        message: `Native session '${sessionID}' history pagination cursor did not advance past seq ${after}.`,
        exitCode: 1,
      })
    }
    after = pageMaxSeq
  }
}

export function buildNativeSessionUsageReport(input: {
  session: { id: string; time: { created: number | DateTime.Utc; updated: number | DateTime.Utc } }
  events: readonly unknown[]
  turn?: number
}): SessionUsageReport {
  const seenEventIds = new Set<string>()
  const seenSeqs = new Set<number>()
  const settledAssistants = new Set<string>()
  const importedAssistants = new Set<string>()

  interface MutableTurn {
    userMessageId: string
    startedAt: string
    endedAt: string
    incompleteFromSettlement: boolean
    steps: StepUsage[]
  }

  const turnsByUserId = new Map<string, MutableTurn>()
  const turnOrder: MutableTurn[] = []
  const stepByAssistantId = new Map<string, { turn: MutableTurn; step: StepUsage }>()

  let currentTurn: MutableTurn | undefined
  let observedSeq = 0
  let latestTimestamp = toEpochMillis(input.session.time.updated)
  let importedContextSteps = 0
  let compactionCount = 0

  const ensureTurn = (userMessageId: string, timestamp: number): MutableTurn => {
    const existing = turnsByUserId.get(userMessageId)
    if (existing) return existing
    const iso = new Date(timestamp).toISOString()
    const created: MutableTurn = {
      userMessageId,
      startedAt: iso,
      endedAt: iso,
      incompleteFromSettlement: false,
      steps: [],
    }
    turnsByUserId.set(userMessageId, created)
    turnOrder.push(created)
    return created
  }

  const deduplicated: { event: SessionEvent.DurableEvent; index: number }[] = []
  for (let index = 0; index < input.events.length; index++) {
    const event = asDurableEvent(input.events[index])
    if (event.data.sessionID !== input.session.id) continue
    const seq = event.durable?.seq
    if (seq !== undefined) {
      if (seenSeqs.has(seq)) continue
      seenSeqs.add(seq)
      if (seq > observedSeq) observedSeq = seq
    }
    if (seenEventIds.has(event.id)) continue
    seenEventIds.add(event.id)
    deduplicated.push({ event, index })
  }

  deduplicated.sort((a, b) => {
    const seqA = a.event.durable?.seq
    const seqB = b.event.durable?.seq
    if (seqA !== undefined && seqB !== undefined && seqA !== seqB) {
      return seqA - seqB
    }
    return a.index - b.index
  })

  for (const { event } of deduplicated) {
    const eventMillis = toEpochMillis(event.data.timestamp)
    if (eventMillis > latestTimestamp) {
      latestTimestamp = eventMillis
    }

    if (event.type === "session.next.history.copy.message") {
      if (event.data.message.type === "assistant") {
        importedAssistants.add(event.data.message.id)
        importedContextSteps += 1
      }
      continue
    }

    if (event.type === "session.next.compaction.ended") {
      compactionCount += 1
      continue
    }

    if (event.type === "session.next.prompted") {
      currentTurn = ensureTurn(event.data.messageID, eventMillis)
      continue
    }

    if (event.type === "session.next.step.started") {
      const assistantId = event.data.assistantMessageID
      if (importedAssistants.has(assistantId) || stepByAssistantId.has(assistantId)) continue
      const targetTurn = currentTurn ?? ensureTurn(`unprompted:${assistantId}`, eventMillis)
      const startedIso = new Date(eventMillis).toISOString()
      const step: StepUsage = {
        assistantMessageId: assistantId,
        userMessageId: targetTurn.userMessageId,
        agent: event.data.agent,
        providerId: event.data.model.providerID,
        modelId: event.data.model.id,
        ...(event.data.model.variant ? { variant: event.data.model.variant } : {}),
        startedAt: startedIso,
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        modelCalls: 0,
        costUsd: null,
        usageIsIncomplete: true,
      }
      targetTurn.steps.push(step)
      targetTurn.endedAt = startedIso
      stepByAssistantId.set(assistantId, { turn: targetTurn, step })
      continue
    }

    if (event.type === "session.next.step.ended") {
      const assistantId = event.data.assistantMessageID
      if (importedAssistants.has(assistantId) || settledAssistants.has(assistantId)) continue
      const paired = stepByAssistantId.get(assistantId)
      if (!paired) continue
      settledAssistants.add(assistantId)
      const endedIso = new Date(eventMillis).toISOString()
      const inputTokens = event.data.tokens.input
      const outputTokens = event.data.tokens.output
      paired.step.endedAt = endedIso
      paired.step.finishReason = event.data.finish
      paired.step.inputTokens = inputTokens
      paired.step.outputTokens = outputTokens
      paired.step.cachedReadTokens = event.data.tokens.cache.read
      paired.step.cacheCreationTokens = event.data.tokens.cache.write
      paired.step.reasoningTokens = event.data.tokens.reasoning
      paired.step.totalTokens = inputTokens + outputTokens
      paired.step.modelCalls = 1
      paired.step.costUsd = null
      paired.step.usageIsIncomplete = false
      paired.turn.endedAt = endedIso
      continue
    }

    if (event.type === "session.next.step.failed") {
      const assistantId = event.data.assistantMessageID
      if (importedAssistants.has(assistantId) || settledAssistants.has(assistantId)) continue
      const paired = stepByAssistantId.get(assistantId)
      if (!paired) continue
      settledAssistants.add(assistantId)
      const endedIso = new Date(eventMillis).toISOString()
      paired.step.endedAt = endedIso
      paired.step.finishReason = "error"
      paired.step.error = event.data.error.message
      paired.step.modelCalls = 0
      paired.step.usageIsIncomplete = true
      paired.turn.endedAt = endedIso
      continue
    }

    if (event.type === "session.next.input.execution.settled") {
      const targetTurn = turnsByUserId.get(event.data.messageID)
      if (!targetTurn) continue
      const endedIso = new Date(eventMillis).toISOString()
      targetTurn.endedAt = endedIso
      if (
        event.data.usageIncomplete ||
        event.data.status === "failed" ||
        (event.data.status === "interrupted" && targetTurn.steps.length === 0)
      ) {
        targetTurn.incompleteFromSettlement = true
      }
    }
  }

  const recordedTurns = turnOrder
    .filter((item) => item.steps.length > 0 || item.incompleteFromSettlement)
    .map((item, idx) =>
      summarizeTurn({
        turnNumber: idx + 1,
        userMessageId: item.userMessageId,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        steps: item.steps,
        incompleteOverride: item.incompleteFromSettlement,
        costMode: "unavailable",
      }),
    )

  if (recordedTurns.length === 0) {
    throw noUsageRecorded(input.session.id)
  }

  const sessionSummary = summarizeSession(recordedTurns, "unavailable")
  const selectedTurns = selectTurns(recordedTurns, input.session.id, input.turn)

  return {
    sessionId: input.session.id,
    updatedAt: new Date(latestTimestamp).toISOString(),
    backend: "native",
    accountingScope: "durable-event-ledger",
    costStatus: "unavailable",
    observedSeq,
    importedContextSteps,
    compactionCount,
    session: sessionSummary,
    turns: selectedTurns,
  }
}

async function readCompatibilityUsageLocal(
  sessionID: string,
  turn: number | undefined,
  directory: string,
): Promise<SessionUsageReport> {
  if (!isSessionID(sessionID)) {
    throw sessionNotFound(sessionID)
  }
  const { Effect } = await import("effect")
  const { AppRuntime } = await import("@/effect/app-runtime")
  const { InstanceStore } = await import("@/project/instance-store")
  const { InstanceRef } = await import("@/effect/instance-ref")
  const { Session } = await import("@/session/session")
  const { store, ctx } = await AppRuntime.runPromise(
    InstanceStore.Service.use((svc) =>
      svc.load({ directory }).pipe(Effect.map((loaded) => ({ store: svc, ctx: loaded }))),
    ),
  )
  try {
    const data = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const svc = yield* Session.Service
        const id = SessionID.make(sessionID)
        const info = yield* svc.get(id)
        const messages = yield* svc.messages({ sessionID: info.id })
        return { info, messages }
      }).pipe(
        Effect.provideService(InstanceRef, ctx),
        Effect.catchCause(() => Effect.fail(sessionNotFound(sessionID))),
      ),
    )
    return buildCompatibilitySessionUsageReport({
      session: data.info,
      messages: data.messages,
      turn,
    })
  } finally {
    await AppRuntime.runPromise(store.dispose(ctx))
  }
}

async function readCompatibilityUsageFromClient(
  client: ApexoClient,
  sessionID: string,
  turn: number | undefined,
  directory: string | undefined,
): Promise<SessionUsageReport> {
  if (!isSessionID(sessionID)) {
    throw sessionNotFound(sessionID)
  }
  const sessionRes = await client.session.get({ sessionID, directory }, { throwOnError: false })
  if (!sessionRes.data) {
    if (sessionRes.response.status === 404 || sessionRes.response.status === 400) {
      throw sessionNotFound(sessionID)
    }
    throw new CliError({
      message: `Failed to read session '${sessionID}' (HTTP ${sessionRes.response.status}).`,
      exitCode: 1,
    })
  }
  const messagesRes = await client.session.messages({ sessionID, directory }, { throwOnError: true })
  return buildCompatibilitySessionUsageReport({
    session: sessionRes.data,
    messages: (messagesRes.data ?? []) as unknown as readonly SessionV1.WithParts[],
    turn,
  })
}

export function buildCompatibilitySessionUsageReport(input: {
  session: { id: string; time: { created: number; updated: number } }
  messages: readonly SessionV1.WithParts[]
  turn?: number
}): SessionUsageReport {
  interface MutableTurn {
    userMessageId: string
    startedAt: string
    endedAt: string
    steps: StepUsage[]
  }

  const turnsByUserId = new Map<string, MutableTurn>()
  const turnOrder: MutableTurn[] = []
  let latestTimestamp = input.session.time.updated

  const ensureTurn = (userMessageId: string, createdMs: number): MutableTurn => {
    const iso = new Date(createdMs).toISOString()
    const existing = turnsByUserId.get(userMessageId)
    if (existing) {
      if (iso < existing.startedAt) existing.startedAt = iso
      return existing
    }
    const created: MutableTurn = {
      userMessageId,
      startedAt: iso,
      endedAt: iso,
      steps: [],
    }
    turnsByUserId.set(userMessageId, created)
    turnOrder.push(created)
    return created
  }

  for (const message of input.messages) {
    if (message.info.time.created > latestTimestamp) {
      latestTimestamp = message.info.time.created
    }
    if (message.info.role === "user") {
      ensureTurn(message.info.id, message.info.time.created)
      continue
    }
    const assistant = message.info
    if (assistant.time.completed && assistant.time.completed > latestTimestamp) {
      latestTimestamp = assistant.time.completed
    }
    const targetTurn = ensureTurn(assistant.parentID, assistant.time.created)
    const startedIso = new Date(assistant.time.created).toISOString()
    const endedIso = assistant.time.completed ? new Date(assistant.time.completed).toISOString() : undefined
    const hasTokens =
      assistant.tokens.input > 0 ||
      assistant.tokens.output > 0 ||
      assistant.tokens.reasoning > 0 ||
      assistant.tokens.cache.read > 0 ||
      assistant.tokens.cache.write > 0
    const settled = Boolean(assistant.time.completed || assistant.finish || hasTokens) && !assistant.error
    const inputTokens = settled || hasTokens ? assistant.tokens.input : 0
    const outputTokens = settled || hasTokens ? assistant.tokens.output : 0
    const step: StepUsage = {
      assistantMessageId: assistant.id,
      userMessageId: assistant.parentID,
      agent: assistant.agent,
      providerId: assistant.providerID,
      modelId: assistant.modelID,
      ...(assistant.variant ? { variant: assistant.variant } : {}),
      startedAt: startedIso,
      ...(endedIso ? { endedAt: endedIso } : {}),
      ...(assistant.finish ? { finishReason: assistant.finish } : {}),
      inputTokens,
      outputTokens,
      cachedReadTokens: settled || hasTokens ? assistant.tokens.cache.read : 0,
      cacheCreationTokens: settled || hasTokens ? assistant.tokens.cache.write : 0,
      reasoningTokens: settled || hasTokens ? assistant.tokens.reasoning : 0,
      totalTokens: inputTokens + outputTokens,
      modelCalls: settled || hasTokens ? 1 : 0,
      costUsd: settled || hasTokens ? assistant.cost : null,
      usageIsIncomplete: !settled,
      ...(assistant.error
        ? {
            error:
              "message" in assistant.error.data && typeof assistant.error.data.message === "string"
                ? assistant.error.data.message
                : assistant.error.name,
          }
        : {}),
    }
    targetTurn.steps.push(step)
    targetTurn.endedAt = endedIso ?? startedIso
  }

  const recordedTurns = turnOrder
    .filter((item) => item.steps.length > 0)
    .map((item, idx) =>
      summarizeTurn({
        turnNumber: idx + 1,
        userMessageId: item.userMessageId,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        steps: item.steps,
        incompleteOverride: false,
        costMode: "recorded",
      }),
    )

  if (recordedTurns.length === 0) {
    throw noUsageRecorded(input.session.id)
  }

  const sessionSummary = summarizeSession(recordedTurns, "recorded")
  const selectedTurns = selectTurns(recordedTurns, input.session.id, input.turn)

  return {
    sessionId: input.session.id,
    updatedAt: new Date(latestTimestamp).toISOString(),
    backend: "compatibility",
    accountingScope: "projected-message-history",
    costStatus: "recorded",
    session: sessionSummary,
    turns: selectedTurns,
  }
}

function summarizeTurn(input: {
  turnNumber: number
  userMessageId: string
  startedAt: string
  endedAt: string
  steps: StepUsage[]
  incompleteOverride: boolean
  costMode: "unavailable" | "recorded"
}): TurnUsage {
  const modelUsage: Record<string, ModelUsageRow> = {}
  let inputTokens = 0
  let outputTokens = 0
  let cachedReadTokens = 0
  let cacheCreationTokens = 0
  let reasoningTokens = 0
  let modelCalls = 0
  let costSum = 0
  let costRecordedCalls = 0
  let costMissingCalls = 0
  let usageIsIncomplete = input.incompleteOverride

  for (const step of input.steps) {
    inputTokens += step.inputTokens
    outputTokens += step.outputTokens
    cachedReadTokens += step.cachedReadTokens
    cacheCreationTokens += step.cacheCreationTokens
    reasoningTokens += step.reasoningTokens
    modelCalls += step.modelCalls
    usageIsIncomplete = usageIsIncomplete || step.usageIsIncomplete

    if (input.costMode === "recorded" && step.costUsd !== null) {
      costSum = roundUsd(costSum + step.costUsd)
      costRecordedCalls += 1
    }
    if (input.costMode === "unavailable" || (step.modelCalls > 0 && step.costUsd === null)) {
      costMissingCalls += 1
    }

    const current = modelUsage[step.modelId] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      costUsd: input.costMode === "recorded" ? 0 : null,
      costIsPartial: false,
      usageIsIncomplete: false,
      turnCount: 1,
    }
    const nextInput = current.inputTokens + step.inputTokens
    const nextOutput = current.outputTokens + step.outputTokens
    const nextCost =
      input.costMode === "recorded"
        ? step.costUsd !== null
          ? roundUsd((current.costUsd ?? 0) + step.costUsd)
          : current.costUsd
        : null
    const nextIncomplete = current.usageIsIncomplete || step.usageIsIncomplete
    modelUsage[step.modelId] = {
      inputTokens: nextInput,
      outputTokens: nextOutput,
      cachedReadTokens: current.cachedReadTokens + step.cachedReadTokens,
      cacheCreationTokens: current.cacheCreationTokens + step.cacheCreationTokens,
      reasoningTokens: current.reasoningTokens + step.reasoningTokens,
      totalTokens: nextInput + nextOutput,
      modelCalls: current.modelCalls + step.modelCalls,
      costUsd: nextCost,
      costIsPartial: input.costMode === "unavailable" ? true : nextIncomplete,
      usageIsIncomplete: nextIncomplete,
      turnCount: 1,
    }
  }

  const totalTokens = inputTokens + outputTokens
  const primaryModelId = pickPrimaryModel(modelUsage)
  const costUsd = input.costMode === "recorded" ? (costRecordedCalls > 0 ? costSum : 0) : null
  const costIsPartial =
    input.costMode === "unavailable" ? true : (costRecordedCalls > 0 && costMissingCalls > 0) || usageIsIncomplete

  return {
    turnNumber: input.turnNumber,
    userMessageId: input.userMessageId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    inputTokens,
    outputTokens,
    cachedReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    totalTokens,
    modelCalls,
    costUsd,
    costIsPartial,
    usageIsIncomplete,
    turnCount: 1,
    ...(primaryModelId ? { primaryModelId } : {}),
    modelUsage,
    steps: input.steps,
  }
}

function summarizeSession(turns: readonly TurnUsage[], costMode: "unavailable" | "recorded"): UsageSummary {
  const modelUsage: Record<string, ModelUsageRow> = {}
  let inputTokens = 0
  let outputTokens = 0
  let cachedReadTokens = 0
  let cacheCreationTokens = 0
  let reasoningTokens = 0
  let modelCalls = 0
  let costSum = 0
  let costIsPartial = costMode === "unavailable"
  let usageIsIncomplete = false

  for (const turn of turns) {
    inputTokens += turn.inputTokens
    outputTokens += turn.outputTokens
    cachedReadTokens += turn.cachedReadTokens
    cacheCreationTokens += turn.cacheCreationTokens
    reasoningTokens += turn.reasoningTokens
    modelCalls += turn.modelCalls
    if (costMode === "recorded" && turn.costUsd !== null) {
      costSum = roundUsd(costSum + turn.costUsd)
    }
    costIsPartial = costIsPartial || turn.costIsPartial
    usageIsIncomplete = usageIsIncomplete || turn.usageIsIncomplete

    for (const [modelId, row] of Object.entries(turn.modelUsage)) {
      const existing = modelUsage[modelId] ?? {
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        modelCalls: 0,
        costUsd: costMode === "recorded" ? 0 : null,
        costIsPartial: costMode === "unavailable",
        usageIsIncomplete: false,
        turnCount: 0,
      }
      const nextInput = existing.inputTokens + row.inputTokens
      const nextOutput = existing.outputTokens + row.outputTokens
      modelUsage[modelId] = {
        inputTokens: nextInput,
        outputTokens: nextOutput,
        cachedReadTokens: existing.cachedReadTokens + row.cachedReadTokens,
        cacheCreationTokens: existing.cacheCreationTokens + row.cacheCreationTokens,
        reasoningTokens: existing.reasoningTokens + row.reasoningTokens,
        totalTokens: nextInput + nextOutput,
        modelCalls: existing.modelCalls + row.modelCalls,
        costUsd:
          costMode === "recorded" && row.costUsd !== null
            ? roundUsd((existing.costUsd ?? 0) + row.costUsd)
            : existing.costUsd,
        costIsPartial: existing.costIsPartial || row.costIsPartial,
        usageIsIncomplete: existing.usageIsIncomplete || row.usageIsIncomplete,
        turnCount: existing.turnCount + row.turnCount,
      }
    }
  }

  const primaryModelId = pickPrimaryModel(modelUsage)
  return {
    inputTokens,
    outputTokens,
    cachedReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens,
    modelCalls,
    costUsd: costMode === "recorded" ? costSum : null,
    costIsPartial,
    usageIsIncomplete,
    turnCount: turns.length,
    ...(primaryModelId ? { primaryModelId } : {}),
    modelUsage,
  }
}

function pickPrimaryModel(modelUsage: Record<string, ModelUsageRow>): string | undefined {
  let bestModel: string | undefined
  let bestCalls = -1
  let bestTokens = -1
  for (const [modelId, row] of Object.entries(modelUsage)) {
    if (row.modelCalls > bestCalls || (row.modelCalls === bestCalls && row.totalTokens > bestTokens)) {
      bestModel = modelId
      bestCalls = row.modelCalls
      bestTokens = row.totalTokens
    }
  }
  return bestModel
}

function selectTurns(turns: TurnUsage[], sessionID: string, turn?: number): TurnUsage[] {
  if (turn === undefined) return turns
  const found = turns.find((item) => item.turnNumber === turn)
  if (!found) {
    throw new CliError({
      message: `Turn ${turn} not found in session '${sessionID}'.`,
      exitCode: 1,
    })
  }
  return [found]
}

function sessionNotFound(sessionID: string) {
  return new CliError({
    message: `Session '${sessionID}' not found.`,
    exitCode: 1,
  })
}

function noUsageRecorded(sessionID: string) {
  return new CliError({
    message: `No usage recorded for session '${sessionID}'.`,
    exitCode: 1,
  })
}

function roundUsd(value: number): number {
  return Number(value.toFixed(10))
}

function toEpochMillis(value: number | DateTime.Utc): number {
  return DateTime.isDateTime(value) ? DateTime.toEpochMillis(value) : value
}
