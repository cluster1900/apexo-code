import type { Message, Part, Session } from "./gen/types.gen.js"

// Shared Session report builders for the Desktop and TUI `/copy`, `/usage` and `/trace` commands.
// They read the same `{ info, messages: [{ info, parts }] }` shape that `apexo export` produces.
export type SessionReportData = {
  info: Pick<Session, "id" | "title" | "directory" | "time">
  messages: { info: Message; parts: Part[] }[]
}

function visibleText(parts: Part[]) {
  return parts
    .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
    .join("\n")
    .trim()
}

export function sessionTranscript(data: SessionReportData) {
  const title = `# ${data.info.title || data.info.id}`
  const body = data.messages.flatMap((message) => {
    const text = visibleText(message.parts)
    if (!text) return []
    return [`## ${message.info.role === "user" ? "User" : "Assistant"}\n\n${text}`]
  })
  return [title, ...body].join("\n\n") + "\n"
}

export type SessionUsageModel = {
  providerID: string
  modelID: string
  calls: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

export type SessionUsageSummary = {
  sessionID: string
  turns: number
  calls: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  models: SessionUsageModel[]
}

export function sessionUsage(data: SessionReportData): SessionUsageSummary {
  const assistants = data.messages.flatMap((message) => (message.info.role === "assistant" ? [message.info] : []))
  const models = new Map<string, SessionUsageModel>()
  for (const item of assistants) {
    const key = `${item.providerID}/${item.modelID}`
    const entry = models.get(key) ?? {
      providerID: item.providerID,
      modelID: item.modelID,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    }
    entry.calls += 1
    entry.inputTokens += item.tokens.input
    entry.outputTokens += item.tokens.output
    entry.reasoningTokens += item.tokens.reasoning
    entry.cacheReadTokens += item.tokens.cache.read
    entry.cacheWriteTokens += item.tokens.cache.write
    entry.costUsd += item.cost
    models.set(key, entry)
  }
  const list = [...models.values()]
  const sum = (pick: (model: SessionUsageModel) => number) => list.reduce((total, model) => total + pick(model), 0)
  return {
    sessionID: data.info.id,
    turns: new Set(assistants.map((item) => item.parentID)).size,
    calls: sum((model) => model.calls),
    inputTokens: sum((model) => model.inputTokens),
    outputTokens: sum((model) => model.outputTokens),
    reasoningTokens: sum((model) => model.reasoningTokens),
    cacheReadTokens: sum((model) => model.cacheReadTokens),
    cacheWriteTokens: sum((model) => model.cacheWriteTokens),
    costUsd: sum((model) => model.costUsd),
    models: list,
  }
}

export function sessionTrace(data: SessionReportData, exporter: string, exportedAt = new Date()) {
  const usage = sessionUsage(data)
  return {
    summary: {
      info: {
        id: data.info.id,
        title: data.info.title ?? null,
        cwd: data.info.directory,
        created_at: new Date(data.info.time.created).toISOString(),
        updated_at: new Date(data.info.time.updated).toISOString(),
      },
      num_messages: data.messages.length,
      total_input_tokens: usage.inputTokens,
      total_output_tokens: usage.outputTokens,
      total_cost_usd: usage.costUsd,
    },
    usage,
    events: data.messages.map((message, index) => ({
      seq: index + 1,
      id: message.info.id,
      role: message.info.role,
      created_at: new Date(message.info.time.created).toISOString(),
      parts: message.parts.length,
    })),
    chat_history: data.messages,
    export_metadata: { session_id: data.info.id, exported_at: exportedAt.toISOString(), exporter },
  }
}
