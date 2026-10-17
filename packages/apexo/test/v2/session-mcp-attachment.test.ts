import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { MCP } from "@apexo/core/mcp"
import { PermissionV2 } from "@apexo/core/permission"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { TestClock } from "effect/testing"
import { SessionMcpAttachmentOperation } from "@apexo/core/session/mcp-attachment-operation"
import { SessionMcpAttachment } from "@apexo/core/session/mcp-attachment"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionStore } from "@apexo/core/session/store"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/schema/schema"

const fixture = path.join(import.meta.dir, "../fixture/mcp-attachment-stdio.ts")
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
      yield* Effect.sleep("20 millis")
    }
    throw new Error(`Timed out: ${label}`)
  })
const setup = async (dual = false) => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-mcp-attachment-"))
  await mkdir(path.join(root, "data"))
  const directory = path.join(root, "project")
  const log = path.join(root, "trace")
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: {
        denied: { permissions: [{ action: "read", resource: "*", effect: "deny" }] },
        asking: { permissions: [{ action: "read", resource: "*", effect: "ask" }] },
      },
      mcp: {
        servers: {
          ...(dual
            ? {
                other: {
                  type: "local",
                  command: [process.execPath, fixture],
                  environment: { MCP_RESOURCE_TRACE: log, MCP_RESOURCE_LABEL: "OTHER:" },
                },
              }
            : {}),
          "plugin:local": {
            type: "local",
            command: [process.execPath, fixture],
            timeout: { request: 15000 },
            environment: { MCP_RESOURCE_TRACE: log },
          },
        },
      },
    }),
  )
  const app = AppNodeBuilder.build(
    LayerNode.group([
      SessionV2.node,
      SessionStore.node,
      SessionMcpAttachment.node,
      SessionMcpAttachmentOperation.node,
      LocationServiceMap.node,
    ]),
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
  return { root, directory, log, app }
}
const clean = async (f: Awaited<ReturnType<typeof setup>>) => {
  for (const row of (await trace(f.log)).filter((row) => row.event === "start"))
    expect(() => process.kill(row.pid, 0)).toThrow()
  await rm(f.root, { recursive: true, force: true })
}
test("native preparation snapshots Unicode, expands RFC6570 maps and rejects unsupported multipart content atomically", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const attachments = yield* SessionMcpAttachment.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const catalog = yield* attachments.catalog(session.id, {})
        expect(catalog.resources).toHaveLength(2)
        expect(catalog.templates[0].variables).toEqual(["name", "query", "values", "map"])
        const result = yield* attachments.prepare(session.id, {
          kind: "template",
          server: "plugin:local",
          uriTemplate: catalog.templates[0].uriTemplate,
          parameters: { name: "snow 雪", query: "a b", values: ["a", "b"], map: { key: "value" } },
        })
        expect(result.resourceURI).toBe("fixture://notes/snow%20%E9%9B%AA?query=a%20b&values=a&values=b&key=value")
        expect(Buffer.from(result.files[0].uri.split(",")[1], "base64").toString()).toBe(
          `UNICODE:雪:${result.resourceURI}`,
        )
        const rejected = yield* attachments
          .prepare(session.id, { kind: "resource", server: "plugin:local", uri: "fixture://unsupported" })
          .pipe(Effect.exit)
        expect(Exit.isFailure(rejected)).toBe(true)
        expect(JSON.stringify(rejected)).toContain("unsupported")
        const store = yield* SessionStore.Service
        expect(yield* store.context(session.id)).toHaveLength(0)
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)
test("deny performs no resource RPC; approve-once uses canonical read alias and does not ask twice", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const attachments = yield* SessionMcpAttachment.Service
        const locations = yield* LocationServiceMap.Service
        const denied = yield* sessions.create({
          location: { directory: AbsolutePath.make(f.directory) },
          agent: AgentV2.ID.make("denied"),
        })
        expect(
          Exit.isFailure(
            yield* attachments
              .prepare(denied.id, { kind: "resource", server: "plugin:local", uri: "fixture://secret" })
              .pipe(Effect.exit),
          ),
        ).toBe(true)
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(0)
        const session = yield* sessions.create({ location: denied.location, agent: AgentV2.ID.make("asking") })
        yield* Effect.gen(function* () {
          const permission = yield* PermissionV2.Service
          const pending = yield* attachments
            .prepare(session.id, { kind: "resource", server: "plugin:local", uri: "fixture://once" })
            .pipe(Effect.forkChild)
          yield* poll(
            permission.forSession(session.id).pipe(Effect.map((requests) => requests.length === 1)),
            "approval request",
          )
          const requests = yield* permission.forSession(session.id)
          expect(requests[0].action).toBe("read")
          expect(requests[0].resources).toEqual(["mcp:plugin%3Alocal:fixture://once"])
          yield* permission.reply({ requestID: requests[0].id, reply: "once" })
          expect((yield* Fiber.join(pending)).files).toHaveLength(1)
          expect(yield* permission.forSession(session.id)).toHaveLength(0)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)
test("Session deletion interrupts pending read; SDK cancellation and cooperative server cleanup are separately observed", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const attachments = yield* SessionMcpAttachment.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const pending = yield* attachments
          .prepare(session.id, { kind: "resource", server: "plugin:local", uri: "fixture://wait" })
          .pipe(Effect.forkChild)
        yield* poll(
          Effect.promise(() => trace(f.log)).pipe(Effect.map((rows) => rows.some((row) => row.event === "read"))),
          "held read",
        )
        yield* sessions.remove(session.id)
        expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
        yield* poll(
          Effect.promise(() => trace(f.log)).pipe(
            Effect.map((rows) => rows.some((row) => row.event === "read-cleanup")),
          ),
          "remote cooperative cleanup",
        )
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "cancel")).toHaveLength(1)
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)

test("deletion joins pending approval and same-ID recreation cannot adopt old attachment work", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const attachments = yield* SessionMcpAttachment.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(f.directory) },
          agent: AgentV2.ID.make("asking"),
        })
        yield* Effect.gen(function* () {
          const permission = yield* PermissionV2.Service
          const pending = yield* attachments
            .prepare(session.id, { kind: "resource", server: "plugin:local", uri: "fixture://secret" })
            .pipe(Effect.forkChild)
          yield* poll(
            permission.forSession(session.id).pipe(Effect.map((requests) => requests.length === 1)),
            "pending approval",
          )
          yield* sessions.remove(session.id)
          expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
          expect(yield* permission.forSession(session.id)).toHaveLength(0)
          const replacement = yield* sessions.create({ id: session.id, location: session.location })
          expect(replacement.id).toBe(session.id)
          expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(0)
          expect(
            (yield* attachments.prepare(replacement.id, {
              kind: "resource",
              server: "plugin:local",
              uri: "fixture://fresh",
            })).files,
          ).toHaveLength(1)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)
test("authority changes reject held bytes while another Session can prepare independently; exact admission retry does not reread", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const store = yield* SessionStore.Service
        const attachments = yield* SessionMcpAttachment.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const other = yield* sessions.create({ location: session.location })
        const pending = yield* attachments
          .prepare(session.id, { kind: "resource", server: "plugin:local", uri: "fixture://held" })
          .pipe(Effect.forkChild)
        yield* poll(
          Effect.promise(() => trace(f.log)).pipe(
            Effect.map((rows) => rows.some((row) => row.params?.uri === "fixture://held")),
          ),
          "held read",
        )
        const result = yield* attachments.prepare(other.id, {
          kind: "resource",
          server: "plugin:local",
          uri: "fixture://independent",
        })
        yield* store.setPermissions({
          sessionID: session.id,
          permissions: [{ permission: "read", pattern: "*", action: "deny" }],
        })
        yield* Effect.promise(() => Bun.write(f.log + ".release", "release"))
        expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
        const id = SessionMessage.ID.create()
        const prompt = { text: "snapshot", files: result.files.map((file) => ({ uri: file.uri, name: file.name })) }
        yield* sessions.prompt({ sessionID: other.id, id, prompt, resume: false })
        yield* sessions.prompt({ sessionID: other.id, id, prompt, resume: false })
        expect(
          Exit.isFailure(
            yield* sessions
              .prompt({ sessionID: other.id, id, prompt: { ...prompt, text: "conflict" }, resume: false })
              .pipe(Effect.exit),
          ),
        ).toBe(true)
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(2)
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)
test("active reads reject explicit disconnect; a crashed connection rejects pending bytes", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const attachments = yield* SessionMcpAttachment.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const pending = yield* attachments
          .prepare(session.id, { kind: "resource", server: "plugin:local", uri: "fixture://held" })
          .pipe(Effect.forkChild)
        yield* poll(
          Effect.promise(() => trace(f.log)).pipe(
            Effect.map((rows) => rows.some((row) => row.params?.uri === "fixture://held")),
          ),
          "held read",
        )
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          expect((yield* mcp.disconnect("plugin:local").pipe(Effect.flip)).code).toBe("busy")
          const pid = (yield* Effect.promise(() => trace(f.log))).find((row) => row.event === "start")!.pid
          yield* Effect.sync(() => process.kill(pid, "SIGKILL"))
        }).pipe(Effect.provide(locations.get(session.location)))
        expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)

test("canonical materialization preserves supported byte snapshots and enforces atomic count, UTF-8, signature and size bounds", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=",
    "base64",
  )
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n")
  const files = SessionMcpAttachment.materialize({
    contents: [
      { uri: "fixture://text", text: "雪\uFEFF" },
      { uri: "fixture://png", mimeType: "image/png", blob: png.toString("base64") },
      { uri: "fixture://pdf", mimeType: "application/pdf", blob: pdf.toString("base64") },
    ],
  })
  expect(files.map((file) => file.mimeType)).toEqual(["text/plain", "image/png", "application/pdf"])
  expect(Buffer.from(files[1].uri.split(",")[1], "base64")).toEqual(png)
  expect(Buffer.from(files[2].uri.split(",")[1], "base64")).toEqual(pdf)
  expect(() => SessionMcpAttachment.materialize({ contents: [{ uri: "fixture://invalid", text: "\uD800" }] })).toThrow(
    "Unicode",
  )
  expect(() =>
    SessionMcpAttachment.materialize({
      contents: [{ uri: "fixture://invalid", mimeType: "text/plain", blob: "/w==" }],
    }),
  ).toThrow()
  expect(() =>
    SessionMcpAttachment.materialize({ contents: [{ uri: "fixture://invalid", mimeType: "image/png", blob: "YQ==" }] }),
  ).toThrow("signature")
  expect(() =>
    SessionMcpAttachment.materialize({ contents: [{ uri: "fixture://huge", text: "a".repeat(10 * 1024 * 1024 + 1) }] }),
  ).toThrow("byte limit")
  expect(() =>
    SessionMcpAttachment.materialize({
      contents: Array.from({ length: 129 }, () => ({ uri: "fixture://part", text: "x" })),
    }),
  ).toThrow("count")
  expect(() => SessionMcpAttachment.expand("fixture://{name}", { name: "a", extra: "b" })).toThrow()
  expect(() => SessionMcpAttachment.expand("fixture://{name}", {})).toThrow()
  expect(SessionMcpAttachment.expand("fixture://{+path}{?map*}", { path: "one/two", map: { a: "snow 雪" } })).toBe(
    "fixture://one/two?a=snow%20%E9%9B%AA",
  )
})

test("equal URIs on two live connections and two Sessions retain exact server ownership", async () => {
  const f = await setup(true)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const attachments = yield* SessionMcpAttachment.Service
        const first = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const second = yield* sessions.create({ location: first.location })
        const results = yield* Effect.all(
          [
            attachments.prepare(first.id, { kind: "resource", server: "plugin:local", uri: "fixture://same" }),
            attachments.prepare(second.id, { kind: "resource", server: "other", uri: "fixture://same" }),
          ],
          { concurrency: "unbounded" },
        )
        expect(results.map((result) => result.server)).toEqual(["plugin:local", "other"])
        expect(results.map((result) => Buffer.from(result.files[0].uri.split(",")[1], "base64").toString())).toEqual([
          "UNICODE:雪:fixture://same",
          "OTHER:UNICODE:雪:fixture://same",
        ])
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(2)
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)

test("reservation and early cancellation are passive; conflicts and terminal failures never reread", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMcpAttachmentOperation.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const request = {
          kind: "prepare",
          input: { kind: "resource", server: "plugin:local", uri: "fixture://passive" },
        } as const
        const reserved = yield* operations.reserve(session.id, request)
        expect(reserved.id).toMatch(/^maop_[a-f0-9]{32}$/)
        expect((yield* operations.status(session.id, reserved.id)).status).toBe("reserved")
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event !== "start")).toHaveLength(0)
        expect((yield* operations.cancel(session.id, reserved.id)).status).toBe("cancelled")
        expect((yield* operations.execute(session.id, reserved.id, request)).status).toBe("cancelled")
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(0)
        const invalid = {
          kind: "prepare",
          input: { kind: "resource", server: "plugin:local", uri: "fixture://unsupported" },
        } as const
        const failed = yield* operations.reserve(session.id, invalid)
        expect((yield* operations.execute(session.id, failed.id, request).pipe(Effect.flip)).code).toBe("conflict")
        const first = yield* operations.execute(session.id, failed.id, invalid)
        expect(first.status).toBe("failed")
        expect(first.error?.code).toBe("unsupported")
        expect(yield* operations.execute(session.id, failed.id, invalid)).toEqual(first)
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(1)
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)
test("concurrent exact executions share one read; explicit cancellation joins only the pinned owner", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMcpAttachmentOperation.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const other = yield* sessions.create({ location: session.location })
        const request = {
          kind: "prepare",
          input: { kind: "resource", server: "plugin:local", uri: "fixture://wait" },
        } as const
        const reserved = yield* operations.reserve(session.id, request)
        const first = yield* operations.execute(session.id, reserved.id, request).pipe(Effect.forkChild)
        const second = yield* operations.execute(session.id, reserved.id, request).pipe(Effect.forkChild)
        yield* poll(
          Effect.promise(() => trace(f.log)).pipe(Effect.map((rows) => rows.some((row) => row.event === "read"))),
          "operation read",
        )
        expect((yield* operations.cancel(other.id, reserved.id).pipe(Effect.flip)).code).toBe("expired")
        expect((yield* operations.cancel(session.id, reserved.id)).status).toBe("cancelled")
        expect((yield* Fiber.join(first)).status).toBe("cancelled")
        expect((yield* Fiber.join(second)).status).toBe("cancelled")
        yield* poll(
          Effect.promise(() => trace(f.log)).pipe(
            Effect.map((rows) => rows.some((row) => row.event === "read-cleanup")),
          ),
          "cooperative cancel",
        )
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(1)
        expect((yield* operations.status(session.id, reserved.id)).status).toBe("cancelled")
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)
test("reserved handles expire without starting work and cannot follow same-ID Session recreation", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMcpAttachmentOperation.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const request = { kind: "catalog", input: {} } as const
        yield* Effect.gen(function* () {
          const reserved = yield* operations.reserve(session.id, request)
          yield* TestClock.adjust("6 minutes")
          expect((yield* operations.execute(session.id, reserved.id, request).pipe(Effect.flip)).code).toBe("expired")
          expect((yield* operations.status(session.id, reserved.id).pipe(Effect.flip)).code).toBe("expired")
        }).pipe(Effect.provide(TestClock.layer()))
        const retired = yield* operations.reserve(session.id, request)
        yield* sessions.remove(session.id)
        const replacement = yield* sessions.create({ id: session.id, location: session.location })
        expect((yield* operations.execute(replacement.id, retired.id, request).pipe(Effect.flip)).code).toBe("expired")
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event !== "start")).toHaveLength(0)
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)

test("cached bytes reject changed agent or authority while the original owner can still cancel and join", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const store = yield* SessionStore.Service
        const operations = yield* SessionMcpAttachmentOperation.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const request = {
          kind: "prepare",
          input: { kind: "resource", server: "plugin:local", uri: "fixture://snapshot" },
        } as const
        const reserved = yield* operations.reserve(session.id, request)
        expect((yield* operations.execute(session.id, reserved.id, request)).status).toBe("completed")
        yield* store.setPermissions({
          sessionID: session.id,
          permissions: [{ permission: "read", pattern: "*", action: "deny" }],
        })
        expect((yield* operations.execute(session.id, reserved.id, request).pipe(Effect.flip)).code).toBe("denied")
        expect((yield* operations.status(session.id, reserved.id).pipe(Effect.flip)).code).toBe("denied")
        expect((yield* operations.cancel(session.id, reserved.id)).prepared).toBeUndefined()
        yield* store.setPermissions({ sessionID: session.id, permissions: [] })
        const held = {
          kind: "prepare",
          input: { kind: "resource", server: "plugin:local", uri: "fixture://wait" },
        } as const
        const active = yield* operations.reserve(session.id, held)
        const pending = yield* operations.execute(session.id, active.id, held).pipe(Effect.forkChild)
        yield* poll(
          Effect.promise(() => trace(f.log)).pipe(
            Effect.map((rows) => rows.some((row) => row.params?.uri === "fixture://wait")),
          ),
          "held read before agent switch",
        )
        yield* sessions.switchAgent({ sessionID: session.id, agent: "denied" })
        expect((yield* operations.cancel(session.id, active.id)).status).toBe("cancelled")
        expect(Exit.isFailure(yield* Fiber.await(pending))).toBe(true)
        expect((yield* operations.execute(session.id, reserved.id, request).pipe(Effect.flip)).code).toBe("changed")
        yield* poll(
          Effect.promise(() => trace(f.log)).pipe(
            Effect.map((rows) => rows.some((row) => row.event === "read-cleanup")),
          ),
          "remote cleanup after changed agent",
        )
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)
test("retained snapshot bytes are capped and expiration releases capacity without rereading expired handles", async () => {
  const f = await setup()
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const operations = yield* SessionMcpAttachmentOperation.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(f.directory) } })
        const request = {
          kind: "prepare",
          input: { kind: "resource", server: "plugin:local", uri: "fixture://ten" },
        } as const
        const first = yield* operations.reserve(session.id, request)
        const second = yield* operations.reserve(session.id, request)
        const third = yield* operations.reserve(session.id, request)
        expect((yield* operations.execute(session.id, first.id, request)).status).toBe("completed")
        expect((yield* operations.execute(session.id, second.id, request)).status).toBe("completed")
        const overflow = yield* operations.execute(session.id, third.id, request)
        expect(overflow.status).toBe("failed")
        expect(overflow.error?.code).toBe("limit")
        yield* Effect.gen(function* () {
          yield* TestClock.setTime(Math.max(first.expiresAt, second.expiresAt) + 1)
          expect((yield* operations.status(session.id, first.id).pipe(Effect.flip)).code).toBe("expired")
          expect((yield* operations.status(session.id, second.id).pipe(Effect.flip)).code).toBe("expired")
        }).pipe(Effect.provide(TestClock.layer()))
        const fourth = yield* operations.reserve(session.id, request)
        expect((yield* operations.execute(session.id, fourth.id, request)).status).toBe("completed")
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "read")).toHaveLength(4)
      }).pipe(Effect.scoped, Effect.provide(f.app)),
    )
  } finally {
    await clean(f)
  }
}, 30000)
