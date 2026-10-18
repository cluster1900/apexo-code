import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AbsolutePath } from "@apexo/schema/schema"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { Location } from "@apexo/core/location"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectSchema } from "@apexo/core/project/schema"
import { AgentV2 } from "@apexo/core/agent"
import { SessionProjector } from "@apexo/core/session/projector"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionV1 } from "@apexo/core/v1/session"
import { CommandSandbox } from "@apexo/core/command-sandbox"
import { BashTool } from "@apexo/core/tool/bash"
import { PluginV2 } from "@apexo/core/plugin"
import { PluginPromise } from "@apexo/core/plugin/promise"
import { ShellEnvironment } from "@apexo/core/shell-environment"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"

const makeLayer = (root: string, workspace: string, directories: string[]) => {
  const projectID = ProjectSchema.ID.make("global")
  return {
    projectID,
    layer: LayerNode.compile(
      LayerNode.group([
        Database.node,
        EventV2.node,
        SessionProjector.node,
        SessionLifecycle.node,
        SessionCommandSandbox.node,
        CommandSandbox.node,
        BashTool.node,
        PluginV2.node,
        ShellEnvironment.node,
        ToolRegistry.node,
        AgentV2.node,
        CrossSpawnSpawner.node,
      ]),
      [
        [Database.node, Database.layerFromPath(":memory:")],
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({
              home: root,
              data: directories[0],
              config: directories[1],
              cache: directories[2],
              state: directories[3],
              tmp: directories[4],
            }),
          ),
        ],
        [
          Location.node,
          Layer.succeed(Location.Service)({
            directory: AbsolutePath.make(workspace),
            project: { id: projectID, directory: AbsolutePath.make(workspace) },
          }),
        ],
      ],
    ),
  }
}

test("native V2 plugins inject shell.env into bash commands until unloaded", async () => {
  const root = await mkdtemp(path.join(homedir(), ".apexo-shell-env-"))
  const workspace = path.join(root, "workspace")
  const directories = ["data", "config", "cache", "state", "tmp"].map((name) => path.join(root, name))
  await Promise.all([workspace, ...directories].map((dir) => mkdir(dir, { recursive: true })))
  await writeFile(
    path.join(workspace, "apexo.json"),
    JSON.stringify({ snapshots: false, permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
  )

  const { projectID, layer } = makeLayer(root, workspace, directories)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const events = yield* EventV2.Service
        const policies = yield* SessionCommandSandbox.Service
        const sandbox = yield* CommandSandbox.Service
        const tools = yield* ToolRegistry.Service
        const agents = yield* AgentV2.Service
        const plugins = yield* PluginV2.Service
        yield* agents.transform((draft) =>
          draft.update(AgentV2.ID.make("build"), (agent) => {
            agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
          }),
        )
        yield* database.db
          .insert(ProjectTable)
          .values({ id: projectID, worktree: AbsolutePath.make(workspace), sandboxes: [] })
          .run()
        const policy = yield* sandbox.preflight("off")
        const sessionID = SessionSchema.ID.create()
        const creation = yield* policies.prepareRoot(sessionID, policy)
        yield* events.publish(
          SessionV1.Event.Created,
          {
            sessionID,
            info: SessionV1.SessionInfo.make({
              id: sessionID,
              slug: "shell-env",
              projectID,
              directory: workspace,
              title: "Shell env",
              version: "1",
              time: { created: Date.now(), updated: Date.now() },
            }),
          },
          { id: creation.eventID, commit: () => creation.commit.pipe(Effect.orDie) },
        )

        const seen: { cwd: string; sessionID?: string; callID?: string }[] = []
        const effectID = PluginV2.ID.make("test.shell-env.effect")
        const promiseID = PluginV2.ID.make("test.shell-env.promise")
        yield* plugins.add(effectID, (host) =>
          host.shell
            .env((event) =>
              Effect.sync(() => {
                seen.push({ cwd: event.cwd, sessionID: event.sessionID, callID: event.callID })
                event.env.APEXO_EFFECT_ENV = "effect-value"
                event.env.APEXO_SHARED_ENV = "from-effect"
              }),
            )
            .pipe(Effect.asVoid),
        )
        yield* plugins.add(
          promiseID,
          PluginPromise.fromPromise({
            id: promiseID,
            setup: async (host) => {
              await host.shell.env(async (event) => {
                // Later hooks see earlier writes and may override them.
                event.env.APEXO_PROMISE_ENV = `promise-${event.env.APEXO_SHARED_ENV}`
                event.env.APEXO_SHARED_ENV = "from-promise"
              })
            },
          }).effect,
        )

        const registry = yield* tools.materialize()
        const call = (name: string, input: Record<string, unknown>) =>
          registry.settle({
            sessionID,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: { type: "tool-call", id: crypto.randomUUID(), name, input },
          })
        const bash = (command: string) => call("bash", { command, description: "env" })
        const text = (result: { result: unknown }) => JSON.stringify(result.result)
        const probe =
          'printf "[%s|%s|%s|%s]" "$APEXO_EFFECT_ENV" "$APEXO_PROMISE_ENV" "$APEXO_SHARED_ENV" "${HOME:+home}"'

        const injected = yield* bash(probe)
        expect(injected.result.type).not.toBe("error")
        expect(text(injected)).toContain("[effect-value|promise-from-effect|from-promise|home]")
        expect(seen).toHaveLength(1)
        expect(seen[0]?.sessionID).toBe(sessionID)
        expect(seen[0]?.callID).toBeString()
        expect(seen[0]?.cwd).toBeString()

        yield* plugins.remove(promiseID)
        const partial = yield* bash(probe)
        expect(text(partial)).toContain("[effect-value||from-effect|home]")

        yield* plugins.remove(effectID)
        const cleared = yield* bash(probe)
        expect(text(cleared)).toContain("[|||home]")
        expect(seen).toHaveLength(2)
      }).pipe(Effect.scoped, Effect.provide(layer)),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
