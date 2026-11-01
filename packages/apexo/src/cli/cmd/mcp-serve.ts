import path from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { InstallationVersion } from "@apexo/core/installation/version"
import { SessionInput } from "@apexo/schema/session-input"
import { SessionMessage } from "@apexo/schema/session-message"
import { createApexoClient, type ApexoClient } from "@apexo/sdk/v2/client"
import { nativeSessionTransport } from "@apexo/tui/transport/native-session"
import { Schema } from "effect"
import type { Argv } from "yargs"
import { nativeLocalDirectory } from "../native-local"
import { createNativeLocalHost } from "../native-local-host"
import { cmd } from "./cmd"
import { buildReviewPrompt } from "./review"

export interface ApexoMcpServerOptions {
  readonly defaultDirectory: string
  readonly defaultAgent?: string
  readonly defaultModel?: string
  readonly defaultAuto?: boolean
  readonly clientForDirectory: (directory: string) => ApexoClient
}

const TOOL_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    sessionID: { type: "string" },
    status: { type: "string" },
    reason: { type: "string" },
    ephemeral: { type: "boolean" },
    output: { type: "string" },
  },
  required: ["sessionID", "status", "reason", "ephemeral", "output"],
} as const

function parseModelRef(value?: string) {
  if (!value) return undefined
  const trimmed = value.trim()
  const slash = trimmed.indexOf("/")
  if (slash <= 0 || slash === trimmed.length - 1) throw new Error("model must use provider/model syntax")
  return { providerID: trimmed.slice(0, slash), modelID: trimmed.slice(slash + 1) }
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`)
  return value
}

async function readTurnOutput(sdk: ApexoClient, sessionID: string, inputID: string, signal: AbortSignal) {
  const page = (
    await sdk.v2.session.messages({ sessionID, order: "desc", limit: 50 }, { throwOnError: true, signal })
  ).data.data
  const inputIndex = page.findIndex((item) => item.id === inputID)
  const after = (inputIndex >= 0 ? page.slice(0, inputIndex) : page).toReversed()
  const nextUser = after.findIndex((item) => item.type === "user")
  const turn = (nextUser >= 0 ? after.slice(0, nextUser) : after).filter((item) => item.type === "assistant")
  const text =
    turn
      .toReversed()
      .map((item) =>
        item.content
          .flatMap((part) => (part.type === "text" && part.text.length > 0 ? [part.text] : []))
          .join("\n"),
      )
      .find((item) => item.length > 0) ?? ""
  const errors = turn.flatMap((item) => (item.error?.message ? [item.error.message] : []))
  return { text, errors }
}

async function executeMcpTurn(input: {
  readonly sdk: ApexoClient
  readonly directory: string
  readonly prompt: string
  readonly sessionID?: string
  readonly agent?: string
  readonly model?: string
  readonly auto?: boolean
  readonly ephemeral?: boolean
  readonly signal?: AbortSignal
}) {
  if (!input.prompt.trim()) throw new Error("prompt must be a non-empty string")
  if (input.ephemeral && input.sessionID) throw new Error("ephemeral cannot be combined with sessionID")
  const parsedModel = parseModelRef(input.model)
  const callSignal = () =>
    input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)
  const transport = nativeSessionTransport(input.sdk, input.directory, input.signal)
  const existing = input.sessionID ? await transport.get(input.sessionID, callSignal()) : undefined
  const catalog = await transport.catalog(callSignal())
  const agent =
    input.agent ?? existing?.agent ?? catalog.agents.find((item) => item.mode !== "subagent" && !item.hidden)?.id
  const configured = catalog.agents.find((item) => item.id === agent)?.model
  const fallback = catalog.models.find(
    (item) =>
      item.enabled && catalog.providers.some((provider) => provider.id === item.providerID && !provider.disabled),
  )
  const stored = existing?.model ?? configured ?? fallback
  const selected = parsedModel
    ? { providerID: parsedModel.providerID, id: parsedModel.modelID }
    : stored
      ? {
          providerID: stored.providerID,
          id: stored.id,
          ...("variant" in stored && stored.variant ? { variant: stored.variant } : {}),
        }
      : undefined
  const session = existing ?? (await transport.create({ agent, model: selected }, callSignal()))
  const ephemeralSessionID = !existing && input.ephemeral ? session.id : undefined
  try {
    if (existing && input.agent && input.agent !== existing.agent)
      await transport.switchAgent({ sessionID: session.id, agent: input.agent }, callSignal())
    if (existing && parsedModel && selected)
      await transport.switchModel({ sessionID: session.id, model: selected }, callSignal())
    const inputID = SessionMessage.ID.create()
    const target = { sessionID: session.id, inputID }
    await transport.admit(
      {
        sessionID: session.id,
        id: inputID,
        prompt: { text: input.prompt },
        executionPolicy: { mode: "headless", permissions: input.auto ? "approve_once" : "reject" },
      },
      callSignal(),
    )
    const decode = Schema.decodeUnknownSync(SessionInput.Execution)
    const interrupt = async () => {
      await input.sdk.v2.session.input.interrupt(target, { signal: AbortSignal.timeout(10000) }).catch(() => {})
      return {
        sessionID: session.id,
        status: "interrupted",
        reason: "interrupted",
        ephemeral: Boolean(input.ephemeral),
        output: "Execution interrupted",
        isError: true,
      }
    }
    while (true) {
      if (input.signal?.aborted) return await interrupt()
      const waited = await input.sdk.v2.session.input
        .wait({ ...target, timeoutMs: 250 }, { throwOnError: true, signal: callSignal() })
        .catch(() => undefined)
      if (!waited) {
        if (input.signal?.aborted) return await interrupt()
        throw new Error("Failed while waiting for native input settlement")
      }
      if (waited.data.data.timedOut) continue
      const execution = decode(waited.data.data.execution)
      const { text, errors } = await readTurnOutput(input.sdk, session.id, inputID, AbortSignal.timeout(10000))
      if (execution.status !== "completed") {
        const detail =
          [text, ...errors].filter(Boolean).join("\n") ||
          `Execution ${execution.status} (${execution.reason ?? execution.status})`
        return {
          sessionID: session.id,
          status: execution.status,
          reason: execution.reason ?? execution.status,
          ephemeral: Boolean(input.ephemeral),
          output: detail,
          isError: true,
        }
      }
      return {
        sessionID: session.id,
        status: execution.status,
        reason: execution.reason ?? "completed",
        ephemeral: Boolean(input.ephemeral),
        output: text,
        isError: false,
      }
    }
  } finally {
    if (ephemeralSessionID)
      await input.sdk.v2.session
        .remove({ sessionID: ephemeralSessionID }, { signal: AbortSignal.timeout(10000) })
        .catch(() => {})
  }
}

export function createApexoMcpServer(options: ApexoMcpServerOptions) {
  const server = new Server({ name: "apexo", version: InstallationVersion }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "apexo_run",
        description:
          "Run a headless Apexo coding-agent turn or continue an existing Apexo session by passing sessionID.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Task instructions or follow-up message for Apexo." },
            sessionID: {
              type: "string",
              description: "Existing Apexo session ID (ses_...) to continue a multi-turn conversation.",
            },
            cwd: {
              type: "string",
              description: "Working directory for execution (defaults to the server startup directory).",
            },
            agent: { type: "string", description: "Agent name override (for example build or explore)." },
            model: { type: "string", description: "Model override in provider/model format." },
            auto: { type: "boolean", description: "Auto-approve non-denied permissions for this headless turn." },
            ephemeral: {
              type: "boolean",
              description: "Delete the created session on completion (cannot be combined with sessionID).",
            },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
        outputSchema: TOOL_OUTPUT_SCHEMA,
      },
      {
        name: "apexo_review",
        description:
          "Run a read-only Apexo code review on uncommitted changes, a base branch, a commit, or a pull request.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Repository directory to review (defaults to the server startup directory).",
            },
            uncommitted: {
              type: "boolean",
              description: "Review staged, unstaged, and untracked working tree changes.",
            },
            base: { type: "string", description: "Base branch or git ref to compare HEAD against." },
            commit: { type: "string", description: "Commit SHA or ref to review." },
            pr: { type: "string", description: "Pull request number or URL to review." },
            title: { type: "string", description: "Optional commit or pull request title for context." },
            prompt: { type: "string", description: "Optional custom review focus or instructions." },
            model: { type: "string", description: "Model override in provider/model format." },
            auto: {
              type: "boolean",
              description: "Auto-approve non-denied read/inspection permissions during review.",
            },
          },
          additionalProperties: false,
        },
        outputSchema: TOOL_OUTPUT_SCHEMA,
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args =
      request.params.arguments && typeof request.params.arguments === "object" && !Array.isArray(request.params.arguments)
        ? (request.params.arguments as Record<string, unknown>)
        : {}
    const run = async () => {
      const rawCwd = readOptionalString(args, "cwd")
      const directory = await nativeLocalDirectory(
        rawCwd ? path.resolve(options.defaultDirectory, rawCwd) : options.defaultDirectory,
      )
      const sdk = options.clientForDirectory(directory)
      if (request.params.name === "apexo_run") {
        const prompt = readOptionalString(args, "prompt")
        if (!prompt) throw new Error("prompt is required")
        return executeMcpTurn({
          sdk,
          directory,
          prompt,
          sessionID: readOptionalString(args, "sessionID"),
          agent: readOptionalString(args, "agent") ?? options.defaultAgent,
          model: readOptionalString(args, "model") ?? options.defaultModel,
          auto: readOptionalBoolean(args, "auto") ?? options.defaultAuto,
          ephemeral: readOptionalBoolean(args, "ephemeral"),
          signal: extra.signal,
        })
      }
      if (request.params.name === "apexo_review") {
        const prompt = buildReviewPrompt({
          uncommitted: readOptionalBoolean(args, "uncommitted"),
          base: readOptionalString(args, "base"),
          commit: readOptionalString(args, "commit"),
          pr: readOptionalString(args, "pr"),
          title: readOptionalString(args, "title"),
          prompt: readOptionalString(args, "prompt"),
        })
        return executeMcpTurn({
          sdk,
          directory,
          prompt,
          agent: options.defaultAgent,
          model: readOptionalString(args, "model") ?? options.defaultModel,
          auto: readOptionalBoolean(args, "auto") ?? options.defaultAuto,
          ephemeral: true,
          signal: extra.signal,
        })
      }
      throw new Error(`Unknown tool: ${request.params.name}`)
    }
    return run().then(
      (result) => {
        const body = result.output || "(no output)"
        const text = result.ephemeral ? body : `${body}\n\n[sessionID: ${result.sessionID}]`
        const structuredContent = {
          sessionID: result.sessionID,
          status: result.status,
          reason: result.reason,
          ephemeral: result.ephemeral,
          output: result.output,
        }
        return {
          content: [{ type: "text" as const, text }],
          structuredContent,
          ...(result.isError ? { isError: true } : {}),
        }
      },
      (error) => ({
        isError: true,
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
      }),
    )
  })

  return server
}

export const McpServeCommand = cmd({
  command: "serve",
  describe: "run Apexo as an MCP server over stdio",
  builder: (yargs: Argv) =>
    yargs
      .option("dir", { type: "string", describe: "default working directory when tool calls omit cwd" })
      .option("model", { alias: ["m"], type: "string", describe: "default model in provider/model format" })
      .option("agent", { type: "string", describe: "default agent to use for tool calls" })
      .option("auto", {
        type: "boolean",
        default: false,
        describe: "auto-approve permissions that are not explicitly denied",
      }),
  async handler(args) {
    parseModelRef(args.model)
    const defaultDirectory = await nativeLocalDirectory(args.dir)
    const host = createNativeLocalHost(undefined, true)
    const server = createApexoMcpServer({
      defaultDirectory,
      defaultAgent: args.agent,
      defaultModel: args.model,
      defaultAuto: args.auto,
      clientForDirectory: (directory) =>
        createApexoClient({ baseUrl: "http://apexo.local", fetch: host.fetch, directory }),
    })
    const transport = new StdioServerTransport()
    await new Promise<void>((resolve, reject) => {
      const finish = () => resolve()
      transport.onclose = finish
      if (process.stdin.readableEnded || process.stdin.destroyed) {
        finish()
        return
      }
      process.stdin.once("end", finish)
      process.stdin.once("close", finish)
      process.once("SIGINT", finish)
      process.once("SIGTERM", finish)
      server.connect(transport).catch(reject)
    }).finally(async () => {
      await server.close().catch(() => {})
      await host.close().catch(() => {})
    })
  },
})
