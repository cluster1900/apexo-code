import { expect, test } from "bun:test"
import path from "node:path"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundleRuntime } from "@apexo/core/plugin-bundle-runtime"
import { MCP } from "@apexo/core/mcp"
import { EventV2 } from "@apexo/core/event"
import { McpEvent } from "@apexo/schema/mcp-event"
import { McpStdio } from "@apexo/core/mcp-stdio"
import { McpTools } from "@apexo/core/mcp-tools"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { Tools } from "@apexo/core/tool/tools"
import { Tool } from "@apexo/core/tool/tool"
import { AgentV2 } from "@apexo/core/agent"
import { SessionV2 } from "@apexo/core/session"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const fixture = path.join(import.meta.dir, "../fixture/mcp-native-stdio.ts")
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
const trace = (file: string) =>
  Effect.promise(async () =>
    (
      await Bun.file(file)
        .text()
        .catch(() => "")
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line): { event: string; pid: number; child?: number } => JSON.parse(line)),
  )

it.live(
  "native stdio tools enforce permission/schema, cancel requests, fence reload and retire process groups",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const log = path.join(root, "trace")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            mcp: {
              servers: {
                local: {
                  type: "local",
                  command: [process.execPath, fixture],
                  environment: { MCP_NATIVE_TRACE: log, MCP_NATIVE_DESCENDANT: "1" },
                },
              },
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const runtime = yield* PluginBundleRuntime.Service
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()
          const name = McpTools.name("local", "echo")
          const call = (input: unknown, agent = "build") => ({
            sessionID: session.id,
            agent: AgentV2.ID.make(agent),
            assistantMessageID: SessionMessage.ID.create(),
            call: { type: "tool-call" as const, id: crypto.randomUUID(), name, input },
          })
          expect(yield* mcp.status).toEqual({ local: { status: "connected", tools: 1, configuredEnabled: true } })
          expect(registry.definitions.find((tool) => tool.name === name)?.inputSchema).toMatchObject({
            required: ["text"],
            additionalProperties: false,
          })
          expect((yield* registry.settle(call({ text: "hello" }))).result).toMatchObject({
            type: "text",
            value: "hello",
          })
          expect((yield* registry.settle(call({ text: 42 }))).result.type).toBe("error")
          expect((yield* registry.settle(call({ text: "denied" }, "missing"))).result.type).toBe("error")
          expect((yield* trace(log)).filter((entry) => entry.event === "call")).toHaveLength(1)
          const waiting = yield* registry.settle(call({ text: "waiting", wait: true })).pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            trace(log).pipe(
              Effect.map((entries) =>
                entries.filter((entry) => entry.event === "call").length === 2 ? true : undefined,
              ),
            ),
            "MCP request started",
          )
          expect(Exit.isFailure(yield* runtime.reload().pipe(Effect.exit))).toBe(true)
          yield* Fiber.interrupt(waiting)
          yield* pollWithTimeout(
            trace(log).pipe(
              Effect.map((entries) => (entries.some((entry) => entry.event === "cancel") ? true : undefined)),
            ),
            "MCP cancellation reached server",
          )
          const initial = (yield* trace(log)).filter((entry) => entry.event === "start" || entry.event === "descendant")
          yield* runtime.reload()
          expect((yield* registry.settle(call({ text: "stale" }))).result).toMatchObject({ type: "error" })
          const fresh = yield* tools.materialize()
          expect((yield* fresh.settle(call({ text: "fresh" }))).result).toMatchObject({ type: "text", value: "fresh" })
          for (const entry of initial) expect(() => process.kill(entry.child ?? entry.pid, 0)).toThrow()
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
      for (const entry of (yield* trace(log)).filter(
        (entry) => entry.event === "start" || entry.event === "descendant",
      ))
        yield* pollWithTimeout(
          Effect.sync(() => {
            try {
              process.kill(entry.child ?? entry.pid, 0)
              return undefined
            } catch {
              return true
            }
          }),
          "MCP process disposed",
        )
    }),
  { timeout: 30_000 },
)

it.live(
  "base server startup failures are visible without preventing native Sessions",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            mcp: {
              servers: {
                broken: { type: "local", command: [path.join(root, "missing-command")] },
                disabled: { type: "local", command: ["never-start"], disabled: true },
              },
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const status = yield* MCP.Service.use((mcp) => mcp.status).pipe(Effect.provide(locations.get(session.location)))
        expect(status.broken?.status).toBe("failed")
        expect(status.disabled).toEqual({ status: "disabled", tools: 0, configuredEnabled: false })
        expect((yield* sessions.get(session.id)).id).toBe(session.id)
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 15_000 },
)

test("stdio frame accounting retains partial-frame bytes after a complete frame", () => {
  const frames = new McpStdio.Framing(64)
  frames.append(Buffer.from('{"jsonrpc":"2.0","method":"ok"}\n' + " ".repeat(60)))
  expect(frames.readMessage()).toMatchObject({ method: "ok" })
  frames.append(Buffer.from(" ".repeat(4)))
  expect(() => frames.append(Buffer.from(" "))).toThrow("byte limit")
  frames.clear()
  frames.append(Buffer.from('{"jsonrpc":"2.0","method":"ok"}\n'))
  expect(frames.readMessage()).toMatchObject({ method: "ok" })
})

it.live("stdio shutdown waits for a forced child close", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const pidFile = path.join(root, "pid")
    const transport = McpStdio.make({
      command: [
        process.execPath,
        "-e",
        `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)`,
      ],
      cwd: root,
    })
    yield* Effect.acquireRelease(
      Effect.promise(async () => {
        await transport.start()
        return transport
      }),
      (value) => Effect.promise(() => value.close()),
    )
    const pid = yield* pollWithTimeout(
      Effect.promise(async () =>
        Bun.file(pidFile)
          .exists()
          .then(async (exists) => (exists ? Number(await Bun.file(pidFile).text()) : undefined)),
      ),
      "child started",
    )
    yield* Effect.promise(() => transport.close())
    expect(() => process.kill(pid, 0)).toThrow()
  }),
)

it.live(
  "installed MCP candidates retain working tools on failure and expose no private registrations",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const source = path.join(root, "catalog")
      const store = path.join(root, "data/plugins")
      const log = path.join(root, "trace")
      yield* Effect.promise(async () => {
        await Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
        )
        await Bun.write(
          path.join(source, ".grok-plugin/marketplace.json"),
          JSON.stringify({ name: "Test", plugins: [{ name: "example", source: "./example" }] }),
        )
        await Bun.write(path.join(source, "example/plugin.json"), JSON.stringify({ name: "example" }))
        await Bun.write(
          path.join(source, "example/.mcp.json"),
          JSON.stringify({
            mcpServers: { local: { command: process.execPath, args: [fixture], env: { MCP_NATIVE_TRACE: log } } },
          }),
        )
      })
      const catalog = yield* Effect.promise(() => PluginStore.mutate(store, { action: "add-source", source }))
      const id = catalog.items[0]!.id
      const installed = yield* Effect.promise(() => PluginStore.mutate(store, { action: "install", id, trust: true }))
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const runtime = yield* PluginBundleRuntime.Service
          const mcp = yield* MCP.Service
          const registry = yield* ToolRegistry.Service
          const tools = yield* Tools.Service
          const original = yield* registry.materialize()
          const name = McpTools.name("example:local", "echo")
          const call = {
            sessionID: session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: { type: "tool-call" as const, id: "call", name, input: { text: "retained" } },
          }
          expect(yield* runtime.status).toMatchObject({ generation: 1, active: [id] })
          expect((yield* original.settle(call)).result).toMatchObject({ type: "text", value: "retained" })
          yield* Effect.scoped(
            Effect.gen(function* () {
              const publish = yield* tools.prepare({
                staged_probe: Tool.make({
                  description: "Probe",
                  input: Schema.String,
                  output: Schema.String,
                  execute: (value) => Effect.succeed(value),
                }),
              })
              expect((yield* registry.materialize()).definitions.some((tool) => tool.name === "staged_probe")).toBe(
                false,
              )
              publish()
              expect((yield* registry.materialize()).definitions.some((tool) => tool.name === "staged_probe")).toBe(
                true,
              )
            }),
          )
          expect((yield* registry.materialize()).definitions.some((tool) => tool.name === "staged_probe")).toBe(false)
          yield* Effect.promise(() =>
            Bun.write(
              path.join(installed.items[0]!.path!, ".mcp.json"),
              JSON.stringify({ mcpServers: { local: { command: path.join(root, "missing") } } }),
            ),
          )
          expect(Exit.isFailure(yield* runtime.reload().pipe(Effect.exit))).toBe(true)
          expect(yield* runtime.status).toMatchObject({ generation: 1, active: [id], failure: { code: "load" } })
          expect(yield* mcp.status).toEqual({
            "example:local": { status: "connected", tools: 1, configuredEnabled: true },
          })
          expect((yield* original.settle(call)).result).toMatchObject({ type: "text", value: "retained" })
          const otherDirectory = path.join(root, "other")
          yield* Effect.promise(() => Bun.write(path.join(otherDirectory, "apexo.json"), "{}"))
          const other = yield* sessions.create({ location: { directory: AbsolutePath.make(otherDirectory) } })
          expect(
            yield* PluginBundleRuntime.Service.use((value) => value.status).pipe(
              Effect.provide(locations.get(other.location)),
            ),
          ).toMatchObject({ generation: 0, active: [], failure: { code: "load" } })
          const started = (yield* trace(log)).filter((entry) => entry.event === "start").length
          yield* Effect.promise(() =>
            Bun.write(
              path.join(installed.items[0]!.path!, ".mcp.json"),
              JSON.stringify({
                mcpServers: {
                  local: {
                    command: process.execPath,
                    args: [fixture],
                    env: { MCP_NATIVE_TRACE: log, MCP_NATIVE_HANG: "1" },
                  },
                },
              }),
            ),
          )
          const reloading = yield* runtime.reload().pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            trace(log).pipe(
              Effect.map((entries) =>
                entries.filter((entry) => entry.event === "start").length > started ? true : undefined,
              ),
            ),
            "candidate MCP startup",
          )
          yield* Fiber.interrupt(reloading)
          expect((yield* original.settle(call)).result).toMatchObject({ type: "text", value: "retained" })
          expect((yield* runtime.status).generation).toBe(1)
          yield* Effect.promise(() => PluginStore.mutate(store, { action: "disable", id }))
          yield* runtime.reload()
          expect(yield* mcp.status).toEqual({})
          expect((yield* registry.materialize()).definitions.some((tool) => tool.name === name)).toBe(false)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 30_000 },
)

it.live(
  "native remote HTTP and SSE tools run with headers while authentication failures stay explicit",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const connections = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
      const requests: string[] = []
      const reply = (body: { id?: string | number; method?: string }) => ({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "initialize"
            ? {
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "remote-fixture", version: "1" },
              }
            : body.method === "tools/list"
              ? { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] }
              : { content: [{ type: "text", text: "REMOTE" }] },
      })
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            async fetch(request) {
              const url = new URL(request.url)
              if (url.pathname === "/auth") return new Response("Authentication required", { status: 401 })
              if (request.headers.get("x-fixture") !== "secret") return new Response("Forbidden", { status: 403 })
              if (url.pathname === "/sse" && request.method === "POST") return new Response("Use SSE", { status: 405 })
              if (url.pathname === "/sse" && request.method === "GET") {
                const id = crypto.randomUUID()
                return new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      connections.set(id, controller)
                      controller.enqueue(new TextEncoder().encode(`event: endpoint\ndata: /messages?id=${id}\n\n`))
                    },
                    cancel() {
                      connections.delete(id)
                    },
                  }),
                  { headers: { "content-type": "text/event-stream" } },
                )
              }
              if (request.method !== "POST") return new Response(null, { status: 405 })
              const body = (await request.json()) as { id?: string | number; method?: string }
              requests.push(body.method ?? "")
              if (body.id === undefined) return new Response(null, { status: 202 })
              if (url.pathname === "/messages") {
                connections
                  .get(url.searchParams.get("id")!)
                  ?.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(reply(body))}\n\n`))
                return new Response(null, { status: 202 })
              }
              return Response.json(reply(body))
            },
          }),
        ),
        (server) =>
          Effect.promise(async () => {
            connections.forEach((controller) => controller.close())
            await server.stop(true)
          }),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            mcp: {
              servers: Object.fromEntries(
                ["http", "sse", "auth"].map((name) => [
                  name,
                  {
                    type: "remote",
                    url: `http://127.0.0.1:${server.port}/${name}`,
                    headers: { "x-fixture": "secret" },
                    timeout: { startup: 2_000, request: 2_000 },
                  },
                ]),
              ),
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const tools = yield* ToolRegistry.Service
          expect(yield* mcp.status).toMatchObject({
            http: { status: "connected", tools: 1, configuredEnabled: true },
            sse: { status: "connected", tools: 1, configuredEnabled: true },
            auth: { status: "needs_auth", tools: 0 },
          })
          const registry = yield* tools.materialize()
          for (const server of ["http", "sse"])
            expect(
              (yield* registry.settle({
                sessionID: session.id,
                agent: AgentV2.ID.make("build"),
                assistantMessageID: SessionMessage.ID.create(),
                call: { type: "tool-call", id: server, name: McpTools.name(server, "echo"), input: {} },
              })).result,
            ).toMatchObject({ type: "text", value: "REMOTE" })
          expect(requests.filter((method) => method === "tools/call")).toHaveLength(2)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 30_000 },
)

it.live("legacy MCP replacement cannot replace the native Location service", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const compatibility = yield* Effect.promise(() => import("@/mcp"))
    const legacyContext = yield* Layer.build(AppNodeBuilder.build(compatibility.MCP.node))
    const legacy = Context.get(legacyContext, compatibility.MCP.Service)
    const mixed = AppNodeBuilder.build(
      LayerNode.group([SessionV2.node, LocationServiceMap.node, compatibility.MCP.node]),
      [
        [compatibility.MCP.node, Layer.succeed(compatibility.MCP.Service)(legacy)],
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
          ),
        ],
        [SessionExecution.node, SessionExecution.noopLayer],
      ],
    )
    yield* Effect.gen(function* () {
      expect(yield* compatibility.MCP.Service).toBe(legacy)
      expect(typeof legacy.status).toBe("function")
      const sessions = yield* SessionV2.Service
      const locations = yield* LocationServiceMap.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(root) } })
      yield* Effect.gen(function* () {
        const native = yield* MCP.Service
        const bundles = yield* PluginBundleRuntime.Service
        expect(native).not.toBe(legacy)
        expect(typeof native.prepareReload).toBe("function")
        yield* bundles.reload()
        expect(yield* native.status).toEqual({})
      }).pipe(Effect.provide(locations.get(session.location)))
    }).pipe(Effect.provide(mixed))
  }),
)

it.live(
  "runtime MCP controls target one server and preserve explicit disconnect across bundle reload",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const firstLog = path.join(root, "first.jsonl")
      const secondLog = path.join(root, "second.jsonl")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            mcp: {
              servers: {
                first: {
                  type: "local",
                  command: [process.execPath, fixture],
                  disabled: true,
                  environment: { MCP_NATIVE_TRACE: firstLog },
                },
                second: {
                  type: "local",
                  command: [process.execPath, fixture],
                  environment: { MCP_NATIVE_TRACE: secondLog },
                },
                broken: { type: "local", command: [path.join(root, "missing")] },
              },
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const runtime = yield* PluginBundleRuntime.Service
          const tools = yield* ToolRegistry.Service
          const name = McpTools.name("first", "echo")
          const call = (input: unknown) => ({
            sessionID: session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: { type: "tool-call" as const, id: crypto.randomUUID(), name, input },
          })
          expect((yield* mcp.status).first?.status).toBe("disabled")
          expect((yield* mcp.status).broken?.status).toBe("failed")
          expect((yield* mcp.connect("toString").pipe(Effect.flip)).code).toBe("not_found")
          yield* mcp.connect("first")
          yield* mcp.connect("first")
          expect((yield* trace(firstLog)).filter((entry) => entry.event === "start")).toHaveLength(1)
          const captured = yield* tools.materialize()
          yield* mcp.retry("first")
          expect((yield* trace(firstLog)).filter((entry) => entry.event === "start")).toHaveLength(2)
          expect((yield* trace(secondLog)).filter((entry) => entry.event === "start")).toHaveLength(1)
          expect((yield* captured.settle(call({ text: "stale" }))).result.type).toBe("error")
          const fresh = yield* tools.materialize()
          const waiting = yield* fresh.settle(call({ text: "waiting", wait: true })).pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            trace(firstLog).pipe(
              Effect.map((entries) => (entries.some((entry) => entry.event === "call") ? true : undefined)),
            ),
            "MCP direct call admission",
          )
          expect((yield* mcp.disconnect("first").pipe(Effect.flip)).code).toBe("busy")
          yield* Fiber.interrupt(waiting)
          yield* mcp.disconnect("first")
          yield* mcp.disconnect("first")
          expect((yield* mcp.status).first).toEqual({
            status: "disabled",
            tools: 0,
            configuredEnabled: false,
            preference: false,
          })
          expect((yield* tools.materialize()).definitions.some((tool) => tool.name === name)).toBe(false)
          // A failed sibling does not prevent targeted controls; explicitly disconnect it
          // before the all-server reload, whose staged failure policy remains strict.
          yield* mcp.disconnect("broken")
          yield* runtime.reload()
          expect((yield* mcp.status).first?.status).toBe("disabled")
          yield* mcp.connect("first")
          yield* runtime.reload()
          expect((yield* mcp.status).first?.status).toBe("connected")
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 30_000 },
)

it.live(
  "failed and canceled MCP retries retain the working server generation",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const log = path.join(root, "trace.jsonl")
      const mode = path.join(root, "mode")
      yield* Effect.promise(() => Bun.write(mode, "ready"))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            mcp: {
              servers: {
                local: {
                  type: "local",
                  command: [process.execPath, fixture],
                  environment: { MCP_NATIVE_TRACE: log, MCP_NATIVE_MODE_FILE: mode },
                },
              },
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const tools = yield* ToolRegistry.Service
          const original = yield* tools.materialize()
          const call = () => ({
            sessionID: session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call" as const,
              id: crypto.randomUUID(),
              name: McpTools.name("local", "echo"),
              input: { text: "retained" },
            },
          })
          yield* Effect.promise(() => Bun.write(mode, "fail"))
          expect((yield* mcp.retry("local").pipe(Effect.flip)).code).toBe("load")
          expect((yield* mcp.status).local).toEqual({ status: "connected", tools: 1, configuredEnabled: true })
          expect((yield* original.settle(call())).result).toMatchObject({ type: "text", value: "retained" })
          const before = (yield* trace(log)).filter((entry) => entry.event === "start").length
          yield* Effect.promise(() => Bun.write(mode, "hang"))
          const retry = yield* mcp.retry("local").pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            trace(log).pipe(
              Effect.map((entries) =>
                entries.filter((entry) => entry.event === "start").length > before ? true : undefined,
              ),
            ),
            "private retry started",
          )
          yield* Fiber.interrupt(retry)
          expect((yield* mcp.status).local).toEqual({ status: "connected", tools: 1, configuredEnabled: true })
          expect((yield* original.settle(call())).result).toMatchObject({ type: "text", value: "retained" })
          yield* Effect.promise(() => Bun.write(mode, "ready"))
          yield* mcp.retry("local")
          expect((yield* original.settle(call())).result.type).toBe("error")
          expect((yield* mcp.status).local).toEqual({ status: "connected", tools: 1, configuredEnabled: true })
          const fresh = yield* tools.materialize()
          expect((yield* fresh.settle(call())).result).toMatchObject({ type: "text", value: "retained" })
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 30_000 },
)

it.live(
  "a staged MCP retry blocks its Location while another Location connects and executes",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const mode = path.join(root, "mode")
      const log = path.join(root, "first.jsonl")
      yield* Effect.promise(() => Bun.write(mode, "ready"))
      yield* Effect.forEach(["first", "second"], (name) =>
        Effect.promise(() =>
          Bun.write(
            path.join(root, name, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              mcp: {
                servers: {
                  local: {
                    type: "local",
                    command: [process.execPath, fixture],
                    disabled: name === "second",
                    ...(name === "first" ? { environment: { MCP_NATIVE_MODE_FILE: mode, MCP_NATIVE_TRACE: log } } : {}),
                  },
                },
              },
            }),
          ),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const guard = yield* LocationRuntimeGuard.Service
        const owners = yield* Effect.forEach(["first", "second"], (name) =>
          Effect.gen(function* () {
            const session = yield* sessions.create({
              location: { directory: AbsolutePath.make(path.join(root, name)) },
            })
            return yield* Effect.gen(function* () {
              const mcp = yield* MCP.Service
              const tools = yield* ToolRegistry.Service
              return { session, mcp, tools }
            }).pipe(Effect.provide(locations.get(session.location)))
          }),
        )
        yield* Effect.promise(() => Bun.write(mode, "hang"))
        const waiting = yield* owners[0]!.mcp.retry("local").pipe(Effect.forkScoped)
        yield* pollWithTimeout(
          trace(log).pipe(
            Effect.map((entries) =>
              entries.filter((entry) => entry.event === "start").length === 2 ? true : undefined,
            ),
          ),
          "first Location candidate is suspended",
        )
        expect((yield* owners[0]!.mcp.disconnect("local").pipe(Effect.flip)).code).toBe("busy")
        yield* owners[1]!.mcp.connect("local")
        yield* owners[1]!.mcp.retry("local")
        const registry = yield* owners[1]!.tools.materialize()
        expect(
          (yield* registry.settle({
            sessionID: owners[1]!.session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call",
              id: crypto.randomUUID(),
              name: McpTools.name("local", "echo"),
              input: { text: "independent" },
            },
          })).result,
        ).toMatchObject({ type: "text", value: "independent" })
        yield* Fiber.interrupt(waiting)
        expect((yield* owners[0]!.mcp.status).local).toEqual({ status: "connected", tools: 1, configuredEnabled: true })
        yield* owners[0]!.mcp.disconnect("local")
        expect((yield* owners[1]!.mcp.status).local).toEqual({
          status: "connected",
          tools: 1,
          configuredEnabled: false,
          preference: true,
        })
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 30_000 },
)

it.live(
  "stdio recovery waits for idle, preserves other Locations, and cannot resurrect replaced or disabled connections",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const log = path.join(root, "first.jsonl")
      yield* Effect.forEach(["first", "second"], (name) =>
        Effect.promise(() =>
          Bun.write(
            path.join(root, name, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              mcp: {
                servers: {
                  local: {
                    type: "local",
                    command: [process.execPath, fixture],
                    ...(name === "first" ? { environment: { MCP_NATIVE_TRACE: log } } : {}),
                  },
                },
              },
            }),
          ),
        ),
      )
      const count = trace(log).pipe(Effect.map((entries) => entries.filter((entry) => entry.event === "start").length))
      const kill = Effect.gen(function* () {
        const latest = (yield* trace(log)).filter((entry) => entry.event === "start").at(-1)!
        yield* Effect.sync(() => process.kill(latest.pid, "SIGKILL"))
      })
      const beforeShutdown = yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const guard = yield* LocationRuntimeGuard.Service
        const owners = yield* Effect.forEach(["first", "second"], (name) =>
          Effect.gen(function* () {
            const session = yield* sessions.create({
              location: { directory: AbsolutePath.make(path.join(root, name)) },
            })
            return yield* Effect.gen(function* () {
              const mcp = yield* MCP.Service
              const tools = yield* ToolRegistry.Service
              const bundles = yield* PluginBundleRuntime.Service
              return { session, mcp, tools, guard, bundles }
            }).pipe(Effect.provide(locations.get(session.location)))
          }),
        )
        const first = owners[0]!
        const second = owners[1]!
        const events = yield* EventV2.Service
        const stream = yield* EventV2.allBounded(events, 100)
        const observed: Array<{ directory?: string; data: unknown; status: string }> = []
        yield* Stream.runForEach(stream, (event) =>
          Effect.gen(function* () {
            if (event.type !== McpEvent.StatusChanged.type) return
            const owner = owners.find((owner) => owner.session.location.directory === event.location?.directory)
            expect(owner).toBeDefined()
            observed.push({
              directory: event.location?.directory,
              data: event.data,
              status: (yield* owner!.mcp.status).local!.status,
            })
          }),
        ).pipe(Effect.forkScoped)
        const input = (sessionID: typeof first.session.id, text: string) => ({
          sessionID,
          agent: AgentV2.ID.make("build"),
          assistantMessageID: SessionMessage.ID.create(),
          call: {
            type: "tool-call" as const,
            id: crypto.randomUUID(),
            name: McpTools.name("local", "echo"),
            input: { text },
          },
        })
        const original = yield* first.tools.materialize()
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const owner = yield* first.guard
          .use(
            first.session.location,
            Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
          )
          .pipe(Effect.forkScoped)
        yield* Deferred.await(entered)
        yield* kill
        yield* pollWithTimeout(
          first.mcp.status.pipe(Effect.map((status) => (status.local?.status === "failed" ? true : undefined))),
          "closed stdio visible",
        )
        expect((yield* original.settle(input(first.session.id, "dead"))).result.type).toBe("error")
        yield* Effect.sleep("1300 millis")
        expect(yield* count).toBe(1)
        yield* second.mcp.retry("local")
        const independent = yield* second.tools.materialize()
        expect((yield* independent.settle(input(second.session.id, "independent"))).result).toMatchObject({
          type: "text",
          value: "independent",
        })
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(owner)
        yield* pollWithTimeout(
          first.mcp.status.pipe(Effect.map((status) => (status.local?.status === "connected" ? true : undefined))),
          "idle recovery completed",
        )
        expect(yield* count).toBe(2)
        yield* pollWithTimeout(
          Effect.sync(() =>
            observed.some(
              (event) => event.directory === first.session.location.directory && event.status === "connected",
            )
              ? true
              : undefined,
          ),
          "recovery event permits a current status read",
        )
        expect(
          observed.some((event) => event.directory === first.session.location.directory && event.status === "failed"),
        ).toBe(true)
        expect(
          observed.some(
            (event) => event.directory === second.session.location.directory && event.status === "connected",
          ),
        ).toBe(true)
        expect(
          observed.every(
            (event) =>
              typeof event.data === "object" &&
              event.data !== null &&
              Object.keys(event.data).every((key) => key === "server"),
          ),
        ).toBe(true)
        expect((yield* original.settle(input(first.session.id, "stale"))).result.type).toBe("error")
        const recovered = yield* first.tools.materialize()
        expect((yield* recovered.settle(input(first.session.id, "recovered"))).result).toMatchObject({
          type: "text",
          value: "recovered",
        })
        yield* kill
        yield* pollWithTimeout(
          first.mcp.status.pipe(Effect.map((status) => (status.local?.status === "failed" ? true : undefined))),
          "second close visible",
        )
        yield* first.mcp.disconnect("local")
        yield* Effect.sleep("1300 millis")
        expect(yield* count).toBe(2)
        expect((yield* first.mcp.status).local).toEqual({
          status: "disabled",
          tools: 0,
          configuredEnabled: true,
          preference: false,
        })
        yield* first.mcp.connect("local")
        yield* kill
        yield* pollWithTimeout(
          first.mcp.status.pipe(Effect.map((status) => (status.local?.status === "failed" ? true : undefined))),
          "close before explicit reload",
        )
        yield* first.bundles.reload()
        const afterReload = yield* count
        yield* Effect.sleep("1300 millis")
        expect(yield* count).toBe(afterReload)
        expect((yield* first.mcp.status).local?.status).toBe("connected")
        yield* kill
        yield* pollWithTimeout(
          first.mcp.status.pipe(Effect.map((status) => (status.local?.status === "failed" ? true : undefined))),
          "close before Location disposal",
        )
        return yield* count
      }).pipe(Effect.provide(app(root)))
      yield* Effect.sleep("1300 millis")
      expect(yield* count).toBe(beforeShutdown)
    }),
  { timeout: 30_000 },
)

it.live(
  "stdio automatic recovery exhausts three attempts and explicit Retry starts a new generation",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const log = path.join(root, "trace.jsonl")
      const mode = path.join(root, "mode")
      yield* Effect.promise(() => Bun.write(mode, "ready"))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(root, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            mcp: {
              servers: {
                local: {
                  type: "local",
                  command: [process.execPath, fixture],
                  environment: { MCP_NATIVE_TRACE: log, MCP_NATIVE_MODE_FILE: mode },
                },
              },
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(root) } })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const tools = yield* ToolRegistry.Service
          const original = yield* tools.materialize()
          yield* Effect.promise(() => Bun.write(mode, "fail"))
          const pid = (yield* trace(log)).find((entry) => entry.event === "start")!.pid
          yield* Effect.sync(() => process.kill(pid, "SIGKILL"))
          yield* pollWithTimeout(
            mcp.status.pipe(
              Effect.map((status) => (status.local?.error?.includes("exhausted after 3") ? true : undefined)),
            ),
            "bounded automatic attempts exhausted",
            "30 seconds",
          )
          expect((yield* trace(log)).filter((entry) => entry.event === "start")).toHaveLength(4)
          expect((yield* mcp.status).local).toMatchObject({ status: "failed", tools: 0 })
          yield* Effect.sleep("1300 millis")
          expect((yield* trace(log)).filter((entry) => entry.event === "start")).toHaveLength(4)
          const call = {
            sessionID: session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call" as const,
              id: crypto.randomUUID(),
              name: McpTools.name("local", "echo"),
              input: { text: "manual recovery" },
            },
          }
          expect((yield* original.settle(call)).result.type).toBe("error")
          yield* Effect.promise(() => Bun.write(mode, "ready"))
          yield* mcp.retry("local")
          expect((yield* mcp.status).local).toEqual({ status: "connected", tools: 1, configuredEnabled: true })
          const fresh = yield* tools.materialize()
          expect((yield* fresh.settle(call)).result).toMatchObject({ type: "text", value: "manual recovery" })
          yield* Effect.promise(() => Bun.write(mode, "fail"))
          const latest = (yield* trace(log)).filter((entry) => entry.event === "start").at(-1)!.pid
          yield* Effect.sync(() => process.kill(latest, "SIGKILL"))
          yield* pollWithTimeout(
            mcp.status.pipe(Effect.map((status) => (status.local?.status === "failed" ? true : undefined))),
            "close before failed manual retry",
          )
          expect((yield* mcp.retry("local").pipe(Effect.flip)).code).toBe("load")
          const afterManualFailure = (yield* trace(log)).filter((entry) => entry.event === "start").length
          yield* Effect.sleep("1300 millis")
          expect((yield* trace(log)).filter((entry) => entry.event === "start")).toHaveLength(afterManualFailure)
          expect((yield* mcp.status).local).toMatchObject({ status: "failed", tools: 0 })
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 45_000 },
)
