import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@apexo/core/agent"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { MCP } from "@apexo/core/mcp"
import { McpTools } from "@apexo/core/mcp-tools"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionMessage } from "@apexo/core/session/message"
import { SystemContext } from "@apexo/core/system-context/index"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

const app = (root: string) =>
  AppNodeBuilder.build(
    LayerNode.group([SessionV2.node, LocationServiceMap.node, LocationRuntimeGuard.node, EventV2.node]),
    [
      [
        Global.node,
        Layer.succeed(Global.Service)(
          Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
        ),
      ],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  )

const multiToolServerSource = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "math-mcp-fixture", version: "1.0.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "add",
      description: "Add two numbers and return their sum",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number", description: "first addend" },
          b: { type: "number", description: "second addend" },
        },
        required: ["a", "b"],
        additionalProperties: false,
      },
    },
    {
      name: "greet",
      description: "Build a friendly greeting for a person",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "secret_delete",
      description: "Delete a protected record",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>
  if (request.params.name === "add") {
    const sum = Number(args.a) + Number(args.b)
    return {
      structuredContent: { sum },
      content: [{ type: "text", text: String(sum) }],
    }
  }
  if (request.params.name === "greet") {
    return {
      content: [{ type: "text", text: \`Hello, \${String(args.name)}!\` }],
    }
  }
  if (request.params.name === "secret_delete") {
    return {
      content: [{ type: "text", text: \`deleted:\${String(args.id)}\` }],
    }
  }
  return {
    isError: true,
    content: [{ type: "text", text: \`Unknown tool \${request.params.name}\` }],
  }
})

await server.connect(new StdioServerTransport())
`

it.live(
  "V2 Code Mode exposes execute tool, chains MCP calls with $codemode.search, enforces permissions, and cleans up on disconnect",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const serverScript = path.join(root, "math-mcp.ts")
      yield* Effect.promise(async () => {
        await mkdir(path.join(root, "data"), { recursive: true })
        await mkdir(directory, { recursive: true })
        await Bun.write(serverScript, multiToolServerSource)
        await Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [
              { action: "*", resource: "*", effect: "allow" },
              { action: McpTools.name("math", "secret_delete"), resource: "*", effect: "deny" },
            ],
            mcp: {
              servers: {
                math: {
                  type: "local",
                  codemode: true,
                  command: [process.execPath, serverScript],
                },
              },
            },
          }),
        )
      })

      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })

        yield* Effect.gen(function* () {
          const agents = yield* AgentV2.Service
          const mcp = yield* MCP.Service
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()

          const names = registry.definitions.map((item) => item.name)
          expect(names).toContain("execute")
          expect(names).not.toContain(McpTools.name("math", "add"))
          expect(names).not.toContain(McpTools.name("math", "greet"))
          expect(names).not.toContain("search_tool")
          expect(names).not.toContain("use_tool")

          const selection = yield* agents.select("build")
          const sys = yield* SystemContext.initialize(yield* mcp.systemContext(selection))
          expect(Object.keys(sys.snapshot)).toEqual(["core/mcp-codemode"])
          expect(sys.baseline).toContain("tools.math.add")
          expect(sys.baseline).toContain("tools.math.greet")
          expect(sys.baseline).not.toContain("secret_delete")

          const runExecute = (code: string) =>
            registry.settle({
              sessionID: session.id,
              agent: AgentV2.ID.make("build"),
              assistantMessageID: SessionMessage.ID.create(),
              call: {
                type: "tool-call" as const,
                id: crypto.randomUUID(),
                name: "execute",
                input: { code },
              },
            })

          const chained = yield* runExecute(`
            const found = await tools.$codemode.search({ query: "sum" })
            const added = await tools.math.add({ a: 19, b: 23 })
            const greeting = await tools.math.greet({ name: "Apexo" })
            const mathTools = Object.keys(tools.math)
            console.log("chained-log-ok")
            return {
              foundPaths: found.items.map((item) => item.path),
              added,
              greeting,
              hasSecretDelete: mathTools.includes("secret_delete"),
            }
          `)

          expect(chained.result.type).toBe("text")
          if (chained.result.type === "text") {
            expect(chained.result.value).toContain("tools.math.add")
            expect(chained.result.value).toContain('"sum": 42')
            expect(chained.result.value).toContain("Hello, Apexo!")
            expect(chained.result.value).toContain('"hasSecretDelete": false')
            expect(chained.result.value).toContain("chained-log-ok")
          }

          yield* mcp.disconnect("math")
          const afterDisconnect = yield* tools.materialize()
          expect(afterDisconnect.definitions.map((item) => item.name)).not.toContain("execute")
          const afterGuidance = yield* SystemContext.initialize(yield* mcp.systemContext(selection))
          expect(Object.keys(afterGuidance.snapshot)).toEqual([])
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 30_000 },
)

it.live(
  "V2 deferred MCP mode exposes search_tool and use_tool, supports BM25 discovery and file payloads, and enforces permissions",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const serverScript = path.join(root, "math-mcp.ts")
      const invocationFile = path.join(directory, "greet-call.json")
      yield* Effect.promise(async () => {
        await mkdir(path.join(root, "data"), { recursive: true })
        await mkdir(directory, { recursive: true })
        await Bun.write(serverScript, multiToolServerSource)
        await Bun.write(
          invocationFile,
          JSON.stringify({
            tool_name: "math__greet",
            tool_input: { name: "FromFile" },
          }),
        )
        await Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [
              { action: "*", resource: "*", effect: "allow" },
              { action: McpTools.name("math", "secret_delete"), resource: "*", effect: "deny" },
            ],
            mcp: {
              servers: {
                math: {
                  type: "local",
                  defer_tools: true,
                  command: [process.execPath, serverScript],
                },
              },
            },
          }),
        )
      })

      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })

        yield* Effect.gen(function* () {
          const agents = yield* AgentV2.Service
          const mcp = yield* MCP.Service
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()

          const names = registry.definitions.map((item) => item.name)
          expect(names).toContain("search_tool")
          expect(names).toContain("use_tool")
          expect(names).not.toContain("execute")
          expect(names).not.toContain(McpTools.name("math", "add"))

          const selection = yield* agents.select("build")
          const sys = yield* SystemContext.initialize(yield* mcp.systemContext(selection))
          expect(Object.keys(sys.snapshot)).toEqual(["core/mcp-deferred-servers"])
          expect(sys.baseline).toContain("math")
          expect(sys.baseline).toContain("search_tool")

          const invoke = (name: string, input: unknown) =>
            registry.settle({
              sessionID: session.id,
              agent: AgentV2.ID.make("build"),
              assistantMessageID: SessionMessage.ID.create(),
              call: {
                type: "tool-call" as const,
                id: crypto.randomUUID(),
                name,
                input,
              },
            })

          const searched = yield* invoke("search_tool", { query: "add two numbers sum" })
          expect(searched.result.type).toBe("text")
          expect(typeof searched.result.value).toBe("string")
          if (searched.result.type === "text" && typeof searched.result.value === "string") {
            const parsed = JSON.parse(searched.result.value) as {
              results: Array<{ server: string; tools: Array<{ tool_name: string; input_schema: { required?: string[] } }> }>
              total_hidden_tools: number
              status: string
            }
            expect(parsed.status).toBe("ready")
            expect(parsed.total_hidden_tools).toBe(2)
            expect(parsed.results[0]?.tools[0]?.tool_name).toBe("math__add")
            expect(parsed.results[0]?.tools[0]?.input_schema.required).toEqual(["a", "b"])
            expect(searched.result.value).not.toContain("secret_delete")
          }

          const inlineCall = yield* invoke("use_tool", {
            tool_name: "math__add",
            tool_input: { a: 7, b: 8 },
          })
          expect(inlineCall.result).toMatchObject({ type: "text", value: "15" })

          const stringJsonCall = yield* invoke("use_tool", {
            tool_name: "math__greet",
            tool_input: JSON.stringify({ name: "JsonString" }),
          })
          expect(stringJsonCall.result).toMatchObject({ type: "text", value: "Hello, JsonString!" })

          const fileCall = yield* invoke("use_tool", {
            file: "greet-call.json",
          })
          expect(fileCall.result).toMatchObject({ type: "text", value: "Hello, FromFile!" })

          const deniedCall = yield* invoke("use_tool", {
            tool_name: "math__secret_delete",
            tool_input: { id: "rec-1" },
          })
          expect(deniedCall.result.type).toBe("error")

          const nativeToolHint = yield* invoke("use_tool", {
            tool_name: "read",
            tool_input: {},
          })
          expect(nativeToolHint.result.type).toBe("error")
          if (nativeToolHint.result.type === "error") {
            expect(nativeToolHint.result.value).toContain("native tool")
          }

          yield* mcp.disconnect("math")
          const afterDisconnect = yield* tools.materialize()
          const remaining = afterDisconnect.definitions.map((item) => item.name)
          expect(remaining).not.toContain("search_tool")
          expect(remaining).not.toContain("use_tool")
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 30_000 },
)
