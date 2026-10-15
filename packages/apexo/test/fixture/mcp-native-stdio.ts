import { appendFileSync, readFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const record = (value: Record<string, unknown>) => {
  if (process.env.MCP_NATIVE_TRACE)
    appendFileSync(process.env.MCP_NATIVE_TRACE, JSON.stringify({ pid: process.pid, ...value }) + "\n")
}
record({ event: "start", cwd: process.cwd() })
if (process.env.MCP_NATIVE_MODE_FILE) {
  const mode = readFileSync(process.env.MCP_NATIVE_MODE_FILE, "utf8")
  if (mode === "fail") process.exit(1)
  if (mode === "hang") await new Promise(() => {})
}
if (process.env.MCP_NATIVE_HANG) await new Promise(() => {})
if (process.env.MCP_NATIVE_DESCENDANT) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
  record({ event: "descendant", child: child.pid })
}
const server = new Server({ name: "native-mcp-fixture", version: "1" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Native MCP echo",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, wait: { type: "boolean" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  ],
}))
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  record({ event: "call", args: request.params.arguments })
  if (request.params.arguments?.wait)
    await new Promise<void>((resolve) =>
      extra.signal.addEventListener(
        "abort",
        () => {
          record({ event: "cancel" })
          resolve()
        },
        { once: true },
      ),
    )
  return { content: [{ type: "text", text: String(request.params.arguments?.text) }] }
})
await server.connect(new StdioServerTransport())
