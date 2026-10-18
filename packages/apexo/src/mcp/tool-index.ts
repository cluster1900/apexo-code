export * as McpToolIndex from "./tool-index"

// Grok Build deferred MCP discovery (`search_tool` / `use_tool`, xai-org/grok-build
// crates/codegen/xai-grok-tools/src/implementations/{search_tool,use_tool}): MCP tools are not sent to the model up
// front; it BM25-searches them by keyword, gets their schemas grouped by server, then calls one through `use_tool`
// with a qualified `server__tool` name.

export const SEARCH_TOOL = "search_tool"
export const USE_TOOL = "use_tool"
export const MAX_DESCRIPTION = 2048
const SUFFIX = "\u2026 [truncated]"

export type Entry = {
  key: string // apexo tool key (permission + execution id)
  server: string
  name: string // tool name on the server
  description: string
  inputSchema: unknown
}

export const qualified = (entry: Pick<Entry, "server" | "name">) => `${entry.server}__${entry.name}`

export function truncateDescription(value: string) {
  if ([...value].length <= MAX_DESCRIPTION) return value
  return [...value].slice(0, MAX_DESCRIPTION - SUFFIX.length).join("") + SUFFIX
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
  const params = Object.keys((entry.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {})
  return tokens([entry.server, entry.name, entry.description, ...params].join(" "))
}

/** Okapi BM25 (k1 = 1.2, b = 0.75) over server, tool name, description and parameter names. */
export function search(entries: Entry[], query: string, limit = 5) {
  const docs = entries.map(document)
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(docs.length, 1)
  const terms = [...new Set(tokens(query))]
  const df = new Map(terms.map((term) => [term, docs.filter((doc) => doc.includes(term)).length]))
  const scored = entries.map((entry, index) => {
    const doc = docs[index]!
    let score = 0
    for (const term of terms) {
      const tf = doc.filter((token) => token === term).length
      if (!tf) continue
      const n = df.get(term) ?? 0
      const idf = Math.log(1 + (entries.length - n + 0.5) / (n + 0.5))
      score += (idf * tf * 2.2) / (tf + 1.2 * (1 - 0.75 + (0.75 * doc.length) / (avg || 1)))
    }
    return { entry, score }
  })
  return scored
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score || a.entry.key.localeCompare(b.entry.key))
    .slice(0, Math.max(1, limit))
}

/** search_tool output, grouped by server in score order (same shape as Grok Build). */
export function render(entries: Entry[], query: string, limit = 5, ready = true) {
  const results = search(entries, query, limit)
  const groups: { server: string; score: number; tools: unknown[] }[] = []
  for (const { entry, score } of results) {
    const tool = {
      tool_name: qualified(entry),
      description: truncateDescription(entry.description),
      score: Number(score.toFixed(4)),
      input_schema: entry.inputSchema,
    }
    const group = groups.find((item) => item.server === entry.server)
    if (group) group.tools.push(tool)
    else groups.push({ server: entry.server, score, tools: [tool] })
  }
  groups.sort((a, b) => b.score - a.score)
  return {
    results: groups.map((group) => ({ server: group.server, tools: group.tools })),
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

/** "Connected MCP servers:" lines Grok Build puts in front of the model so it knows what to search for. */
export function serverReminder(entries: Entry[], descriptions: Record<string, string | undefined> = {}) {
  const servers = [...new Set(entries.map((entry) => entry.server))].toSorted()
  if (!servers.length) return undefined
  return [
    "Connected MCP servers:",
    ...servers.map((server) => {
      const count = entries.filter((entry) => entry.server === server).length
      const desc = descriptions[server] ? `: ${truncateDescription(sanitizeDescription(descriptions[server]!))}` : ""
      return `- ${server} (${count} ${count === 1 ? "tool" : "tools"})${desc}`
    }),
  ].join("\n")
}

/** Resolve a `use_tool` target. Corrective errors match Grok Build's wording. */
export function resolve(entries: Entry[], toolName: string, nativeTools: ReadonlySet<string>) {
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

/** MCP arguments may arrive as a JSON string or null; normalize like Grok Build. */
export function normalizeArguments(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return {}
  if (typeof input === "string") {
    try {
      const value = JSON.parse(input)
      if (value && typeof value === "object" && !Array.isArray(value)) return value
    } catch {}
    throw new Error("tool_input must be an object")
  }
  if (typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  throw new Error("tool_input must be an object")
}

export const MAX_INPUT_FILE = 8 * 1024 * 1024

export type UseToolInput =
  | { form: "inline"; toolName: string; toolInput: unknown }
  | { form: "arguments-file"; toolName: string; path: string }
  | { form: "invocation-file"; path: string }

/** Exactly one of {tool_name,tool_input}, {tool_name,tool_input_file} or {file} (Grok Build use_tool/input.rs). */
export function parseUseToolInput(args: Record<string, unknown>): UseToolInput {
  const has = (key: string) => args[key] !== undefined
  const path = (key: string) => {
    const value = args[key]
    if (typeof value !== "string" || !value) throw new Error("MCP source path must be a nonempty string")
    return value
  }
  const name = () => {
    if (typeof args.tool_name !== "string") throw new Error("tool_name must be a string")
    return args.tool_name
  }
  const form = [has("tool_name"), has("tool_input"), has("tool_input_file"), has("file")].join()
  if (form === "true,true,false,false") return { form: "inline", toolName: name(), toolInput: args.tool_input }
  // Inline call with no arguments: Grok requires tool_input; an omitted one is treated as {} for tolerance.
  if (form === "true,false,false,false") return { form: "inline", toolName: name(), toolInput: {} }
  if (form === "true,false,true,false") return { form: "arguments-file", toolName: name(), path: path("tool_input_file") }
  if (form === "false,false,false,true") return { form: "invocation-file", path: path("file") }
  throw new Error("use exactly one of {tool_name,tool_input}, {tool_name,tool_input_file}, or {file}")
}

export function parseArgumentsFile(json: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new Error(`Invalid MCP arguments JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP arguments file must contain a JSON object")
  return value as Record<string, unknown>
}

export function parseInvocationFile(json: string): { toolName: string; toolInput: Record<string, unknown> } {
  const value = parseArgumentsFile(json)
  if (typeof value.tool_name !== "string") throw new Error("MCP invocation file needs a string tool_name")
  const input = value.tool_input ?? {}
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("MCP invocation file tool_input must be an object")
  return { toolName: value.tool_name, toolInput: input as Record<string, unknown> }
}

export type ServerSummary = { name: string; toolCount: number; toolNames: string[]; description?: string }
export type Fingerprint = Record<string, string>

export function summaries(entries: Entry[]): ServerSummary[] {
  const servers = [...new Set(entries.map((entry) => entry.server))].toSorted()
  return servers.map((name) => {
    const tools = entries.filter((entry) => entry.server === name).map((entry) => entry.name).toSorted()
    return { name, toolCount: tools.length, toolNames: tools }
  })
}

export const fingerprint = (servers: ServerSummary[]): Fingerprint =>
  Object.fromEntries(servers.map((server) => [server.name, JSON.stringify([server.toolCount, server.description ?? "", server.toolNames])]))

const line = (server: ServerSummary) =>
  `- ${server.name} (${server.toolCount} ${server.toolCount === 1 ? "tool" : "tools"})${server.description ? `: ${truncateDescription(sanitizeDescription(server.description))}` : ""}`

/** Full list, sent as its own system reminder (Grok `build_server_reminder`). */
export function fullReminder(servers: ServerSummary[]) {
  if (!servers.length) return undefined
  return ["Connected MCP servers:", ...servers.map(line)].join("\n")
}

/** Connect / update / disconnect delta (Grok `build_delta_reminder`). */
export function deltaReminder(old: Fingerprint, servers: ServerSummary[]) {
  const next = fingerprint(servers)
  const added = servers.filter((server) => !(server.name in old))
  const updated = servers.filter((server) => server.name in old && old[server.name] !== next[server.name])
  const removed = Object.keys(old).filter((name) => !(name in next)).toSorted()
  if (!added.length && !updated.length && !removed.length) return undefined
  const blocks: string[] = []
  const s = (n: number) => (n === 1 ? "" : "s")
  if (added.length) blocks.push([`MCP server${s(added.length)} connected:`, ...added.map(line)].join("\n"))
  if (updated.length) blocks.push([`MCP server${s(updated.length)} updated:`, ...updated.map(line)].join("\n"))
  if (removed.length) blocks.push(`MCP server${s(removed.length)} disconnected: ${removed.join(", ")}`)
  return blocks.join("\n\n")
}
