import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundle } from "@apexo/core/plugin-bundle"

test("native plugin socket transport preserves the endpoint without executing it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-socket-"))
  try {
    await Bun.write(path.join(root, "plugin.json"), JSON.stringify({ name: "socket" }))
    await Bun.write(
      path.join(root, ".lsp.json"),
      JSON.stringify({
        local: {
          command: "127.0.0.1:32123",
          transport: "socket",
          extensionToLanguage: { ".fixture": "fixture" },
        },
      }),
    )
    const bundle = await PluginBundle.read(root, "socket", { native: true })
    expect(bundle.config.lsp).toMatchObject({ "socket:local": { command: ["127.0.0.1:32123"], transport: "socket" } })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import { NativeLspClient } from "@apexo/core/lsp-client"

const poll = async (check: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out: ${label}`)
}
const trace = async (root: string) =>
  (
    await Bun.file(path.join(root, "trace"))
      .text()
      .catch(() => "")
  )
    .split("\n")
    .filter(Boolean)
    .map((line): { event: string; id?: number; params?: unknown } => JSON.parse(line))
const external = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-socket-"))
  await Bun.write(path.join(root, "mode"), "ready")
  const child = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dir, "../fixture/lsp-native-socket.ts"),
      path.join(root, "trace"),
      path.join(root, "ready"),
      path.join(root, "mode"),
    ],
    { stdout: "ignore", stderr: "inherit" },
  )
  await poll(() => Bun.file(path.join(root, "ready")).exists(), "external server ready")
  const info = await Bun.file(path.join(root, "ready")).json()
  return {
    root,
    child,
    endpoint: `127.0.0.1:${info.port}`,
    close: async () => {
      child.kill("SIGTERM")
      await child.exited
      await rm(root, { recursive: true, force: true })
    },
  }
}

test("native socket closes only its connection, retains workspace handshake and cancels requests", async () => {
  const server = await external()
  try {
    const client = await NativeLspClient.create({
      transport: "socket",
      command: [server.endpoint],
      root: server.root,
      workspaceOpen: { solution: "App.sln", projects: ["One.csproj"] },
      signal: new AbortController().signal,
    })
    expect(
      await client.execute(
        { operation: "hover", file: path.join(server.root, "main.fixture"), text: "socket result" },
        new AbortController().signal,
      ),
    ).toEqual({ contents: { kind: "plaintext", value: "socket result" } })
    const abort = new AbortController()
    const pending = client.execute(
      { operation: "hover", file: path.join(server.root, "main.fixture"), text: "WAIT" },
      abort.signal,
    )
    await poll(
      async () => (await trace(server.root)).filter((row) => row.event === "hover").length === 2,
      "held request",
    )
    abort.abort(new Error("cancel socket request"))
    await expect(pending).rejects.toThrow("cancel socket request")
    await poll(async () => (await trace(server.root)).some((row) => row.event === "cancel"), "protocol cancellation")
    await client.close()
    await poll(async () => {
      const events = await trace(server.root)
      return events.some((row) => row.event === "close") && events.some((row) => row.event === "exit")
    }, "socket exit delivered and closed")
    expect(server.child.exitCode).toBeNull()
    expect((await trace(server.root)).map((row) => row.event)).toEqual(
      expect.arrayContaining(["initialized", "solution/open", "project/open", "shutdown", "exit"]),
    )
    const second = await NativeLspClient.create({
      transport: "socket",
      command: [server.endpoint],
      root: server.root,
      signal: new AbortController().signal,
    })
    await second.close()
    expect(server.child.exitCode).toBeNull()
  } finally {
    await server.close()
  }
})

test("native socket startup timeout, abort, malformed frame and hung shutdown join connection cleanup without killing server", async () => {
  const server = await external()
  try {
    for (const mode of ["hang", "abort", "frame", "shutdown-hang"] as const) {
      await Bun.write(path.join(server.root, "mode"), mode === "abort" ? "hang" : mode)
      const before = (await trace(server.root)).filter((row) => row.event === "close").length
      const abort = new AbortController()
      const pending = NativeLspClient.create({
        transport: "socket",
        command: [server.endpoint],
        root: server.root,
        startupTimeout: 500,
        shutdownTimeout: 100,
        signal: abort.signal,
      })
      if (mode === "abort") {
        await poll(
          async () => (await trace(server.root)).filter((row) => row.event === "initialize").length > before,
          "held initialization",
        )
        abort.abort(new Error("cancel startup"))
      }
      if (mode === "shutdown-hang") await (await pending).close()
      else await expect(pending).rejects.toThrow()
      await poll(
        async () => (await trace(server.root)).filter((row) => row.event === "close").length === before + 1,
        `${mode} socket joined`,
      )
      expect(server.child.exitCode).toBeNull()
    }
  } finally {
    await server.close()
  }
}, 10000)

for (const endpoint of ["node", "tcp://127.0.0.1:1", "127.0.0.1:0", "127.0.0.1:65536", "user@host:3", "host:3/path"])
  test(`native socket rejects invalid endpoint ${endpoint}`, async () => {
    await expect(
      NativeLspClient.create({
        transport: "socket",
        command: [endpoint],
        root: tmpdir(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("host:port")
  })

import { Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { PluginBundleRuntime } from "@apexo/core/plugin-bundle-runtime"
import { EventV2 } from "@apexo/core/event"
import { LSP } from "@apexo/core/lsp"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"

const app = (root: string) =>
  AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node, EventV2.node]), [
    [
      Global.node,
      Layer.succeed(Global.Service)(
        Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
      ),
    ],
    [SessionExecution.node, SessionExecution.noopLayer],
  ])

test("native socket reload, interrupted candidate, finite reconnect budget and disable retain external process ownership", async () => {
  const server = await external()
  const directory = path.join(server.root, "project")
  await Bun.write(path.join(server.root, "data/.ready"), "")
  await Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false }))
  const plugin = path.join(server.root, "plugin")
  const store = path.join(server.root, "data/plugins")
  await Bun.write(path.join(plugin, "plugin.json"), JSON.stringify({ name: "socket" }))
  await Bun.write(
    path.join(plugin, ".lsp.json"),
    JSON.stringify({
      local: {
        transport: "socket",
        command: server.endpoint,
        extensionToLanguage: { ".fixture": "fixture" },
        restartOnCrash: true,
        maxRestarts: 1,
        startupTimeout: 10000,
      },
    }),
  )
  await PluginStore.mutate(store, { action: "install", source: plugin, trust: true })
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const runtime = yield* PluginBundleRuntime.Service
          expect((yield* lsp.status)[0]?.status).toBe("connected")
          yield* lsp.execute({ operation: "workspaceSymbol", query: "disconnect" }).pipe(Effect.ignore)
          yield* Effect.promise(() =>
            poll(
              async () => (await trace(server.root)).filter((row) => row.event === "initialized").length === 2,
              "one reconnect",
            ),
          )
          expect((yield* lsp.status)[0]?.status).toBe("connected")
          yield* lsp.execute({ operation: "workspaceSymbol", query: "disconnect" }).pipe(Effect.ignore)
          yield* Effect.sleep("1500 millis")
          expect((yield* lsp.status)[0]?.error).toContain("budget exhausted")
          expect(
            (yield* Effect.promise(() => trace(server.root))).filter((row) => row.event === "connect"),
          ).toHaveLength(2)
          yield* runtime.reload()
          expect((yield* lsp.status)[0]?.status).toBe("connected")
          yield* Effect.promise(() => Bun.write(path.join(server.root, "mode"), "hang"))
          const reload = yield* runtime.reload().pipe(Effect.forkScoped)
          yield* Effect.promise(() =>
            poll(
              async () => (await trace(server.root)).filter((row) => row.event === "initialize").length === 4,
              "candidate initializing",
            ),
          )
          yield* Fiber.interrupt(reload)
          yield* Effect.promise(() =>
            poll(
              async () => (await trace(server.root)).some((row) => row.event === "close" && row.id === 4),
              "candidate connection closed",
            ),
          )
          expect((yield* lsp.status)[0]?.status).toBe("connected")
          expect(yield* lsp.execute({ operation: "workspaceSymbol", query: "retained" })).toBeDefined()
          expect(server.child.exitCode).toBeNull()
          yield* Effect.promise(async () => {
            const installed = (await PluginStore.catalog(store)).items.find((item) => item.name === "socket")!
            await PluginStore.mutate(store, { action: "disable", id: installed.id })
          })
          yield* runtime.reload()
          yield* Effect.promise(() =>
            poll(
              async () => (await trace(server.root)).filter((row) => row.event === "close").length === 4,
              "disable closes last connection",
            ),
          )
          expect(server.child.exitCode).toBeNull()
        }).pipe(Effect.provide(locations.get({ directory: AbsolutePath.make(directory) })))
      }).pipe(Effect.scoped, Effect.provide(app(server.root))),
    )
    expect(server.child.exitCode).toBeNull()
  } finally {
    await server.close()
  }
}, 30000)

test("native workspace socket stays pending until current authority and disposal joins its connection", async () => {
  const server = await external()
  const directory = path.join(server.root, "project")
  await Bun.write(path.join(server.root, "data/.ready"), "")
  await Bun.write(path.join(directory, "nested/App.sln"), "")
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      lsp: {
        local: {
          transport: "socket",
          command: [server.endpoint],
          extensions: [".fixture"],
          workspaceFolder: "nested",
          workspaceOpen: { solution: "App.sln" },
        },
      },
    }),
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          expect((yield* lsp.status)[0]?.status).toBe("pending")
          yield* lsp
            .execute({ operation: "workspaceSymbol" }, () =>
              Effect.fail(new LSP.Failure({ code: "invalid", message: "current authority denied" })),
            )
            .pipe(Effect.ignore)
          expect(
            (yield* Effect.promise(() => trace(server.root))).filter((row) => row.event === "connect"),
          ).toHaveLength(0)
          yield* lsp.execute({ operation: "workspaceSymbol" }, () => Effect.void)
          expect((yield* lsp.status)[0]?.status).toBe("connected")
          expect(
            (yield* Effect.promise(() => trace(server.root))).filter((row) => row.event === "connect"),
          ).toHaveLength(1)
        }).pipe(Effect.provide(locations.get({ directory: AbsolutePath.make(directory) })))
      }).pipe(Effect.scoped, Effect.provide(app(server.root))),
    )
    await poll(
      async () => (await trace(server.root)).filter((row) => row.event === "close").length === 1,
      "Location connection closed",
    )
    expect(server.child.exitCode).toBeNull()
  } finally {
    await server.close()
  }
}, 30000)

import { Socket } from "node:net"

test.skipIf(process.platform === "win32")(
  "native socket deadline also bounds a pending TCP connection",
  async () => {
    const server = await external()
    const connections: Socket[] = []
    const connected = new Set<Socket>()
    try {
      // The fixture owner pauses its own listener to fill the real kernel backlog.
      // Apexo receives only the endpoint; it never receives this PID or sends signals.
      process.kill(server.child.pid, "SIGSTOP")
      for (let count = 0; count < 512; count++) {
        const socket = new Socket()
        socket.on("error", () => {})
        socket.once("connect", () => connected.add(socket))
        socket.connect(Number(server.endpoint.split(":")[1]), "127.0.0.1")
        connections.push(socket)
      }
      await Bun.sleep(200)
      expect(connected.size).toBeLessThan(connections.length)
      const before = Date.now()
      await expect(
        NativeLspClient.create({
          transport: "socket",
          command: [server.endpoint],
          root: server.root,
          startupTimeout: 150,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow()
      expect(Date.now() - before).toBeLessThan(2000)
      expect(server.child.exitCode).toBeNull()
    } finally {
      connections.forEach((socket) => socket.destroy())
      process.kill(server.child.pid, "SIGCONT")
      await server.close()
    }
  },
  10000,
)
