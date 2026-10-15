import { appendFileSync, readFileSync, existsSync } from "node:fs"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const file = process.env.MCP_CATALOG_FILE!
const record = (value: Record<string, unknown>) => {
  if (process.env.MCP_CATALOG_TRACE)
    appendFileSync(
      process.env.MCP_CATALOG_TRACE,
      JSON.stringify({ pid: process.pid, time: Date.now(), ...value }) + "\n",
    )
}
type Catalog = {
  exitOnStart?: boolean
  revision: number
  tools: {
    name: string
    description?: string
    inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] }
  }[]
  fail?: boolean
  wait?: string
  burst?: number
}
const read = (): Catalog => JSON.parse(readFileSync(file, "utf8"))
const current = { value: read() }
const server = new Server(
  { name: "native-catalog-fixture", version: "1" },
  { capabilities: { tools: { listChanged: true } } },
)
record({ event: "start" })
if (current.value.exitOnStart) process.exit(1)
server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
  const value = current.value
  record({ event: "list", revision: value.revision })
  if (value.wait) {
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (existsSync(value.wait!)) {
          clearInterval(timer)
          resolve()
        }
      }, 10)
      extra.signal.addEventListener(
        "abort",
        () => {
          clearInterval(timer)
          record({ event: "cancel", revision: value.revision })
          resolve()
        },
        { once: true },
      )
    })
  }
  if (value.fail) throw new Error("Fixture catalog unavailable")
  return { tools: value.tools }
})
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  record({ event: "call", name: request.params.name, args: request.params.arguments })
  return {
    content: [{ type: "text", text: JSON.stringify({ name: request.params.name, args: request.params.arguments }) }],
  }
})
await server.connect(new StdioServerTransport())
const timer = setInterval(async () => {
  const value = read()
  if (value.revision === current.value.revision) return
  current.value = value
  for (let index = 0; index < (value.burst ?? 1); index++) await server.sendToolListChanged()
  record({ event: "notify", revision: value.revision })
}, 20)
server.onclose = () => clearInterval(timer)
