import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { MCP } from "@apexo/core/mcp"
import { McpResources } from "@apexo/core/mcp-resources"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionMessage } from "@apexo/core/session/message"
import { AgentV2 } from "@apexo/core/agent"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { AbsolutePath } from "@apexo/schema/schema"
const fixture = path.join(import.meta.dir, "../fixture/mcp-resources-native-stdio.ts")
const trace = async (file: string) =>
  (
    await Bun.file(file)
      .text()
      .catch(() => "")
  )
    .split("\n")
    .filter(Boolean)
    .map((line): { event: string; pid: number; params?: { uri?: string } } => JSON.parse(line))
const poll = (check: Effect.Effect<boolean>, label: string) =>
  Effect.gen(function* () {
    const end = Date.now() + 10000
    while (Date.now() < end) {
      if (yield* check) return
      yield* Effect.sleep("25 millis")
    }
    throw new Error(`Timed out: ${label}`)
  })
const app = (root: string) =>
  AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node, LocationRuntimeGuard.node]), [
    [
      Global.node,
      Layer.succeed(Global.Service)(
        Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
      ),
    ],
    [SessionExecution.node, SessionExecution.noopLayer],
  ])
const setup = async (modes: Record<string, string>, request = 2000) => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-mcp-resources-"))
  const directory = path.join(root, "project")
  const log = path.join(root, "trace")
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: {
        denied: { permissions: [{ action: "read", resource: "*", effect: "deny" }] },
        namespaced: { permissions: [{ action: "read", resource: "mcp:plugin%3Alocal:*", effect: "deny" }] },
      },
      mcp: {
        servers: Object.fromEntries(
          Object.entries(modes).map(([name, mode]) => [
            name,
            {
              type: "local",
              command: [process.execPath, fixture],
              timeout: { request },
              environment: { MCP_RESOURCE_MODE: mode, MCP_RESOURCE_TRACE: log },
            },
          ]),
        ),
      },
    }),
  )
  return { root, directory, log }
}
const owner = (directory: string) =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const locations = yield* LocationServiceMap.Service
    const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
    return yield* Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.materialize()
      const call = (name: string, input: unknown, agent = "build") =>
        tools.settle({
          sessionID: session.id,
          agent: AgentV2.ID.make(agent),
          assistantMessageID: SessionMessage.ID.create(),
          call: { type: "tool-call", id: crypto.randomUUID(), name, input },
        })
      return { mcp, call }
    }).pipe(Effect.provide(locations.get(session.location)))
  })
const cleanup = async (root: string, log: string) => {
  for (const row of (await trace(log)).filter((row) => row.event === "start"))
    expect(() => process.kill(row.pid, 0)).toThrow()
  await rm(root, { recursive: true, force: true })
}
test("native resource tools paginate, expand template identifiers, and preserve every text/blob block in order", async () => {
  const f = await setup({ "plugin:local": "normal" })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const o = yield* owner(f.directory)
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event !== "start")).toHaveLength(0)
        const listed = yield* o.call("list_mcp_resources", {})
        expect(listed.output?.structured).toMatchObject({
          resources: [
            { server: "plugin:local", uri: "fixture://notes/one" },
            { server: "plugin:local", uri: "fixture://notes/two" },
          ],
          errors: [],
        })
        const templates = yield* o.call("list_mcp_resource_templates", { server: "plugin:local" })
        expect(templates.output?.structured).toMatchObject({
          resourceTemplates: [{ uriTemplate: "fixture://notes/{name}" }, { uriTemplate: "fixture://other/{id}" }],
          errors: [],
        })
        const uri = (yield* o.mcp.resourceTemplates("plugin:local")).resourceTemplates[0].uriTemplate.replace(
          "{name}",
          encodeURIComponent("expanded note"),
        )
        const read = yield* o.call("read_mcp_resource", { server: "plugin:local", uri })
        expect(read.output?.content.map((part) => part.type)).toEqual(["text", "file", "text", "text"])
        expect(read.output?.content[0]).toMatchObject({
          text: expect.stringContaining("fixture://notes/expanded%20note"),
        })
        expect(read.output?.content[2]).toMatchObject({ text: expect.stringContaining("SECOND") })
        expect(read.output?.content[3]).toMatchObject({ text: expect.stringContaining("omitted") })
        expect(read.output?.structured).toMatchObject({
          contents: [
            { _meta: { fixture: "one" } },
            { mimeType: "image/png" },
            { text: "SECOND" },
            { blob: "QklOQVJZ" },
          ],
        })
        expect(McpResources.permissionResource("plugin:local%")).toBe("mcp:plugin%3Alocal%25:*")
        expect(McpResources.permissionResource("*?\\")).toBe("mcp:%2A%3F%5C:*")
        expect((yield* o.call("read_mcp_resource", { server: "plugin:local", uri }, "namespaced")).result.type).toBe(
          "error",
        )
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(1)
      }).pipe(Effect.scoped, Effect.provide(app(f.root))),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 20000)
test("read permission denial prevents all catalog and content RPCs", async () => {
  const f = await setup({ local: "normal" })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const o = yield* owner(f.directory)
        for (const name of ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]) {
          expect((yield* o.call(name, { server: "local", uri: "fixture://secret" }, "denied")).result.type).toBe(
            "error",
          )
        }
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event !== "start")).toHaveLength(0)
      }).pipe(Effect.scoped, Effect.provide(app(f.root))),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 20000)
test("resource pagination rejects cycles, page/item/byte bounds and exposes partial catalog failures", async () => {
  const f = await setup(
    {
      normal: "normal",
      cycle: "cycle",
      pages: "pages",
      items: "items",
      bytes: "bytes",
      broken: "error",
      tools: "tools-only",
    },
    10000,
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const o = yield* owner(f.directory)
        for (const server of ["cycle", "pages", "items", "bytes"]) {
          expect((yield* o.mcp.resources(server).pipe(Effect.flip)).code).toBe("invalid")
        }
        const all = yield* o.mcp.resources()
        expect(all.resources).toHaveLength(2)
        expect(all.errors.map((row) => row.server).sort()).toEqual(["broken", "bytes", "cycle", "items", "pages"])
        expect(JSON.stringify(all)).not.toContain("private-server-details")
        expect((yield* o.mcp.resources("tools").pipe(Effect.flip)).code).toBe("unsupported")
        expect((yield* o.mcp.resources("absent").pipe(Effect.flip)).code).toBe("not_found")
      }).pipe(Effect.scoped, Effect.provide(app(f.root))),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)
test("resource reads reject empty, invalid base64, too many blocks, and oversized content", async () => {
  const f = await setup({ local: "normal" })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const o = yield* owner(f.directory)
        for (const uri of ["empty", "invalid", "many", "large"]) {
          const error = yield* o.mcp.readResource("local", `fixture://${uri}`).pipe(Effect.flip)
          expect(error.code, uri).toBe(uri === "invalid" ? "load" : "invalid")
        }
      }).pipe(Effect.scoped, Effect.provide(app(f.root))),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 20000)
test("resource requests hold the Location guard, propagate cancellation, and timeout without passive retry", async () => {
  const f = await setup({ local: "normal" }, 300)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const o = yield* owner(f.directory)
        const pending = yield* o.mcp.readResource("local", "fixture://wait").pipe(Effect.forkScoped)
        yield* poll(
          Effect.promise(async () => (await trace(f.log)).some((row) => row.event === "read")),
          "read started",
        )
        expect((yield* o.mcp.retry("local").pipe(Effect.flip)).code).toBe("busy")
        yield* Fiber.interrupt(pending)
        yield* poll(
          Effect.promise(async () => (await trace(f.log)).some((row) => row.event === "cancel")),
          "cancellation",
        )
        expect((yield* o.mcp.readResource("local", "fixture://wait").pipe(Effect.flip)).code).toBe("load")
        expect((yield* o.mcp.status).local.status).toBe("connected")
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "start")).toHaveLength(1)
      }).pipe(Effect.scoped, Effect.provide(app(f.root))),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 20000)
test("crashed in-flight resource read cannot publish stale output and next call uses recovered connection", async () => {
  const f = await setup({ local: "normal" }, 5000)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const o = yield* owner(f.directory)
        const before = (yield* Effect.promise(() => trace(f.log))).find((row) => row.event === "start")!.pid
        const pending = yield* o
          .call("read_mcp_resource", { server: "local", uri: "fixture://wait" })
          .pipe(Effect.forkScoped)
        yield* poll(
          Effect.promise(async () => (await trace(f.log)).some((row) => row.event === "read")),
          "read started",
        )
        yield* Effect.sync(() => process.kill(before, "SIGKILL"))
        expect((yield* Fiber.join(pending)).result.type).toBe("error")
        yield* poll(
          o.mcp.status.pipe(Effect.map((status) => status.local.status === "connected")),
          "automatic recovery",
        )
        const after = (yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "start").at(-1)!.pid
        expect(after).not.toBe(before)
        const read = yield* o.call("read_mcp_resource", { server: "local", uri: "fixture://fresh" })
        expect(read.output?.content[0]).toMatchObject({ text: expect.stringContaining(`FIRST:${after}:`) })
        yield* o.mcp.disconnect("local")
        expect((yield* o.mcp.readResource("local", "fixture://fresh").pipe(Effect.flip)).code).toBe("load")
        expect((yield* o.mcp.resources()).resources).toEqual([])
      }).pipe(Effect.scoped, Effect.provide(app(f.root))),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 20000)

test("combined resource catalog bounds apply across otherwise valid servers", async () => {
  const f = await setup({ first: "combined", second: "combined" })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const o = yield* owner(f.directory)
        expect((yield* o.mcp.resources("first")).resources).toHaveLength(600)
        expect((yield* o.mcp.resources().pipe(Effect.flip)).code).toBe("invalid")
      }).pipe(Effect.scoped, Effect.provide(app(f.root))),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 20000)

test("all-server catalog drops earlier metadata when that connection closes during a later listing", async () => {
  const f = await setup({ a: "normal", z: "catalog-wait" }, 5000)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const o = yield* owner(f.directory)
        const initial = (yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "start")
        const pending = yield* o.mcp.resources().pipe(Effect.forkScoped)
        yield* poll(
          Effect.promise(async () => (await trace(f.log)).filter((row) => row.event === "list").length === 3),
          "later catalog held",
        )
        yield* Effect.sync(() => process.kill(initial[0].pid, "SIGKILL"))
        yield* poll(
          o.mcp.status.pipe(Effect.map((status) => status.a.status === "failed")),
          "earlier connection closed",
        )
        yield* Effect.promise(() => Bun.write(f.log + ".release", "ready"))
        const result = yield* Fiber.join(pending)
        expect(result.resources.map((row) => row.server)).toEqual(["z", "z"])
        expect(result.errors).toEqual([
          { server: "a", code: "load", message: "MCP resource connection changed during catalog request" },
        ])
      }).pipe(Effect.scoped, Effect.provide(app(f.root))),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 20000)
