import { appendFileSync, existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

if (process.env.MCP_LIFECYCLE_START_LOG) {
  appendFileSync(process.env.MCP_LIFECYCLE_START_LOG, `${process.pid}\n`)
}

if (process.argv.includes("--plugin-data-check")) {
  const data = process.env.TEST_PLUGIN_DATA
  const marker = process.env.TEST_PLUGIN_MARKER
  if (!data || !path.isAbsolute(data) || !marker) throw new Error("Expected an absolute plugin data directory")
  const file = path.join(data, "state")
  writeFileSync(file, "connected")
  writeFileSync(marker, file)
  process.stdin.once("end", () => writeFileSync(marker + ".closed", String(existsSync(file))))
}

const server = new Server({ name: "mcp-lifecycle-stdio", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, () =>
  Promise.resolve({
    tools: [
      {
        name: "current_directory",
        description: process.cwd(),
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
