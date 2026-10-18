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
export function render(entries: Entry[], query: string, limit = 5) {
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
    status: "ready" as const,
    note:
      entries.length === 0
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
