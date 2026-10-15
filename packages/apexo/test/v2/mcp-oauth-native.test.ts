import { expect, test } from "bun:test"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { McpOAuthStore } from "@apexo/core/mcp-oauth-store"
import { McpOAuth } from "@apexo/core/mcp-oauth"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { MCP } from "@apexo/core/mcp"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"
import { setup } from "../fixture/mcp-oauth"

const app = (root: string) =>
  AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node, LocationRuntimeGuard.node]), [
    [
      Global.node,
      Layer.succeed(Global.Service)(
        Global.make({
          data: path.join(root, "data"),
          config: path.join(root, "config"),
          home: root,
        }),
      ),
    ],
    [SessionExecution.node, SessionExecution.noopLayer],
  ])
const wait = (check: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    const end = Date.now() + 5000
    while (Date.now() < end) {
      if (yield* check) return
      yield* Effect.sleep("10 millis")
    }
    throw new Error("native OAuth fixture deadline")
  })
test("native Core authenticates disabled server without transport, then explicitly connects and reuses tokens", async () => {
  const f = await setup({ disabled: true })
  const directory = path.join(f.root, "project")
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      mcp: { servers: { reference: f.definition } },
    }),
  )
  const run = Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const locations = yield* LocationServiceMap.Service
    const session = yield* sessions.create({
      location: { directory: AbsolutePath.make(directory) },
    })
    yield* Effect.gen(function* () {
      const mcp = yield* MCP.Service
      expect((yield* mcp.status).reference).toMatchObject({
        status: "disabled",
        authentication: { credentials: "missing" },
      })
      const started = yield* mcp.authStart("reference")
      yield* Effect.promise(() => fetch(started.authorizationUrl))
      yield* wait(mcp.status.pipe(Effect.map((s) => s.reference.authentication?.flow?.phase === "credentials_ready")))
      expect(f.state.initializes).toBe(0)
      expect(f.state.tools).toBe(0)
      yield* mcp.connect("reference")
      expect((yield* mcp.status).reference).toMatchObject({
        status: "connected",
        tools: 1,
        preference: true,
        authentication: { credentials: "available" },
      })
      expect(f.state.initializes).toBe(1)
      expect(f.state.tools).toBe(1)
      yield* mcp.retry("reference")
      expect(f.state.authorize).toBe(1)
      yield* mcp.disconnect("reference")
      expect((yield* mcp.status).reference.status).toBe("disabled")
    }).pipe(Effect.provide(locations.get(session.location)))
  }).pipe(Effect.provide(app(f.root)), Effect.scoped)
  try {
    await Effect.runPromise(run)
  } finally {
    await f.close()
  }
}, 30000)

test("native OAuth completion remains retry-required while Location is busy and never starts transport", async () => {
  const f = await setup()
  const directory = path.join(f.root, "project")
  const location = { directory: AbsolutePath.make(directory) }
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      mcp: { servers: { reference: f.definition } },
    }),
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const guard = yield* LocationRuntimeGuard.Service
        const session = yield* sessions.create({ location })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          expect((yield* mcp.status).reference.status).toBe("needs_auth")
          const started = yield* mcp.authStart("reference")
          const entered = yield* Deferred.make<void>()
          const held = yield* guard
            .use(location, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
            .pipe(Effect.forkScoped)
          yield* Deferred.await(entered)
          const before = f.state.mcp
          yield* Effect.promise(() => fetch(started.authorizationUrl))
          yield* wait(mcp.status.pipe(Effect.map((s) => s.reference.authentication?.flow?.phase === "retry_required")))
          expect(f.state.mcp).toBe(before)
          expect(f.state.tools).toBe(0)
          expect((yield* mcp.status).reference.authentication?.credentials).toBe("available")
          yield* Fiber.interrupt(held)
          yield* mcp.retry("reference")
          expect((yield* mcp.status).reference).toMatchObject({
            status: "connected",
            tools: 1,
          })
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(f.root)), Effect.scoped),
    )
  } finally {
    await f.close()
  }
}, 30000)

test("native management supersedes and joins waiting consent without deadlocking", async () => {
  const f = await setup({ disabled: true })
  const directory = path.join(f.root, "project")
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      mcp: { servers: { reference: f.definition } },
    }),
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(directory) },
        })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const started = yield* mcp.authStart("reference")
          yield* mcp.disconnect("reference")
          expect((yield* mcp.status).reference).toMatchObject({
            status: "disabled",
            preference: false,
            authentication: {
              credentials: "missing",
              flow: { phase: "cancelled" },
            },
          })
          yield* Effect.promise(async () => {
            await expect(fetch(new URL(started.authorizationUrl).searchParams.get("redirect_uri")!)).rejects.toThrow()
          })
          expect(f.state.grants).toBe(0)
          expect(f.state.initializes).toBe(0)
          const second = yield* mcp.authStart("reference")
          expect(Exit.isFailure(yield* mcp.authCancel("reference", started.id).pipe(Effect.exit))).toBe(true)
          yield* mcp.authCancel("reference", second.id)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(f.root)), Effect.scoped),
    )
  } finally {
    await f.close()
  }
}, 30000)

test("native OAuth credentials survive a fresh application and invalid peers do not break status", async () => {
  const f = await setup({ disabled: true })
  const directory = path.join(f.root, "project")
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      mcp: {
        servers: {
          reference: f.definition,
          broken: {
            type: "remote",
            url: "not-a-url",
            oauth: { redirect_uri: "invalid" },
          },
        },
      },
    }),
  )
  const run = (authorize: boolean) =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const locations = yield* LocationServiceMap.Service
      const session = yield* sessions.create({
        location: { directory: AbsolutePath.make(directory) },
      })
      yield* Effect.gen(function* () {
        const mcp = yield* MCP.Service
        expect((yield* mcp.status).broken).toMatchObject({
          status: "failed",
          authentication: { supported: false, error: "invalid" },
        })
        if (authorize) {
          const started = yield* mcp.authStart("reference")
          yield* Effect.promise(() => fetch(started.authorizationUrl))
          yield* wait(
            mcp.status.pipe(Effect.map((s) => s.reference.authentication?.flow?.phase === "credentials_ready")),
          )
          yield* mcp.connect("reference")
          return
        }
        expect((yield* mcp.status).reference).toMatchObject({
          status: "connected",
          tools: 1,
          preference: true,
          authentication: { credentials: "available" },
        })
        expect(f.state.authorize).toBe(1)
      }).pipe(Effect.provide(locations.get(session.location)))
    }).pipe(Effect.provide(app(f.root)), Effect.scoped)
  try {
    await Effect.runPromise(run(true))
    await Effect.runPromise(run(false))
  } finally {
    await f.close()
  }
}, 30000)

test("failed reauthorization and corrupt storage preserve the healthy native transport", async () => {
  const f = await setup({ disabled: true })
  const directory = path.join(f.root, "project"),
    location = { directory: AbsolutePath.make(directory) }
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({ snapshots: false, mcp: { servers: { reference: f.definition } } }),
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location })
        yield* Effect.gen(function* () {
          const mcp = yield* MCP.Service
          const first = yield* mcp.authStart("reference")
          yield* Effect.promise(() => fetch(first.authorizationUrl))
          yield* wait(
            mcp.status.pipe(Effect.map((s) => s.reference.authentication?.flow?.phase === "credentials_ready")),
          )
          yield* mcp.connect("reference")
          f.state.denied = true
          const denied = yield* mcp.authStart("reference")
          yield* Effect.promise(() => fetch(denied.authorizationUrl))
          yield* wait(mcp.status.pipe(Effect.map((s) => s.reference.authentication?.flow?.phase === "failed")))
          expect((yield* mcp.status).reference).toMatchObject({ status: "connected", tools: 1 })
          expect(f.state.initializes).toBe(1)
          expect(f.state.grants).toBe(1)
          const file = McpOAuthStore.file(
            path.join(f.root, "data"),
            McpOAuth.identity(location, "reference", f.definition),
          )
          const bytes = yield* Effect.promise(() => readFile(file))
          yield* Effect.promise(() => writeFile(file, "{"))
          const failed = yield* mcp.authStart("reference").pipe(Effect.exit)
          expect(Exit.isFailure(failed)).toBe(true)
          expect((yield* mcp.status).reference).toMatchObject({
            status: "connected",
            tools: 1,
            authentication: { flow: { phase: "failed", error: "storage" } },
          })
          expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("{")
          yield* Effect.promise(() => writeFile(file, bytes))
          const recovered = yield* mcp.authStart("reference")
          yield* mcp.authCancel("reference", recovered.id)
          expect(f.state.initializes).toBe(1)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(f.root)), Effect.scoped),
    )
  } finally {
    await f.close()
  }
}, 30000)
