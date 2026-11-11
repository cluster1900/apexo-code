import path from "path"
import fs from "fs/promises"
import { Option, Schema } from "effect"
import type { Hooks, PluginInput } from "@apexo/plugin"
import type { Model as ModelV2 } from "@apexo/sdk/v2"
import { PartID } from "@/session/schema"
import { isRecord } from "@/util/record"
import {
  LOCAL_QWEN_MODEL_ID,
  LOCAL_QWEN_PROVIDER_ID,
  completeLocalQwen,
  ensureLocalQwenEndpoint,
  extractJsonPayload,
  formatProgressBar,
  isLocalQwenModelDownloaded,
  readLocalQwenState,
  resolvePaths,
  runLocalQwenCommand,
  type LocalQwenOptions,
} from "@apexo/core/local-qwen"

export interface LocalQwenPluginOptions extends LocalQwenOptions {
  promptLookup?: (sessionID: string, messageID: string) => string | undefined
}

const DEFAULT_LOG_COMPRESS_THRESHOLD = 4_000
const DANGEROUS_SHELL_PATTERN =
  /(?:^|[;&|]\s*)(?:rm|sudo|mv|cp|dd|mkfs|chmod|chown|kill|pkill|reboot|shutdown|curl\s+.*-X\s*(?:POST|PUT|DELETE|PATCH)|git\s+(?:push|reset|clean|checkout\s+--|branch\s+-[dD]))\b|[>`$()]/i

const LOG_COMPRESS_TOOLS = new Set(["bash", "run_shell_command"])

const STRING_ONLY_TOOLS = new Set([
  "write",
  "apply_patch",
  "bash",
  "run_shell_command",
  "read",
  "read_file",
  "grep",
  "glob",
  "list_directory",
  "webfetch",
  "web_fetch",
  "websearch",
  "web_search",
  "code_mode",
  "skill",
])

const STRING_ONLY_ARG_KEYS = new Set([
  "content",
  "oldString",
  "newString",
  "old_str",
  "new_str",
  "patchText",
  "patch",
  "command",
  "code",
  "prompt",
  "message",
  "pattern",
  "query",
  "text",
  "description",
  "title",
  "filePath",
  "file_path",
  "path",
  "url",
  "workdir",
  "cwd",
])

const TriageSchema = Schema.fromJsonString(
  Schema.Struct({
    complexity: Schema.Literals(["low", "medium", "high"]),
    intent: Schema.Literals(["query", "edit", "debug", "architecture"]),
  }),
)

const RiskSchema = Schema.fromJsonString(
  Schema.Struct({
    risk: Schema.Literals(["safe_readonly", "caution", "destructive"]),
    reason: Schema.String,
  }),
)

function buildLocalSmallModel(endpoint: string): ModelV2 {
  const base = endpoint.endsWith("/v1") ? endpoint : `${endpoint.replace(/\/+$/, "")}/v1`
  return {
    id: LOCAL_QWEN_MODEL_ID,
    providerID: LOCAL_QWEN_PROVIDER_ID,
    name: "Qwen 0.8B Local (Edge Accelerator)",
    family: "qwen",
    release_date: "2026-04-01",
    status: "active",
    api: {
      id: LOCAL_QWEN_MODEL_ID,
      url: base,
      npm: "@ai-sdk/openai-compatible",
    },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: 32_768,
      output: 2_048,
    },
    options: {
      baseURL: base,
      apiKey: "local-qwen",
    },
    headers: {},
    variants: {},
  }
}

function rewriteToLiveEndpoint(rawUrl: string, liveEndpoint: string): string {
  const liveBase = liveEndpoint.endsWith("/v1") ? liveEndpoint : `${liveEndpoint.replace(/\/+$/, "")}/v1`
  const v1Index = rawUrl.indexOf("/v1/")
  if (v1Index !== -1) {
    return `${liveBase}${rawUrl.slice(v1Index + 3)}`
  }
  return rawUrl.replace(/^https?:\/\/[^/]+(?:\/v1)?/i, liveBase)
}

export function createDynamicLocalQwenFetch(options?: LocalQwenPluginOptions): typeof fetch {
  return (async (reqInput: RequestInfo | URL, init?: RequestInit) => {
    const transport = options?.fetch ?? fetch
    const liveEndpoint = await ensureLocalQwenEndpoint(options)
    if (!liveEndpoint) return transport(reqInput, init)
    if (typeof reqInput === "string") {
      return transport(rewriteToLiveEndpoint(reqInput, liveEndpoint), init)
    }
    if (reqInput instanceof URL) {
      return transport(new URL(rewriteToLiveEndpoint(reqInput.toString(), liveEndpoint)), init)
    }
    const rewritten = rewriteToLiveEndpoint(reqInput.url, liveEndpoint)
    return transport(new Request(rewritten, reqInput), init)
  }) as typeof fetch
}

async function healArgsObject(
  args: Record<string, unknown>,
  options?: LocalQwenPluginOptions,
): Promise<void> {
  await Promise.all(
    Object.keys(args).map(async (key) => {
      if (STRING_ONLY_ARG_KEYS.has(key)) return
      const value = args[key]
      if (typeof value !== "string") return
      const trimmed = value.trim()
      if (
        !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
        !(trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        return
      }
      const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(trimmed)
      if (Option.isSome(parsed)) {
        if (typeof parsed.value === "object" && parsed.value !== null) {
          args[key] = parsed.value
        }
        return
      }
      const repaired = await completeLocalQwen(
        {
          system:
            "You are a JSON syntax repair utility. Fix the malformed JSON input and output ONLY valid JSON without markdown fences.",
          prompt: trimmed,
          maxTokens: 256,
          jsonMode: true,
        },
        options,
      )
      if (!repaired) return
      const stripped = extractJsonPayload(repaired)
      const decoded = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(stripped)
      if (Option.isSome(decoded)) {
        args[key] = decoded.value
      }
    }),
  )
}

function isStrictlyReadonlyCandidate(patterns: string[]): boolean {
  if (patterns.length === 0) return false
  return patterns.every((item) => item.trim().length > 0 && !DANGEROUS_SHELL_PATTERN.test(item))
}

function notifyToast(
  input: PluginInput,
  toast: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number },
) {
  const showToast = input.client?.tui?.showToast
  if (typeof showToast !== "function") return
  void showToast({ body: toast }).catch(() => {})
}

async function executeInlineCommand(
  rawArgs: string,
  input: PluginInput,
  options?: LocalQwenPluginOptions,
): Promise<string> {
  const report = await runLocalQwenCommand(rawArgs, {
    ...options,
    onProgress: (progress) => {
      options?.onProgress?.(progress)
      notifyToast(input, {
        title: "Downloading Local Qwen 0.8B",
        message: formatProgressBar(progress),
        variant: "info",
        duration: 2_500,
      })
    },
  })
  notifyToast(input, {
    title: "Local Qwen 0.8B",
    message: report.split("\n").slice(0, 3).join(" · ").replace(/[#*`]/g, ""),
    variant: "success",
    duration: 4_000,
  })
  return report
}

export async function LocalQwenPlugin(
  input: PluginInput,
  options?: LocalQwenPluginOptions,
): Promise<Hooks> {
  const promptTexts = new Map<string, string>()
  const threshold = options?.logCompressThreshold ?? DEFAULT_LOG_COMPRESS_THRESHOLD

  return {
    config: async (config) => {
      const state = await readLocalQwenState(options)
      const downloaded = await isLocalQwenModelDownloaded(options)
      if (!state.enabled && !downloaded && state.installedAt === undefined) return
      const endpoint = state.enabled ? await ensureLocalQwenEndpoint(options) : state.endpoint
      if (state.enabled && !endpoint) return

      const base = endpoint
        ? endpoint.endsWith("/v1")
          ? endpoint
          : `${endpoint.replace(/\/+$/, "")}/v1`
        : "http://127.0.0.1:11434/v1"
      config.provider ??= {}
      config.provider[LOCAL_QWEN_PROVIDER_ID] = {
        name: "Local Qwen (Edge Accelerator)",
        npm: "@ai-sdk/openai-compatible",
        api: base,
        options: {
          apiKey: "local-qwen",
          baseURL: base,
          fetch: createDynamicLocalQwenFetch(options),
        },
        ...config.provider[LOCAL_QWEN_PROVIDER_ID],
        models: {
          [LOCAL_QWEN_MODEL_ID]: {
            name: "Qwen 0.8B Local (Edge Accelerator)",
            tool_call: true,
            reasoning: false,
            temperature: true,
            limit: { context: 32_768, output: 2_048 },
          },
          ...config.provider[LOCAL_QWEN_PROVIDER_ID]?.models,
        },
      }
    },

    "command.execute.before": async (commandInput, output) => {
      if (commandInput.command !== "local-qwen") return
      const report = await executeInlineCommand(commandInput.arguments, input, options)
      output.parts.push({
        id: PartID.ascending(),
        sessionID: commandInput.sessionID,
        messageID: "",
        type: "text",
        text: report,
        synthetic: true,
      })
    },

    "chat.message": async (chatInput, output) => {
      const text = output.parts
        .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
        .join("\n")
        .trim()
      if (text.length > 0 && chatInput.messageID) {
        promptTexts.set(chatInput.messageID, text)
      }
      if (/^\/local-qwen(?:\s+|$)/i.test(text)) {
        const rawArgs = text.replace(/^\/local-qwen\s*/i, "")
        const report = await executeInlineCommand(rawArgs, input, options)
        output.parts.push({
          id: PartID.ascending(),
          sessionID: chatInput.sessionID,
          messageID: chatInput.messageID ?? output.message.id,
          type: "text",
          text: report,
          synthetic: true,
        })
      }
    },

    "experimental.provider.small_model": async (_providerInput, output) => {
      const state = await readLocalQwenState(options)
      if (!state.enabled || state.features?.smallModel === false) return
      const endpoint = await ensureLocalQwenEndpoint(options)
      if (!endpoint) return
      output.model = buildLocalSmallModel(endpoint)
    },

    "tool.execute.before": async (toolInput, output) => {
      if (STRING_ONLY_TOOLS.has(toolInput.tool)) return
      const state = await readLocalQwenState(options)
      if (!state.enabled || state.features?.schemaHeal === false) return
      if (!isRecord(output.args)) return
      await healArgsObject(output.args, options)
    },

    "tool.execute.after": async (toolInput, output) => {
      // Only shell output is noise worth summarizing; file reads and search results must reach the agent verbatim.
      if (!LOG_COMPRESS_TOOLS.has(toolInput.tool)) return
      const state = await readLocalQwenState(options)
      if (!state.enabled || state.features?.logCompress === false) return
      if (typeof output.output !== "string" || output.output.length <= threshold) return

      const original = output.output
      const paths = resolvePaths(options)
      await fs.mkdir(paths.tmpDir, { recursive: true })
      const safeCallId = toolInput.callID.replace(/[^a-zA-Z0-9_-]/g, "_")
      const logPath = path.join(paths.tmpDir, `${safeCallId}.log`)
      await fs.writeFile(logPath, original, "utf8")

      const head = original.slice(0, 1_500)
      const tail = original.slice(-2_000)
      const summary = await completeLocalQwen(
        {
          system:
            "You are a concise CLI log compressor for a coding agent. Extract ONLY failing test names, error messages, file:line stack frames, and the final exit status in under 20 lines. Omit passing tests and progress bars.",
          prompt: `Tool: ${toolInput.tool}\n--- HEAD ---\n${head}\n--- TAIL ---\n${tail}`,
          maxTokens: 256,
        },
        options,
      )
      if (!summary) return

      output.output = [
        summary,
        "",
        `[Local Qwen 0.8B compressed ${original.length} chars -> ${summary.length} chars. Full raw output saved to: ${logPath}]`,
      ].join("\n")
      const currentMeta = isRecord(output.metadata) ? output.metadata : {}
      output.metadata = {
        ...currentMeta,
        localQwenCompressed: true,
        fullOutputPath: logPath,
        originalLength: original.length,
      }
    },

    "chat.params": async (paramsInput, output) => {
      const state = await readLocalQwenState(options)
      if (!state.enabled || state.features?.effortTriage === false) return

      const messageID = paramsInput.message.id
      const promptText =
        options?.promptLookup?.(paramsInput.sessionID, messageID) ??
        promptTexts.get(messageID) ??
        paramsInput.message.system ??
        ""
      if (!promptText) return

      const raw = await completeLocalQwen(
        {
          system:
            'Classify the coding prompt complexity and intent. Respond ONLY with JSON: {"complexity":"low"|"medium"|"high","intent":"query"|"edit"|"debug"|"architecture"}',
          prompt: promptText.slice(0, 1_000),
          maxTokens: 64,
          jsonMode: true,
        },
        options,
      )
      if (!raw) return
      const stripped = extractJsonPayload(raw)
      const decoded = Schema.decodeUnknownOption(TriageSchema)(stripped)
      if (Option.isNone(decoded)) return

      output.options["localQwenTriage"] = decoded.value
    },

    "permission.ask": async (permissionInput, output) => {
      const state = await readLocalQwenState(options)
      if (!state.enabled || state.features?.permissionAssist === false) return

      const patternText = Array.isArray(permissionInput.pattern)
        ? permissionInput.pattern.join(" && ")
        : typeof permissionInput.pattern === "string"
          ? permissionInput.pattern
          : permissionInput.title

      const raw = await completeLocalQwen(
        {
          system:
            'Assess the safety risk of this tool permission request. Respond ONLY with JSON: {"risk":"safe_readonly"|"caution"|"destructive","reason":"short one-sentence explanation"}',
          prompt: `Type: ${permissionInput.type}\nTitle: ${permissionInput.title}\nPattern: ${patternText}`,
          maxTokens: 96,
          jsonMode: true,
        },
        options,
      )
      if (!raw) return
      const stripped = extractJsonPayload(raw)
      const decoded = Schema.decodeUnknownOption(RiskSchema)(stripped)
      if (Option.isNone(decoded)) return

      permissionInput.metadata["localQwenRisk"] = decoded.value
      const patterns = Array.isArray(permissionInput.pattern)
        ? permissionInput.pattern
        : typeof permissionInput.pattern === "string"
          ? [permissionInput.pattern]
          : []
      if (
        state.features?.autoAllowReadonly &&
        decoded.value.risk === "safe_readonly" &&
        isStrictlyReadonlyCandidate(patterns)
      ) {
        output.status = "allow"
      }
    },
  }
}
