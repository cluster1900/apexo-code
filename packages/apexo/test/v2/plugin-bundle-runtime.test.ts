import { emptyHookSelection } from "../fixture/hook-preferences"
import { expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import path from "node:path"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundleRuntime } from "@apexo/core/plugin-bundle-runtime"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { AgentV2 } from "@apexo/core/agent"
import { CommandV2 } from "@apexo/core/command"
import { SkillV2 } from "@apexo/core/skill"
import { HookSnapshotLocation } from "@apexo/core/hook-snapshot-location"
import { HookObserver } from "@apexo/core/hook-observer"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))

it.live(
  "native bundles activate and reload coherently while captured Session hooks retain their generation",
  () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const data = path.join(root, "data")
      const source = path.join(root, "catalog")
      const plugin = path.join(source, "example")
      const store = path.join(data, "plugins")
      yield* Effect.promise(async () => {
        await Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false }))
        await Bun.write(
          path.join(source, ".grok-plugin/marketplace.json"),
          JSON.stringify({ name: "Test", plugins: [{ name: "example", source: "./example" }] }),
        )
        await Bun.write(path.join(plugin, "plugin.json"), JSON.stringify({ name: "example" }))
        await Bun.write(path.join(plugin, "commands/greet.md"), "---\ndescription: Greet\n---\nFIRST_COMMAND")
        await Bun.write(path.join(plugin, "agents/review.md"), "---\ndescription: Review\n---\nFIRST_AGENT")
        await Bun.write(
          path.join(plugin, "skills/read/SKILL.md"),
          "---\nname: read\ndescription: Read\n---\nFIRST_SKILL",
        )
        await Bun.write(
          path.join(plugin, "hooks/hooks.json"),
          JSON.stringify({
            hooks: { Notification: [{ hooks: [{ type: "command", command: "printf first >> hook-trace" }] }] },
          }),
        )
      })
      const catalog = yield* Effect.promise(() => PluginStore.mutate(store, { action: "add-source", source }))
      const id = catalog.items[0]!.id
      const installed = yield* Effect.promise(() => PluginStore.mutate(store, { action: "install", id, trust: true }))
      const installedRoot = installed.items[0]!.path!
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const guard = yield* LocationRuntimeGuard.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const runtime = yield* PluginBundleRuntime.Service
          const agents = yield* AgentV2.Service
          const commands = yield* CommandV2.Service
          const skills = yield* SkillV2.Service
          const hooks = yield* HookSnapshotLocation.Service
          expect(yield* runtime.status).toMatchObject({ generation: 1, active: [id] })
          expect((yield* agents.select("example:review")).info?.system).toContain("FIRST_AGENT")
          expect((yield* commands.get("example:greet"))?.template).toContain("FIRST_COMMAND")
          expect((yield* skills.list()).find((skill) => skill.name === "example:read")?.content).toContain(
            "FIRST_SKILL",
          )
          const original = yield* hooks.capture(session.id)
          yield* Effect.promise(async () => {
            await Bun.write(path.join(installedRoot, "commands/greet.md"), "SECOND_COMMAND")
            await Bun.write(path.join(installedRoot, "agents/review.md"), "SECOND_AGENT")
            await Bun.write(path.join(installedRoot, "skills/read/SKILL.md"), "---\nname: read\n---\nSECOND_SKILL")
            await Bun.write(
              path.join(installedRoot, "hooks/hooks.json"),
              JSON.stringify({
                hooks: { Notification: [{ hooks: [{ type: "command", command: "printf second >> hook-trace" }] }] },
              }),
            )
          })
          const busy = yield* guard.use(session.location, runtime.reload()).pipe(Effect.exit)
          expect(Exit.isFailure(busy)).toBe(true)
          expect((yield* runtime.status).failure).toBeUndefined()
          yield* runtime.reload()
          expect(yield* runtime.status).toMatchObject({ generation: 2, active: [id] })
          expect((yield* agents.select("example:review")).info?.system).toContain("SECOND_AGENT")
          expect((yield* commands.get("example:greet"))?.template).toContain("SECOND_COMMAND")
          expect((yield* skills.list()).find((skill) => skill.name === "example:read")?.content).toContain(
            "SECOND_SKILL",
          )
          expect(yield* hooks.capture(session.id)).toBe(original)
          yield* HookObserver.observe({
            ...{
              directory,
              sessionID: session.id,
              event: "Notification",
              payload: {},
              registry: original.registry,
            },
            selection: emptyHookSelection,
          })
          const replaced = yield* hooks.reload(session.id)
          yield* HookObserver.observe({
            ...{
              directory,
              sessionID: session.id,
              event: "Notification",
              payload: {},
              registry: replaced.registry,
            },
            selection: emptyHookSelection,
          })
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "hook-trace")).text())).toBe("firstsecond")
          yield* Effect.promise(() => Bun.write(path.join(installedRoot, "hooks/hooks.json"), "invalid json"))
          expect(Exit.isFailure(yield* runtime.reload().pipe(Effect.exit))).toBe(true)
          expect(yield* runtime.status).toMatchObject({ generation: 2, active: [id], failure: { code: "invalid" } })
          expect((yield* commands.get("example:greet"))?.template).toContain("SECOND_COMMAND")
          yield* Effect.promise(() => Bun.write(path.join(installedRoot, "hooks/hooks.json"), "{}"))
          yield* Effect.promise(() =>
            Bun.write(
              path.join(installedRoot, ".lsp.json"),
              JSON.stringify({
                lspServers: {
                  unsupported: {
                    command: "unstarted-server",
                    transport: "tcp",
                    extensionToLanguage: { ".fixture": "fixture" },
                  },
                },
              }),
            ),
          )
          expect(Exit.isFailure(yield* runtime.reload().pipe(Effect.exit))).toBe(true)
          expect(yield* runtime.status).toMatchObject({
            generation: 2,
            active: [id],
            failure: { code: "unsupported", components: ["lsp"] },
          })
          const otherDirectory = path.join(root, "other-project")
          yield* Effect.promise(() => Bun.write(path.join(otherDirectory, "apexo.json"), "{}"))
          const other = yield* sessions.create({ location: { directory: AbsolutePath.make(otherDirectory) } })
          const inactive = yield* PluginBundleRuntime.Service.use((service) => service.status).pipe(
            Effect.provide(locations.get(other.location)),
          )
          expect(inactive).toMatchObject({ generation: 0, active: [], failure: { code: "unsupported" } })
          yield* Effect.promise(() => PluginStore.mutate(store, { action: "disable", id }))
          yield* runtime.reload()
          expect(yield* runtime.status).toEqual({ generation: 3, active: [], failure: undefined })
          expect(yield* commands.get("example:greet")).toBeUndefined()
          expect((yield* skills.list()).some((skill) => skill.name === "example:read")).toBe(false)
        }).pipe(Effect.provide(locations.get(session.location)))
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node, LocationRuntimeGuard.node]), [
            [
              Global.node,
              Layer.succeed(Global.Service)(Global.make({ data, config: path.join(root, "config"), home: root })),
            ],
            [SessionExecution.node, SessionExecution.noopLayer],
          ]),
        ),
      )
    }),
  { timeout: 30_000 },
)
