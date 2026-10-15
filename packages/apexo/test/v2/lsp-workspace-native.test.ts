import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, rm, symlink, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { Effect, Layer, Fiber, Exit, Deferred } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { PluginBundleRuntime } from "@apexo/core/plugin-bundle-runtime"
import { PluginStore } from "@apexo/core/plugin-store"
import { EventV2 } from "@apexo/core/event"
import { LSP } from "@apexo/core/lsp"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { AgentV2 } from "@apexo/core/agent"
import { SessionV2 } from "@apexo/core/session"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionStore } from "@apexo/core/session/store"
import { PermissionV2 } from "@apexo/core/permission"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { PluginBundle } from "@apexo/core/plugin-bundle"

for (const dialect of ["camel", "snake"] as const)
  test(`native plugin LSP preserves ${dialect} workspace root and open targets`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-workspace-"))
    try {
      await Bun.write(path.join(root, "plugin.json"), JSON.stringify({ name: "workspace" }))
      await Bun.write(
        path.join(root, ".lsp.json"),
        JSON.stringify({
          local: {
            command: process.execPath,
            extensionToLanguage: { ".fixture": "fixture" },
            [dialect === "camel" ? "workspaceFolder" : "workspace_folder"]: "nested",
            [dialect === "camel" ? "workspaceOpen" : "workspace_open"]: {
              solution: "App.sln",
              projects: ["One.csproj", "Two.csproj"],
            },
          },
        }),
      )
      const bundle = await PluginBundle.read(root, "workspace", { native: true })
      expect(bundle.config.lsp).toMatchObject({
        "workspace:local": {
          workspaceFolder: "nested",
          workspaceOpen: { solution: "App.sln", projects: ["One.csproj", "Two.csproj"] },
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

for (const settings of [
  { workspaceFolder: null },
  { workspaceFolder: "   " },
  { workspaceFolder: 0 },
  { workspaceFolder: "a", workspace_folder: "b" },
  { workspaceOpen: null },
  { workspaceOpen: { solution: "" } },
  { workspaceOpen: { projects: [3] } },
  { workspaceOpen: {}, workspace_open: {} },
])
  test(`native plugin LSP rejects invalid workspace settings ${JSON.stringify(settings)}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-workspace-"))
    try {
      await Bun.write(path.join(root, "plugin.json"), JSON.stringify({ name: "workspace" }))
      await Bun.write(
        path.join(root, ".lsp.json"),
        JSON.stringify({
          local: { command: process.execPath, extensionToLanguage: { ".fixture": "fixture" }, ...settings },
        }),
      )
      await expect(PluginBundle.read(root, "workspace", { native: true })).rejects.toBeDefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
const fixture = path.join(import.meta.dir, "../fixture/lsp-native-stdio.ts")
const app = (root: string) =>
  AppNodeBuilder.build(LayerNode.group([SessionV2.node, SessionStore.node, LocationServiceMap.node, EventV2.node]), [
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
      .map(
        (
          line,
        ): {
          event: string
          pid: number
          cwd?: string
          params?: { rootUri?: string; workspaceFolders?: { uri: string }[]; solution?: string; projects?: string[] }
        } => JSON.parse(line),
      ),
  )
const reaped = (file: string) =>
  Effect.gen(function* () {
    for (const entry of (yield* trace(file)).filter((entry) => entry.event === "start"))
      yield* pollWithTimeout(
        Effect.sync(() => {
          try {
            process.kill(entry.pid, 0)
            return undefined
          } catch {
            return true
          }
        }),
        "workspace LSP process disposed",
      )
  })

it.live(
  "workspace LSP stays pending until current root/open/external authority, then initializes once with canonical targets",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const log = path.join(root, "trace")
      const externalLog = path.join(root, "external-trace")
      yield* Effect.promise(async () => {
        await Bun.write(path.join(root, "data/.ready"), "")
        await Bun.write(path.join(directory, "nested/App.sln"), "")
        await Bun.write(path.join(directory, "nested/One.csproj"), "")
        await Bun.write(path.join(root, "external/External.sln"), "")
        await Bun.write(path.join(directory, "main.fixture"), "workspace result")
        await Bun.write(path.join(directory, "main.external"), "external result")
        await Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            agents: {
              denyRoot: { mode: "all", permissions: [{ action: "read", resource: "nested", effect: "deny" }] },
              askRoot: { mode: "all", permissions: [{ action: "read", resource: "nested", effect: "ask" }] },
              denyOpen: { mode: "all", permissions: [{ action: "read", resource: "nested/App.sln", effect: "deny" }] },
              denyExternal: {
                mode: "all",
                permissions: [{ action: "external_directory", resource: "*", effect: "deny" }],
              },
            },
            lsp: {
              local: {
                command: [process.execPath, fixture],
                extensions: [".fixture"],
                env: { LSP_NATIVE_TRACE: log },
                workspaceFolder: "nested",
                workspaceOpen: { solution: "App.sln", projects: ["One.csproj"] },
              },
              external: {
                command: [process.execPath, fixture],
                extensions: [".external"],
                env: { LSP_NATIVE_TRACE: externalLog },
                workspaceFolder: path.join(root, "external"),
                workspaceOpen: { solution: "External.sln" },
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
          const lsp = yield* LSP.Service
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()
          const call = (agent = "build", filePath = "main.fixture") => ({
            sessionID: session.id,
            agent: AgentV2.ID.make(agent),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call" as const,
              id: crypto.randomUUID(),
              name: "lsp",
              input: { operation: "hover", filePath, line: 1, character: 1 },
            },
          })
          expect((yield* lsp.status).map((entry) => entry.status)).toEqual(["pending", "pending"])
          expect(yield* trace(log)).toEqual([])
          expect((yield* registry.settle(call("denyRoot"))).result.type).toBe("error")
          expect((yield* registry.settle(call("denyOpen"))).result.type).toBe("error")
          expect((yield* registry.settle(call("denyExternal", "main.external"))).result.type).toBe("error")
          expect(yield* trace(log)).toEqual([])
          expect(yield* trace(externalLog)).toEqual([])
          const direct = yield* lsp.execute({ operation: "workspaceSymbol" }).pipe(Effect.exit)
          expect(Exit.isFailure(direct)).toBe(true)
          expect(yield* trace(log)).toEqual([])
          const results = yield* Effect.all([registry.settle(call()), registry.settle(call())], {
            concurrency: "unbounded",
          })
          expect(results.map((entry) => entry.result.type)).toEqual(["text", "text"])
          const events = yield* trace(log)
          expect(events.filter((entry) => entry.event === "start")).toHaveLength(1)
          expect(events.find((entry) => entry.event === "start")?.cwd).toBe(directory)
          const uri = pathToFileURL(path.join(directory, "nested")).href
          expect(events.find((entry) => entry.event === "initialize")?.params).toMatchObject({
            rootUri: uri,
            workspaceFolders: [{ uri }],
          })
          expect(events.find((entry) => entry.event === "solution/open")?.params).toEqual({
            solution: `${uri}/App.sln`,
          })
          expect(events.find((entry) => entry.event === "project/open")?.params).toEqual({
            projects: [`${uri}/One.csproj`],
          })
          expect(events.findIndex((entry) => entry.event === "initialized")).toBeLessThan(
            events.findIndex((entry) => entry.event === "solution/open"),
          )
          expect((yield* registry.settle(call("denyOpen"))).result.type).toBe("error")
          expect((yield* trace(log)).filter((entry) => entry.event === "request")).toHaveLength(2)
          expect((yield* registry.settle(call("build", "main.external"))).result.type).toBe("text")
          expect((yield* trace(externalLog)).find((entry) => entry.event === "initialize")?.params?.rootUri).toBe(
            pathToFileURL(path.join(root, "external")).href,
          )
          const permission = yield* PermissionV2.Service
          const asking = yield* registry.settle(call("askRoot")).pipe(Effect.forkChild)
          const request = yield* pollWithTimeout(
            permission
              .forSession(session.id)
              .pipe(
                Effect.map((entries) =>
                  entries.find((entry) => entry.action === "read" && entry.resources.includes("nested")),
                ),
              ),
            "workspace root permission requested",
          )
          yield* permission.reply({ requestID: request.id, reply: "once" })
          const answered = yield* Fiber.join(asking).pipe(Effect.timeout("3 seconds"))
          expect(answered.result.type).toBe("text")
          expect(yield* permission.forSession(session.id)).toEqual([])
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
      yield* reaped(log)
      yield* reaped(externalLog)
    }),
)

it.live(
  "workspace LSP rejects changed canonical targets and defers crash recovery until a fresh authorized request",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const log = path.join(root, "trace")
      const linkLog = path.join(root, "link-trace")
      const link = path.join(root, "external-link")
      yield* Effect.promise(async () => {
        await Bun.write(path.join(root, "data/.ready"), "")
        await Bun.write(path.join(directory, "nested/App.sln"), "")
        await Bun.write(path.join(root, "one/App.sln"), "")
        await Bun.write(path.join(root, "two/App.sln"), "")
        await symlink(path.join(root, "one"), link)
        await Bun.write(path.join(directory, "main.fixture"), "workspace result")
        await Bun.write(path.join(directory, "main.linked"), "workspace result")
        await Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            agents: {
              denyRoot: { mode: "all", permissions: [{ action: "read", resource: "nested", effect: "deny" }] },
            },
            lsp: {
              local: {
                command: [process.execPath, fixture],
                extensions: [".fixture"],
                env: { LSP_NATIVE_TRACE: log },
                workspaceFolder: "nested",
                workspaceOpen: { solution: "App.sln" },
                restartOnCrash: true,
                maxRestarts: 1,
              },
              linked: {
                command: [process.execPath, fixture],
                extensions: [".linked"],
                env: { LSP_NATIVE_TRACE: linkLog },
                workspaceFolder: link,
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
          const lsp = yield* LSP.Service
          const tools = yield* ToolRegistry.Service
          const registry = yield* tools.materialize()
          const call = (agent = "build", filePath = "main.fixture") => ({
            sessionID: session.id,
            agent: AgentV2.ID.make(agent),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call" as const,
              id: crypto.randomUUID(),
              name: "lsp",
              input: { operation: "hover", filePath, line: 1, character: 1 },
            },
          })
          yield* Effect.promise(async () => {
            await unlink(link)
            await symlink(path.join(root, "two"), link)
          })
          expect((yield* registry.settle(call("build", "main.linked"))).result.type).toBe("error")
          expect(yield* trace(linkLog)).toEqual([])
          expect((yield* registry.settle(call())).result.type).toBe("text")
          const first = (yield* trace(log)).find((entry) => entry.event === "start")
          if (!first) throw new Error("Workspace LSP must publish its owned PID")
          process.kill(first.pid, "SIGKILL")
          yield* pollWithTimeout(
            lsp.status.pipe(
              Effect.map((entries) =>
                entries.find((entry) => entry.id === "local")?.status === "failed" ? true : undefined,
              ),
            ),
            "workspace LSP close observed",
          )
          expect((yield* registry.settle(call("denyRoot"))).result.type).toBe("error")
          yield* Effect.sleep("1100 millis")
          yield* lsp.status
          expect((yield* trace(log)).filter((entry) => entry.event === "start")).toHaveLength(1)
          expect((yield* registry.settle(call())).result.type).toBe("text")
          const starts = (yield* trace(log)).filter((entry) => entry.event === "start")
          expect(starts).toHaveLength(2)
          const second = starts.at(-1)
          if (!second) throw new Error("Workspace LSP restart must publish its owned PID")
          process.kill(second.pid, "SIGKILL")
          yield* pollWithTimeout(
            lsp.status.pipe(
              Effect.map((entries) =>
                entries.find((entry) => entry.id === "local")?.status === "failed" ? true : undefined,
              ),
            ),
            "workspace LSP second close observed",
          )
          expect((yield* registry.settle(call())).result.type).toBe("error")
          expect((yield* trace(log)).filter((entry) => entry.event === "start")).toHaveLength(2)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
      yield* reaped(log)
    }),
  { timeout: 30000 },
)

it.live(
  "trusted plugin workspace activation joins interruption and reload retains immutable targets until disable",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const plugin = path.join(root, "plugin")
      const store = path.join(root, "data/plugins")
      const log = path.join(root, "trace")
      const mode = path.join(root, "mode")
      yield* Effect.promise(async () => {
        await Bun.write(path.join(root, "data/.ready"), "")
        await Bun.write(path.join(directory, "nested/App.sln"), "")
        await Bun.write(path.join(directory, "main.fixture"), "workspace result")
        await Bun.write(mode, "hang")
        await Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({ snapshots: false, permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
        )
        await Bun.write(path.join(plugin, "plugin.json"), JSON.stringify({ name: "workspace" }))
        await Bun.write(
          path.join(plugin, ".lsp.json"),
          JSON.stringify({
            local: {
              command: process.execPath,
              args: [fixture],
              extensionToLanguage: { ".fixture": "fixture" },
              env: { LSP_NATIVE_TRACE: log, LSP_NATIVE_MODE_FILE: mode },
              workspaceFolder: "nested",
              workspaceOpen: { solution: "App.sln" },
            },
          }),
        )
        await PluginStore.mutate(store, { action: "install", source: plugin, trust: true })
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
          const call = () => ({
            sessionID: session.id,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: {
              type: "tool-call" as const,
              id: crypto.randomUUID(),
              name: "lsp",
              input: { operation: "hover", filePath: "main.fixture", line: 1, character: 1 },
            },
          })
          expect((yield* lsp.status)[0]?.status).toBe("pending")
          const running = yield* registry.settle(call()).pipe(Effect.forkChild)
          yield* pollWithTimeout(
            trace(log).pipe(
              Effect.map((entries) => (entries.some((entry) => entry.event === "initialize") ? true : undefined)),
            ),
            "authorized workspace initialization started",
          )
          expect(Exit.isFailure(yield* runtime.reload().pipe(Effect.exit))).toBe(true)
          yield* Fiber.interrupt(running)
          yield* reaped(log)
          expect((yield* trace(log)).some((entry) => entry.event === "solution/open")).toBe(false)
          yield* Effect.promise(() => Bun.write(mode, "ready"))
          yield* runtime.reload()
          expect((yield* lsp.status)[0]?.status).toBe("pending")
          expect((yield* registry.settle(call())).result.type).toBe("text")
          const catalog = yield* Effect.promise(() => PluginStore.catalog(store))
          const item = catalog.items.find((entry) => entry.name === "workspace")
          if (!item) throw new Error("Installed plugin must remain in the catalog")
          yield* Effect.promise(() => PluginStore.mutate(store, { action: "disable", id: item.id }))
          yield* runtime.reload()
          expect(yield* lsp.status).toEqual([])
          yield* reaped(log)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(Effect.provide(app(root)))
    }),
  { timeout: 30000 },
)

it.live(
  "queued workspace activation rechecks revoked current permission after another activation releases",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const firstLog = path.join(root, "first-trace")
      const secondLog = path.join(root, "second-trace")
      const mode = path.join(root, "mode")
      yield* Effect.promise(async () => {
        await Bun.write(path.join(root, "data/.ready"), "")
        await Bun.write(path.join(directory, "nested/App.sln"), "")
        await Bun.write(mode, "hang")
        await Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            lsp: {
              first: {
                command: [process.execPath, fixture],
                extensions: [".first"],
                env: { LSP_NATIVE_TRACE: firstLog, LSP_NATIVE_MODE_FILE: mode },
                workspaceFolder: "nested",
              },
              second: {
                command: [process.execPath, fixture],
                extensions: [".second"],
                env: { LSP_NATIVE_TRACE: secondLog },
                workspaceFolder: "nested",
              },
            },
          }),
        )
      })
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const store = yield* SessionStore.Service
        const locations = yield* LocationServiceMap.Service
        const first = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const second = yield* sessions.create({ location: first.location })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const permission = yield* PermissionV2.Service
          const queued = yield* Deferred.make<void>()
          const authorize =
            (sessionID: SessionV2.ID, signal = false): LSP.AuthorizeWorkspace =>
            (targets) =>
              Effect.gen(function* () {
                for (const target of targets)
                  yield* permission.assert({
                    sessionID,
                    agent: AgentV2.ID.make("build"),
                    action: "read",
                    resources: [target.resource],
                    save: ["*"],
                  })
                if (signal) yield* Deferred.succeed(queued, undefined)
              }).pipe(Effect.mapError(() => new LSP.Failure({ code: "invalid", message: "Workspace read denied" })))
          const held = yield* lsp
            .execute(
              { operation: "hover", file: path.join(directory, "main.first"), text: "first", line: 0, character: 0 },
              authorize(first.id),
            )
            .pipe(Effect.forkChild)
          yield* pollWithTimeout(
            trace(firstLog).pipe(
              Effect.map((entries) => (entries.some((entry) => entry.event === "initialize") ? true : undefined)),
            ),
            "first workspace initialization holds activation",
          )
          const waiting = yield* lsp
            .execute(
              { operation: "hover", file: path.join(directory, "main.second"), text: "second", line: 0, character: 0 },
              authorize(second.id, true),
            )
            .pipe(Effect.forkChild)
          yield* Deferred.await(queued)
          yield* store.setPermissions({
            sessionID: second.id,
            permissions: [{ permission: "read", pattern: "nested", action: "deny" }],
          })
          yield* Fiber.interrupt(held)
          const outcome = yield* Fiber.await(waiting)
          expect(Exit.isFailure(outcome)).toBe(true)
          expect(yield* trace(secondLog)).toEqual([])
        }).pipe(Effect.provide(locations.get(first.location)))
      }).pipe(Effect.provide(app(root)))
      yield* reaped(firstLog)
      yield* reaped(secondLog)
    }),
  { timeout: 30000 },
)
