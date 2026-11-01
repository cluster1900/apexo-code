export * as McpToolIndex from "./mcp-tool-index"

import { Option, Schema } from "effect"

export const SEARCH_TOOL = "search_tool"
export const USE_TOOL = "use_tool"
export const MAX_DESCRIPTION = 2048
export const MAX_INPUT_FILE = 8 * 1024 * 1024

const SUFFIX = "\u2026 [truncated]"
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))

export interface Entry {
  readonly key: string
  readonly server: string
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}

export interface ServerSummary {
  readonly name: string
  readonly toolCount: number
  readonly toolNames: string[]
  readonly description?: string
}

export type Fingerprint = Record<string, string>

export const qualified = (entry: Pick<Entry, "server" | "name">) => `${entry.server}__${entry.name}`

export function truncateDescription(value: string) {
  const chars = [...value]
  if (chars.length <= MAX_DESCRIPTION) return value
  return chars.slice(0, MAX_DESCRIPTION - SUFFIX.length).join("") + SUFFIX
}

export const sanitizeDescription = (value: string) => value.split(/\s+/).filter(Boolean).join(" ")

export function tokens(text: string) {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

function document(entry: Entry) {
  const schema = Option.getOrUndefined(decodeRecord(entry.inputSchema))
  const properties = schema ? Option.getOrUndefined(decodeRecord(schema.properties)) : undefined
  return tokens([entry.server, entry.name, entry.description, ...Object.keys(properties ?? {})].join(" "))
}

/** Okapi BM25 (k1 = 1.2, b = 0.75) over server, tool name, description, and parameter names. */
export function search<T extends Entry>(entries: readonly T[], query: string, limit = 5) {
  const docs = entries.map(document)
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(docs.length, 1)
  const terms = [...new Set(tokens(query))]
  const df = new Map(terms.map((term) => [term, docs.filter((doc) => doc.includes(term)).length]))
  return entries
    .map((entry, index) => {
      const doc = docs[index]!
      const score = terms.reduce((sum, term) => {
        const tf = doc.filter((token) => token === term).length
        if (!tf) return sum
        const n = df.get(term) ?? 0
        const idf = Math.log(1 + (entries.length - n + 0.5) / (n + 0.5))
        return sum + (idf * tf * 2.2) / (tf + 1.2 * (1 - 0.75 + (0.75 * doc.length) / (avg || 1)))
      }, 0)
      return { entry, score }
    })
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
    .slice(0, Math.max(1, limit))
}

export function render(entries: readonly Entry[], query: string, limit = 5, ready = true) {
  const results = search(entries, query, limit)
  const groups = results.reduce<Array<{ server: string; score: number; tools: Array<Record<string, unknown>> }>>(
    (acc, item) => {
      const tool = {
        tool_name: qualified(item.entry),
        description: truncateDescription(item.entry.description),
        score: Number(item.score.toFixed(4)),
        input_schema: item.entry.inputSchema,
      }
      const existing = acc.find((group) => group.server === item.entry.server)
      if (existing) {
        existing.tools.push(tool)
        return acc
      }
      acc.push({ server: item.entry.server, score: item.score, tools: [tool] })
      return acc
    },
    [],
  )
  return {
    results: groups.toSorted((a, b) => b.score - a.score).map((group) => ({ server: group.server, tools: group.tools })),
    total_hidden_tools: entries.length,
    status: ready ? ("ready" as const) : ("partial" as const),
    note: !ready
      ? "Some MCP servers are still connecting. Results may be incomplete."
      : entries.length === 0
        ? "No MCP tools are available in this session. Connect MCP servers here, or if this is a subagent, check the agent's mcpInheritance."
        : null,
    count: results.length,
  }
}

const serverLine = (server: ServerSummary) =>
  `- ${server.name} (${server.toolCount} ${server.toolCount === 1 ? "tool" : "tools"})${server.description ? `: ${truncateDescription(sanitizeDescription(server.description))}` : ""}`

export function summaries(
  entries: readonly Entry[],
  descriptions: Readonly<Record<string, string | undefined>> = {},
): ServerSummary[] {
  return [...new Set(entries.map((entry) => entry.server))].toSorted().map((name) => {
    const toolNames = entries
      .filter((entry) => entry.server === name)
      .map((entry) => entry.name)
      .toSorted()
    return {
      name,
      toolCount: toolNames.length,
      toolNames,
      ...(descriptions[name] ? { description: descriptions[name] } : {}),
    }
  })
}

export const fingerprint = (servers: readonly ServerSummary[]): Fingerprint =>
  Object.fromEntries(
    servers.map((server) => [server.name, JSON.stringify([server.toolCount, server.description ?? "", server.toolNames])]),
  )

export function fullReminder(servers: readonly ServerSummary[]) {
  if (!servers.length) return undefined
  return ["Connected MCP servers:", ...servers.map(serverLine)].join("\n")
}

export function serverReminder(
  entries: readonly Entry[],
  descriptions: Readonly<Record<string, string | undefined>> = {},
) {
  return fullReminder(summaries(entries, descriptions))
}

export function deltaReminder(old: Fingerprint, servers: readonly ServerSummary[]) {
  const next = fingerprint(servers)
  const added = servers.filter((server) => !(server.name in old))
  const updated = servers.filter((server) => server.name in old && old[server.name] !== next[server.name])
  const removed = Object.keys(old)
    .filter((name) => !(name in next))
    .toSorted()
  if (!added.length && !updated.length && !removed.length) return undefined
  const plural = (count: number) => (count === 1 ? "" : "s")
  return [
    added.length ? [`MCP server${plural(added.length)} connected:`, ...added.map(serverLine)].join("\n") : undefined,
    updated.length ? [`MCP server${plural(updated.length)} updated:`, ...updated.map(serverLine)].join("\n") : undefined,
    removed.length ? `MCP server${plural(removed.length)} disconnected: ${removed.join(", ")}` : undefined,
  ]
    .filter((block): block is string => Boolean(block))
    .join("\n\n")
}

export function resolve<T extends Entry>(entries: readonly T[], toolName: string, nativeTools: ReadonlySet<string>): T {
  const hit = entries.find((entry) => qualified(entry) === toolName || entry.key === toolName)
  if (hit) return hit
  if (!toolName.includes("__")) {
    if (nativeTools.has(toolName))
      throw new Error(
        `\`${toolName}\` is a native tool, not an MCP integration tool. Call \`${toolName}\` directly as its own tool call instead of routing it through \`use_tool\`.`,
      )
    throw new Error(
      `'${toolName}' is not a valid MCP tool name. Tool names must be qualified as \`server__tool\` (e.g., \`linear__save_issue\`). Use \`${SEARCH_TOOL}\` to discover available tools.`,
    )
  }
  throw new Error(`Unknown or denied MCP tool '${toolName}'. Use \`${SEARCH_TOOL}\` to discover available tools.`)
}

export function normalizeArguments(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return {}
  if (typeof input === "string") {
    const parsed = Option.flatMap(decodeJson(input), decodeRecord)
    if (Option.isSome(parsed) && !Array.isArray(parsed.value)) return { ...parsed.value }
    throw new Error("tool_input must be an object")
  }
  const record = decodeRecord(input)
  if (Option.isSome(record) && !Array.isArray(input)) return { ...record.value }
  throw new Error("tool_input must be an object")
}

export type UseToolInput =
  | { readonly form: "inline"; readonly toolName: string; readonly toolInput: unknown }
  | { readonly form: "arguments-file"; readonly toolName: string; readonly path: string }
  | { readonly form: "invocation-file"; readonly path: string }

export function parseUseToolInput(args: Readonly<Record<string, unknown>>): UseToolInput {
  const has = (key: string) => args[key] !== undefined
  const readPath = (key: string) => {
    const value = args[key]
    if (typeof value !== "string" || !value) throw new Error("MCP source path must be a nonempty string")
    return value
  }
  const readName = () => {
    if (typeof args.tool_name !== "string" || !args.tool_name) throw new Error("tool_name must be a nonempty string")
    return args.tool_name
  }
  const form = [has("tool_name"), has("tool_input"), has("tool_input_file"), has("file")].join()
  if (form === "true,true,false,false") return { form: "inline", toolName: readName(), toolInput: args.tool_input }
  if (form === "true,false,false,false") return { form: "inline", toolName: readName(), toolInput: {} }
  if (form === "true,false,true,false")
    return { form: "arguments-file", toolName: readName(), path: readPath("tool_input_file") }
  if (form === "false,false,false,true") return { form: "invocation-file", path: readPath("file") }
  throw new Error("use exactly one of {tool_name,tool_input}, {tool_name,tool_input_file}, or {file}")
}

export function parseArgumentsFile(json: string): Record<string, unknown> {
  const parsed = decodeJson(json)
  if (Option.isNone(parsed)) throw new Error("Invalid MCP arguments JSON")
  const record = decodeRecord(parsed.value)
  if (Option.isNone(record) || Array.isArray(parsed.value))
    throw new Error("MCP arguments file must contain a JSON object")
  return { ...record.value }
}

export function parseInvocationFile(json: string): { toolName: string; toolInput: Record<string, unknown> } {
  const value = parseArgumentsFile(json)
  if (typeof value.tool_name !== "string" || !value.tool_name)
    throw new Error("MCP invocation file needs a string tool_name")
  if (value.tool_input === undefined || value.tool_input === null) return { toolName: value.tool_name, toolInput: {} }
  const input = decodeRecord(value.tool_input)
  if (Option.isNone(input) || Array.isArray(value.tool_input))
    throw new Error("MCP invocation file tool_input must be an object")
  return { toolName: value.tool_name, toolInput: { ...input.value } }
}
