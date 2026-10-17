import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, open, writeFile } from "node:fs/promises"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { DateTime, Schema } from "effect"
import { Global } from "@apexo/core/global"
import { InstallationVersion } from "@apexo/core/installation/version"
import { SessionID } from "@apexo/schema/session-id"
import { SessionEvent } from "@apexo/schema/session-event"
import type { SessionV1 } from "@apexo/core/v1/session"
import type { ApexoClient } from "@apexo/sdk/v2/client"
import { ServerAuth } from "@/server/auth"
import { CliError } from "../effect-cmd"
import { cmd } from "./cmd"
import {
  buildCompatibilitySessionUsageReport,
  buildNativeSessionUsageReport,
  fetchNativeHistoryPages,
  type SessionUsageReport,
} from "./usage"

export interface SessionTraceBundle {
  sessionId: string
  files: Record<string, string>
}

export interface SessionTraceExportResult {
  session_id: string
  status: "exported"
  local_path: string
}

const isSessionID = Schema.is(SessionID)
const isDecodedDurableEvent = Schema.is(Schema.toType(SessionEvent.Durable))
const decodeDurableEvent = Schema.decodeUnknownSync(SessionEvent.Durable)

function asDurableEvent(raw: unknown): SessionEvent.DurableEvent {
  return isDecodedDurableEvent(raw) ? raw : decodeDurableEvent(raw)
}

export const TraceCommand = cmd({
  command: "trace <sessionID>",
  describe: "export a local session trace bundle (.tar.gz) for a session",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session ID to export",
        type: "string",
        demandOption: true,
      })
      .option("local", {
        describe: "save the bundle to a local .tar.gz file instead of uploading",
        type: "boolean",
        default: false,
      })
      .option("output", {
        alias: "o",
        describe: "output file path (only used with --local)",
        type: "string",
      })
      .option("json", {
        describe: "emit machine-readable JSON status output",
        type: "boolean",
        default: false,
      })
      .option("sanitize", {
        describe: "redact prompt, message, title, and workspace path strings in the bundle",
        type: "boolean",
        default: false,
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
    if (!args.local) {
      process.stderr.write("Trace uploads disabled.\nFalling back to local export.\n")
    }
    const bundle = await loadSessionTraceBundle({
      sessionID: args.sessionID,
      sanitize: Boolean(args.sanitize),
      attach: args.attach,
      sessionProtocol: args["session-protocol"] ?? "auto",
      directory: args.dir,
      password: args.password,
      username: args.username,
    })
    const explicitOutput = typeof args.output === "string" && args.output.trim().length > 0
    const outputPath = explicitOutput
      ? path.resolve(process.cwd(), args.output!)
      : path.join(defaultTraceExportDir(), `${bundle.sessionId}.tar.gz`)
    const result = await exportSessionTraceArchive({
      bundle,
      outputPath,
      explicitOutput,
    })
    if (args.json) {
      process.stdout.write(JSON.stringify(result) + "\n")
      return
    }
    process.stdout.write(`Exported trace to ${result.local_path}\n`)
  },
})

export function defaultTraceExportDir(): string {
  const grokHome = process.env.GROK_HOME?.trim()
  if (grokHome) return path.join(grokHome, "trace-exports")
  return path.join(Global.Path.data, "trace-exports")
}

export async function loadSessionTraceBundle(input: {
  sessionID: string
  sanitize?: boolean
  attach?: string
  sessionProtocol?: "auto" | "native" | "compatibility"
  directory?: string
  password?: string
  username?: string
}): Promise<SessionTraceBundle> {
  const protocol = input.sessionProtocol ?? "auto"
  const directory = input.directory ? path.resolve(process.cwd(), input.directory) : undefined
  const sanitize = Boolean(input.sanitize)

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
      return readNativeTraceFromClient(client, input.sessionID, sanitize)
    }
    return readCompatibilityTraceFromClient(client, input.sessionID, directory, sanitize)
  }

  if (protocol === "compatibility") {
    return readCompatibilityTraceLocal(input.sessionID, directory ?? process.cwd(), sanitize)
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
    return await readNativeTraceFromClient(client, input.sessionID, sanitize)
  } finally {
    await host.close()
  }
}

export async function readNativeTraceFromClient(
  client: ApexoClient,
  sessionID: string,
  sanitize = false,
): Promise<SessionTraceBundle> {
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
  const [events, messagesRes] = await Promise.all([
    fetchNativeHistoryPages(
      (after) =>
        client.v2.session
          .history({ sessionID, after, limit: 100 }, { throwOnError: true, signal: AbortSignal.timeout(10_000) })
          .then((res) => res.data),
      sessionID,
    ),
    client.v2.session.messages({ sessionID }, { throwOnError: true, signal: AbortSignal.timeout(10_000) }),
  ])
  return buildNativeSessionTraceBundle({
    session: sessionRes.data.data,
    events,
    messages: messagesRes.data?.data ?? [],
    sanitize,
  })
}

async function readCompatibilityTraceFromClient(
  client: ApexoClient,
  sessionID: string,
  directory: string | undefined,
  sanitize: boolean,
): Promise<SessionTraceBundle> {
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
  return buildCompatibilitySessionTraceBundle({
    session: sessionRes.data,
    messages: (messagesRes.data ?? []) as unknown as readonly SessionV1.WithParts[],
    sanitize,
  })
}

async function readCompatibilityTraceLocal(
  sessionID: string,
  directory: string,
  sanitize: boolean,
): Promise<SessionTraceBundle> {
  if (!isSessionID(sessionID)) {
    throw sessionNotFound(sessionID)
  }
  const { Effect } = await import("effect")
  const { AppRuntime } = await import("@/effect/app-runtime")
  const { InstanceStore } = await import("@/project/instance-store")
  const { InstanceRef } = await import("@/effect/instance-ref")
  const { Session } = await import("@/session/session")
  const loaded = await AppRuntime.runPromise(
    InstanceStore.Service.use((svc) =>
      svc.load({ directory }).pipe(Effect.map((ctx) => ({ store: svc, ctx }))),
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
        Effect.provideService(InstanceRef, loaded.ctx),
        Effect.catchCause(() => Effect.fail(sessionNotFound(sessionID))),
      ),
    )
    return buildCompatibilitySessionTraceBundle({
      session: data.info,
      messages: data.messages,
      sanitize,
    })
  } finally {
    await AppRuntime.runPromise(loaded.store.dispose(loaded.ctx))
  }
}

export function buildNativeSessionTraceBundle(input: {
  session: {
    id: string
    title?: string
    location?: { directory: string; workspaceID?: string }
    agent?: string
    model?: { providerID: string; id: string; variant?: string }
    time: { created: number | DateTime.Utc; updated: number | DateTime.Utc }
  }
  events: readonly unknown[]
  messages: readonly unknown[]
  sanitize?: boolean
}): SessionTraceBundle {
  const sanitize = Boolean(input.sanitize)
  const createdMs = toEpochMillis(input.session.time.created)
  const updatedMs = toEpochMillis(input.session.time.updated)
  const decodedEvents = input.events.map(asDurableEvent)

  const usage = safeBuildNativeUsage(input.session, decodedEvents, updatedMs)
  const cwd = input.session.location?.directory ?? ""
  const modelId = input.session.model?.id ?? usage.session.primaryModelId ?? null

  const summary = {
    info: {
      id: input.session.id,
      title: sanitize ? redactText(input.session.title ?? "") : (input.session.title ?? null),
      cwd: sanitize ? redactText(cwd) : cwd,
      created_at: new Date(createdMs).toISOString(),
      updated_at: new Date(updatedMs).toISOString(),
      backend: "native",
    },
    num_messages: input.messages.length,
    num_events: decodedEvents.length,
    current_model_id: modelId,
    agent: input.session.agent ?? null,
    total_input_tokens: usage.session.inputTokens,
    total_output_tokens: usage.session.outputTokens,
    total_cost_usd: usage.session.costUsd ?? 0,
  }

  const eventsLines = decodedEvents
    .map((event) => JSON.stringify(sanitize ? sanitizeValue(event) : event))
    .join("\n")
  const chatLines = input.messages
    .map((message) => JSON.stringify(sanitize ? sanitizeValue(message) : message))
    .join("\n")

  const traceConfig = {
    schema_version: 1,
    sanitized: sanitize,
    backend: "native",
  }

  const exportMetadata = {
    session_id: input.session.id,
    exported_at: new Date().toISOString(),
    exporter: "apexo",
    exporter_version: InstallationVersion,
    sanitized: sanitize,
  }

  return {
    sessionId: input.session.id,
    files: {
      "summary.json": JSON.stringify(summary, null, 2) + "\n",
      "usage.json": JSON.stringify(usage, null, 2) + "\n",
      "events.jsonl": eventsLines ? eventsLines + "\n" : "",
      "chat_history.jsonl": chatLines ? chatLines + "\n" : "",
      "trace_config.json": JSON.stringify(traceConfig, null, 2) + "\n",
      "export_metadata.json": JSON.stringify(exportMetadata, null, 2) + "\n",
    },
  }
}

export function buildCompatibilitySessionTraceBundle(input: {
  session: {
    id: string
    title?: string
    directory?: string
    time: { created: number; updated: number }
  }
  messages: readonly SessionV1.WithParts[]
  sanitize?: boolean
}): SessionTraceBundle {
  const sanitize = Boolean(input.sanitize)
  const usage = safeBuildCompatibilityUsage(input.session, input.messages)
  const cwd = input.session.directory ?? ""

  const summary = {
    info: {
      id: input.session.id,
      title: sanitize ? redactText(input.session.title ?? "") : (input.session.title ?? null),
      cwd: sanitize ? redactText(cwd) : cwd,
      created_at: new Date(input.session.time.created).toISOString(),
      updated_at: new Date(input.session.time.updated).toISOString(),
      backend: "compatibility",
    },
    num_messages: input.messages.length,
    num_events: input.messages.length,
    current_model_id: usage.session.primaryModelId ?? null,
    agent: null,
    total_input_tokens: usage.session.inputTokens,
    total_output_tokens: usage.session.outputTokens,
    total_cost_usd: usage.session.costUsd ?? 0,
  }

  const syntheticEvents = input.messages.map((msg, idx) => ({
    seq: idx + 1,
    id: msg.info.id,
    role: msg.info.role,
    created_at: new Date(msg.info.time.created).toISOString(),
    parts: msg.parts.length,
  }))

  const eventsLines = syntheticEvents
    .map((event) => JSON.stringify(sanitize ? sanitizeValue(event) : event))
    .join("\n")
  const chatLines = input.messages
    .map((message) => JSON.stringify(sanitize ? sanitizeValue(message) : message))
    .join("\n")

  const traceConfig = {
    schema_version: 1,
    sanitized: sanitize,
    backend: "compatibility",
  }

  const exportMetadata = {
    session_id: input.session.id,
    exported_at: new Date().toISOString(),
    exporter: "apexo",
    exporter_version: InstallationVersion,
    sanitized: sanitize,
  }

  return {
    sessionId: input.session.id,
    files: {
      "summary.json": JSON.stringify(summary, null, 2) + "\n",
      "usage.json": JSON.stringify(usage, null, 2) + "\n",
      "events.jsonl": eventsLines ? eventsLines + "\n" : "",
      "chat_history.jsonl": chatLines ? chatLines + "\n" : "",
      "trace_config.json": JSON.stringify(traceConfig, null, 2) + "\n",
      "export_metadata.json": JSON.stringify(exportMetadata, null, 2) + "\n",
    },
  }
}

export async function exportSessionTraceArchive(input: {
  bundle: SessionTraceBundle
  outputPath: string
  explicitOutput?: boolean
}): Promise<SessionTraceExportResult> {
  const resolved = path.resolve(input.outputPath)
  if (input.explicitOutput && existsSync(resolved)) {
    throw new CliError({
      message: `Not exported: ${resolved} already exists. Choose a new file name.`,
      exitCode: 1,
    })
  }
  await mkdir(path.dirname(resolved), { recursive: true })
  const archive = createTarGzArchive(input.bundle.sessionId, input.bundle.files)
  if (input.explicitOutput) {
    const handle = await open(resolved, "wx").catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "EEXIST") {
        throw new CliError({
          message: `Not exported: ${resolved} already exists. Choose a new file name.`,
          exitCode: 1,
        })
      }
      throw err
    })
    try {
      await handle.writeFile(archive)
    } finally {
      await handle.close()
    }
  } else {
    await writeFile(resolved, archive)
  }
  return {
    session_id: input.bundle.sessionId,
    status: "exported",
    local_path: resolved,
  }
}

export function createTarGzArchive(sessionId: string, files: Record<string, string>): Buffer {
  const blocks: Buffer[] = []
  const mtimeSeconds = Math.floor(Date.now() / 1000)
  for (const name of Object.keys(files).sort()) {
    const entryName = `${sessionId}/${name}`
    const content = Buffer.from(files[name] ?? "", "utf8")
    blocks.push(createTarHeader(entryName, content.length, mtimeSeconds))
    blocks.push(content)
    const remainder = content.length % 512
    if (remainder !== 0) {
      blocks.push(Buffer.alloc(512 - remainder, 0))
    }
  }
  // End of archive: two 512-byte zero blocks
  blocks.push(Buffer.alloc(1024, 0))
  return gzipSync(Buffer.concat(blocks))
}

function createTarHeader(entryName: string, byteLength: number, mtimeSeconds: number): Buffer {
  const header = Buffer.alloc(512, 0)
  writeTarString(header, 0, 100, entryName)
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, byteLength)
  writeTarOctal(header, 136, 12, mtimeSeconds)
  // Fill checksum field with spaces (0x20) before computing checksum
  header.fill(0x20, 148, 156)
  header[156] = "0".charCodeAt(0)
  writeTarString(header, 257, 6, "ustar")
  writeTarString(header, 263, 2, "00")

  let sum = 0
  for (let idx = 0; idx < 512; idx++) {
    sum += header[idx]!
  }
  const checksumOctal = sum.toString(8).padStart(6, "0")
  header.write(checksumOctal, 148, 6, "ascii")
  header[154] = 0
  header[155] = 0x20
  return header
}

function writeTarString(buf: Buffer, offset: number, length: number, value: string) {
  const bytes = Buffer.from(value, "utf8")
  bytes.copy(buf, offset, 0, Math.min(bytes.length, length))
}

function writeTarOctal(buf: Buffer, offset: number, length: number, value: number) {
  const digits = Math.max(0, value).toString(8).padStart(length - 1, "0")
  buf.write(digits, offset, length - 1, "ascii")
  buf[offset + length - 1] = 0
}

function safeBuildNativeUsage(
  session: { id: string; time: { created: number | DateTime.Utc; updated: number | DateTime.Utc } },
  events: readonly SessionEvent.DurableEvent[],
  updatedMs: number,
): SessionUsageReport {
  const hasSteps = events.some(
    (item) =>
      item.type === "session.next.step.started" ||
      item.type === "session.next.input.execution.settled",
  )
  if (!hasSteps) {
    return emptyUsageReport(session.id, updatedMs, "native")
  }
  return buildNativeSessionUsageReport({ session, events })
}

function safeBuildCompatibilityUsage(
  session: { id: string; time: { created: number; updated: number } },
  messages: readonly SessionV1.WithParts[],
): SessionUsageReport {
  const hasAssistant = messages.some((item) => item.info.role === "assistant")
  if (!hasAssistant) {
    return emptyUsageReport(session.id, session.time.updated, "compatibility")
  }
  return buildCompatibilitySessionUsageReport({ session, messages })
}

function emptyUsageReport(
  sessionId: string,
  updatedMs: number,
  backend: "native" | "compatibility",
): SessionUsageReport {
  return {
    sessionId,
    updatedAt: new Date(updatedMs).toISOString(),
    backend,
    accountingScope: backend === "native" ? "durable-event-ledger" : "projected-message-history",
    costStatus: backend === "native" ? "unavailable" : "recorded",
    session: {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      costUsd: backend === "native" ? null : 0,
      costIsPartial: backend === "native",
      usageIsIncomplete: false,
      turnCount: 0,
      modelUsage: {},
    },
    turns: [],
  }
}

const PRESERVED_STRING_KEYS = new Set([
  "id",
  "sessionID",
  "sessionId",
  "messageID",
  "messageId",
  "assistantMessageID",
  "assistantMessageId",
  "userMessageID",
  "userMessageId",
  "parentID",
  "aggregateID",
  "type",
  "role",
  "delivery",
  "status",
  "finish",
  "agent",
  "providerID",
  "providerId",
  "modelID",
  "modelId",
  "variant",
])

function redactText(value: string): string {
  if (!value) return value
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 8)
  return `[redacted:${digest}]`
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key && PRESERVED_STRING_KEYS.has(key)) return value
    return redactText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item))
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [entryKey, entryVal] of Object.entries(value)) {
      out[entryKey] = sanitizeValue(entryVal, entryKey)
    }
    return out
  }
  return value
}

function sessionNotFound(sessionID: string) {
  return new CliError({
    message: `Session '${sessionID}' not found.`,
    exitCode: 1,
  })
}

function toEpochMillis(value: number | DateTime.Utc): number {
  return DateTime.isDateTime(value) ? DateTime.toEpochMillis(value) : value
}
