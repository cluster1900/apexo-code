import { describe, expect, test } from "bun:test"
import { McpToolIndex } from "../../src/mcp/tool-index"

const entry = (server: string, name: string, description: string, properties: Record<string, unknown> = {}) => ({
  key: `${server}_${name}`,
  server,
  name,
  description,
  inputSchema: { type: "object", properties },
})

const entries = [
  entry("linear", "create_issue", "Create a new issue in Linear", { title: {}, teamId: {} }),
  entry("linear", "list_issues", "List issues assigned to a user"),
  entry("slack", "read_thread", "Read the history of a Slack thread", { channel: {} }),
  entry("github", "create_pull_request", "Open a pull request"),
]

describe("McpToolIndex", () => {
  test("BM25 ranks server + action queries first and respects the limit", () => {
    const results = McpToolIndex.search(entries, "linear create issue", 5)
    expect(results[0]!.entry.key).toBe("linear_create_issue")
    expect(McpToolIndex.search(entries, "issue", 1)).toHaveLength(1)
    expect(McpToolIndex.search(entries, "slack thread history")[0]!.entry.key).toBe("slack_read_thread")
    expect(McpToolIndex.search(entries, "teamId")[0]!.entry.key).toBe("linear_create_issue")
    expect(McpToolIndex.search(entries, "nothing-matches")).toEqual([])
  })
  test("renders Grok's grouped shape", () => {
    const out = McpToolIndex.render(entries, "create", 5)
    expect(out.results.map((group) => group.server).toSorted()).toEqual(["github", "linear"])
    expect(out.total_hidden_tools).toBe(4)
    expect(out.status).toBe("ready")
    expect(McpToolIndex.render([], "x").note).toContain("No MCP tools are available")
  })
  test("server reminder, truncation, argument normalization and resolve errors", () => {
    expect(McpToolIndex.serverReminder(entries, { slack: "Team\\n chat" })).toBe(
      "Connected MCP servers:\n- github (1 tool)\n- linear (2 tools)\n- slack (1 tool): Team\\n chat",
    )
    expect(McpToolIndex.truncateDescription("x".repeat(3000))).toEndWith("\u2026 [truncated]")
    expect(McpToolIndex.normalizeArguments('{"a":1}')).toEqual({ a: 1 })
    expect(McpToolIndex.normalizeArguments(null)).toEqual({})
    expect(() => McpToolIndex.normalizeArguments("[1]")).toThrow()
    expect(McpToolIndex.resolve(entries, "slack__read_thread", new Set()).key).toBe("slack_read_thread")
    expect(() => McpToolIndex.resolve(entries, "bash", new Set(["bash"]))).toThrow("is a native tool")
    expect(() => McpToolIndex.resolve(entries, "read_thread", new Set())).toThrow("server__tool")
  })
})

describe("McpToolIndex use_tool forms and reminders", () => {
  test("accepts exactly one of the three Grok input forms", () => {
    expect(McpToolIndex.parseUseToolInput({ tool_name: "a__b", tool_input: { x: 1 } })).toEqual({
      form: "inline",
      toolName: "a__b",
      toolInput: { x: 1 },
    })
    expect(McpToolIndex.parseUseToolInput({ tool_name: "a__b", tool_input_file: "args.json" })).toEqual({
      form: "arguments-file",
      toolName: "a__b",
      path: "args.json",
    })
    expect(McpToolIndex.parseUseToolInput({ file: "call.json" })).toEqual({ form: "invocation-file", path: "call.json" })
    expect(() => McpToolIndex.parseUseToolInput({ tool_name: "a__b", tool_input: {}, file: "x" })).toThrow("exactly one")
    expect(() => McpToolIndex.parseUseToolInput({ file: "" })).toThrow("nonempty")
    expect(McpToolIndex.parseInvocationFile('{"tool_name":"a__b","tool_input":{"q":1}}')).toEqual({
      toolName: "a__b",
      toolInput: { q: 1 },
    })
    expect(() => McpToolIndex.parseArgumentsFile("[]")).toThrow("JSON object")
  })
  test("full and delta server reminders", () => {
    const before = McpToolIndex.summaries(entries)
    expect(McpToolIndex.fullReminder(before)).toBe(
      "Connected MCP servers:\n- github (1 tool)\n- linear (2 tools)\n- slack (1 tool)",
    )
    const old = McpToolIndex.fingerprint(before)
    expect(McpToolIndex.deltaReminder(old, before)).toBeUndefined()
    const after = McpToolIndex.summaries([
      ...entries.filter((item) => item.server !== "github" && item.key !== "linear_list_issues"),
      entry("notion", "search", "Search pages"),
    ])
    expect(McpToolIndex.deltaReminder(old, after)).toBe(
      "MCP server connected:\n- notion (1 tool)\n\nMCP server updated:\n- linear (1 tool)\n\nMCP server disconnected: github",
    )
    expect(McpToolIndex.render(entries, "issue", 5, false)).toMatchObject({ status: "partial" })
  })
})
