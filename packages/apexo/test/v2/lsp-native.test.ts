import { expect, test } from "bun:test"
import path from "node:path"
import { symlink } from "node:fs/promises"
import { Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { PluginBundle } from "@apexo/core/plugin-bundle"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundleRuntime } from "@apexo/core/plugin-bundle-runtime"
import { EventV2 } from "@apexo/core/event"
import { LSP } from "@apexo/core/lsp"
import { NativeLspClient } from "@apexo/core/lsp-client"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { AgentV2 } from "@apexo/core/agent"
import { SessionV2 } from "@apexo/core/session"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const fixture = path.join(import.meta.dir, "../fixture/lsp-native-stdio.ts")
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
      .map((line): { event: string; pid: number; child?: number; languageId?: string; text?: string } =>
        JSON.parse(line),
      ),
  )
const reaped = (file: string) =>
  Effect.gen(function* () {
    for (const entry of (yield* trace(file)).filter((entry) => entry.event === "start" || entry.event === "descendant"))
      yield* pollWithTimeout(
        Effect.sync(() => {
          try {
            process.kill(entry.child ?? entry.pid, 0)
            return undefined
          } catch {
            return true
          }
        }),
        "LSP process disposed",
      )
  })

test("native LSP frame limits account for split and adjacent frames", () => {
  const framing = new NativeLspClient.Framing(10)
  framing.append(Buffer.from("Content-Length: 2\r\n\r"))
  framing.append(Buffer.from("\n{}Content-Length: 2\r\n\r\n{}"))
  expect(() => framing.append(Buffer.from("Content-Length: 11\r\n\r\n"))).toThrow()
  expect(() =>
    new NativeLspClient.Framing().append(Buffer.from("Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}")),
  ).toThrow()
})

it.live(
  "native LSP tools enforce read/external permissions before transmission, support six operations and cancel owned processes",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const log = path.join(root, "trace")
      yield* Effect.promise(async () => {
        await Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            agents: {
              denyRead: { mode: "all", permissions: [{ action: "read", resource: "*", effect: "deny" }] },
              denyExternal: {
                mode: "all",
                permissions: [{ action: "external_directory", resource: "*", effect: "deny" }],
              },
            },
            lsp: {
              local: {
                command: [process.execPath, fixture],
                extensions: [".fixture"],
                languageIds: { ".fixture": "fixture-language" },
                env: { LSP_NATIVE_TRACE: log, LSP_NATIVE_DESCENDANT: "1" },
              },
            },
          }),
        )
        await Bun.write(path.join(directory, "main.fixture"), "first")
        await Bun.write(path.join(root, "outside.fixture"), "external secret")
        await symlink(path.join(root, "outside.fixture"), path.join(directory, "link.fixture"))
      })
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const runtime = yield* PluginBundleRuntime.Service
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()
          const call = (input: unknown, agent = "build") => ({
            sessionID: session.id,
            agent: AgentV2.ID.make(agent),
            assistantMessageID: SessionMessage.ID.create(),
            call: { type: "tool-call" as const, id: crypto.randomUUID(), name: "lsp", input },
          })
          expect(yield* lsp.status).toMatchObject([
            { id: "local", status: "connected", operations: NativeLspClient.operations },
          ])
          yield* lsp.status
          expect((yield* trace(log)).filter((x) => x.event === "start")).toHaveLength(1)
          expect(
            (yield* registry.settle(
              call({ operation: "hover", filePath: "main.fixture", line: 1, character: 1 }, "denyRead"),
            )).result.type,
          ).toBe("error")
          expect(
            (yield* registry.settle(
              call(
                { operation: "hover", filePath: path.join(root, "outside.fixture"), line: 1, character: 1 },
                "denyExternal",
              ),
            )).result.type,
          ).toBe("error")
          expect(
            (yield* registry.settle(call({ operation: "hover", filePath: "link.fixture", line: 1, character: 1 })))
              .result.type,
          ).toBe("error")
          expect((yield* trace(log)).filter((x) => x.event === "open")).toHaveLength(0)
          for (const operation of NativeLspClient.operations)
            expect(
              (yield* registry.settle(
                call({ operation, filePath: "main.fixture", line: 1, character: 1, query: "first" }),
              )).result.type,
            ).toBe("text")
          expect((yield* trace(log)).find((x) => x.event === "open")?.languageId).toBe("fixture-language")
          yield* Effect.promise(() => Bun.write(path.join(directory, "main.fixture"), "second"))
          expect(
            (yield* registry.settle(call({ operation: "hover", filePath: "main.fixture", line: 1, character: 1 })))
              .result,
          ).toMatchObject({ type: "text", value: expect.stringContaining("second") })
          expect((yield* trace(log)).filter((x) => x.event === "change")).toHaveLength(1)
          expect(
            (yield* registry.settle(
              call({ operation: "hover", filePath: path.join(root, "outside.fixture"), line: 1, character: 1 }),
            )).result,
          ).toMatchObject({ type: "text", value: expect.stringContaining("external secret") })
          yield* Effect.promise(() => Bun.write(path.join(directory, "main.fixture"), "LSP_WAIT"))
          const running = yield* registry
            .settle(call({ operation: "hover", filePath: "main.fixture", line: 1, character: 1 }))
            .pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            trace(log).pipe(
              Effect.map((entries) => (entries.filter((x) => x.event === "request").length === 9 ? true : undefined)),
            ),
            "LSP request started",
          )
          expect(Exit.isFailure(yield* runtime.reload().pipe(Effect.exit))).toBe(true)
          yield* Fiber.interrupt(running)
          yield* pollWithTimeout(
            trace(log).pipe(Effect.map((entries) => (entries.some((x) => x.event === "cancel") ? true : undefined))),
            "LSP cancellation reached server",
          )
          yield* runtime.reload()
          expect((yield* lsp.status)[0]?.status).toBe("connected")
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
      yield* reaped(log)
    }),
  { timeout: 30000 },
)

it.live(
  "trusted plugin LSP candidates retain the prior generation on failure and interruption, then retire on disable",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const source = path.join(root, "catalog")
      const store = path.join(root, "data/plugins")
      const log = path.join(root, "trace")
      const mode = path.join(root, "mode")
      yield* Effect.promise(async () => {
        await Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false }))
        await Bun.write(mode, "ready")
        await Bun.write(
          path.join(source, ".grok-plugin/marketplace.json"),
          JSON.stringify({ name: "Test", plugins: [{ name: "example", source: "./example" }] }),
        )
        await Bun.write(path.join(source, "example/plugin.json"), JSON.stringify({ name: "example" }))
        await Bun.write(
          path.join(source, "example/.lsp.json"),
          JSON.stringify({
            lspServers: {
              local: {
                command: process.execPath,
                args: [fixture],
                extensionToLanguage: { ".fixture": "fixture" },
                env: { LSP_NATIVE_TRACE: log, LSP_NATIVE_MODE_FILE: mode },
              },
            },
          }),
        )
      })
      const catalog = yield* Effect.promise(() => PluginStore.mutate(store, { action: "add-source", source }))
      const id = catalog.items[0]!.id
      const installed = yield* Effect.promise(() => PluginStore.mutate(store, { action: "install", id, trust: true }))
      const installedConfig = path.join(installed.items[0]!.path!, ".lsp.json")
      const originalConfig = yield* Effect.promise(() => Bun.file(installedConfig).text())
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const runtime = yield* PluginBundleRuntime.Service
          const lsp = yield* LSP.Service
          expect(yield* runtime.status).toMatchObject({ generation: 1, active: [id] })
          const query = () =>
            lsp.execute({
              operation: "hover",
              file: path.join(directory, "main.fixture"),
              text: "retained",
              line: 0,
              character: 0,
            })
          expect(yield* query()).toMatchObject([{ contents: { value: "retained" } }])
          for (const policy of [{ transport: "unsupported" }]) {
            yield* Effect.promise(async () => {
              const definition = JSON.parse(originalConfig)
              Object.assign(definition.lspServers.local, policy)
              await Bun.write(installedConfig, JSON.stringify(definition))
            })
            const compatibility = yield* Effect.promise(() => PluginBundle.read(installed.items[0]!.path!, "example"))
            expect(compatibility.config.lsp).toHaveProperty("example:local")
            expect(Exit.isFailure(yield* runtime.reload().pipe(Effect.exit))).toBe(true)
            expect(yield* runtime.status).toMatchObject({
              generation: 1,
              active: [id],
              failure: { code: "unsupported", components: ["lsp"] },
            })
            expect(yield* query()).toMatchObject([{ contents: { value: "retained" } }])
          }
          yield* Effect.promise(() => Bun.write(installedConfig, originalConfig))
          yield* Effect.promise(() => Bun.write(mode, "fail"))
          expect(Exit.isFailure(yield* runtime.reload().pipe(Effect.exit))).toBe(true)
          expect(yield* runtime.status).toMatchObject({ generation: 1, active: [id], failure: { code: "load" } })
          expect(yield* query()).toMatchObject([{ contents: { value: "retained" } }])
          const started = (yield* trace(log)).filter((x) => x.event === "start").length
          yield* Effect.promise(() => Bun.write(mode, "hang"))
          const pending = yield* runtime.reload().pipe(Effect.forkScoped)
          yield* pollWithTimeout(
            trace(log).pipe(
              Effect.map((entries) => (entries.filter((x) => x.event === "start").length > started ? true : undefined)),
            ),
            "LSP candidate started",
          )
          yield* Fiber.interrupt(pending)
          expect((yield* runtime.status).generation).toBe(1)
          expect(yield* query()).toMatchObject([{ contents: { value: "retained" } }])
          yield* Effect.promise(() => Bun.write(mode, "ready"))
          yield* runtime.reload()
          expect(yield* runtime.status).toMatchObject({ generation: 2, active: [id] })
          expect((yield* runtime.status).failure).toBeUndefined()
          yield* Effect.promise(() => PluginStore.mutate(store, { action: "disable", id }))
          yield* runtime.reload()
          expect(yield* lsp.status).toEqual([])
          expect((yield* runtime.status).active).toEqual([])
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
      yield* reaped(log)
    }),
  { timeout: 30000 },
)

it.live(
  "base failures stay explicit, status is passive and connection loss publishes Location invalidation",
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
            lsp: {
              local: { command: [process.execPath, fixture], extensions: [".fixture"], env: { LSP_NATIVE_TRACE: log } },
              broken: { command: [path.join(root, "missing")], extensions: [".bad"] },
              disabled: { disabled: true },
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const statuses = yield* lsp.status
          expect(statuses.find((x) => x.id === "broken")).toMatchObject({
            status: "failed",
            error: "Could not initialize language server",
            operations: [],
          })
          expect(statuses.find((x) => x.id === "disabled")).toMatchObject({ status: "disabled", operations: [] })
          expect((yield* trace(log)).filter((x) => x.event === "start")).toHaveLength(1)
          const events = yield* EventV2.Service
          const observed: string[] = []
          const unsubscribe = yield* events.listen((event) =>
            Effect.sync(() => {
              if (event.type === "lsp.updated" && event.location?.directory === session.location.directory)
                observed.push(event.type)
            }),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          process.kill((yield* trace(log)).find((x) => x.event === "start")!.pid, "SIGTERM")
          yield* pollWithTimeout(
            lsp.status.pipe(
              Effect.map((items) => (items.find((x) => x.id === "local")?.status === "failed" ? true : undefined)),
            ),
            "LSP loss becomes visible",
          )
          yield* pollWithTimeout(
            Effect.sync(() => (observed.length ? true : undefined)),
            "Location LSP event published",
          )
          yield* lsp.status
          expect(observed.length).toBeGreaterThan(0)
          expect((yield* trace(log)).filter((x) => x.event === "start")).toHaveLength(1)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
      yield* reaped(log)
    }),
  { timeout: 15000 },
)

it.live("plugin LSP adapter consumes canonical and aliased extension, initialization and startup fields", () =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    yield* Effect.promise(() => Bun.write(path.join(root, "plugin.json"), JSON.stringify({ name: "mapping" })))
    for (const fields of [
      {
        extensions: { ".fixture": "fixture-language" },
        initialization_options: { mode: "native" },
        startup_timeout: 1234,
        shutdown_timeout: 2345,
        restart_on_crash: true,
        max_restarts: 2,
      },
      {
        extensionToLanguage: { ".fixture": "fixture-language" },
        initializationOptions: { mode: "native" },
        startupTimeout: 1234,
        shutdownTimeout: 2345,
        restartOnCrash: true,
        maxRestarts: 2,
      },
      {
        extensionToLanguageId: { ".fixture": "fixture-language" },
        initializationOptions: { mode: "native" },
        startupTimeout: 1234,
        shutdownTimeout: 2345,
        restartOnCrash: true,
        maxRestarts: 2,
      },
    ]) {
      yield* Effect.promise(() =>
        Bun.write(
          path.join(root, ".lsp.json"),
          JSON.stringify({
            local: {
              command: "./server",
              args: ["--stdio"],
              env: { ROOT: "${PLUGIN_ROOT}" },
              settings: { fixture: { enabled: true } },
              ...fields,
            },
          }),
        ),
      )
      const bundle = yield* Effect.promise(() => PluginBundle.read(root, "mapping", { native: true }))
      expect(bundle.config.lsp).toMatchObject({
        "mapping:local": {
          command: [path.join(root, "server"), "--stdio"],
          extensions: [".fixture"],
          languageIds: { ".fixture": "fixture-language" },
          env: { ROOT: root },
          initialization: { mode: "native" },
          settings: { fixture: { enabled: true } },
          timeout: { startup: 1234, shutdown: 2345 },
          restartOnCrash: true,
          maxRestarts: 2,
        },
      })
    }
  }),
)
