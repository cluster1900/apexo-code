// Real local stdio MCP server for the deferred-discovery flows (search_tool / use_tool).
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "linear", version: "1.0.0" }, { capabilities: { tools: {} } })
const tools = [
  {
    name: "create_issue",
    description: "Create a new issue in Linear",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
  { name: "list_issues", description: "List issues assigned to a user", inputSchema: { type: "object", properties: {} } },
]
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "create_issue")
    return { content: [{ type: "text", text: `ISSUE_CREATED:${request.params.arguments?.title}` }] }
  return { content: [{ type: "text", text: "ISSUES:none" }] }
})
await server.connect(new StdioServerTransport())
