import { expect, test } from "bun:test"
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
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
import { SessionCommandSandboxTable } from "@apexo/core/session/command-sandbox.sql"
import { CommandSandboxPolicy } from "@apexo/core/command-sandbox/policy"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionV1 } from "@apexo/core/v1/session"
import { CommandSandbox } from "@apexo/core/command-sandbox"
import { BashTool } from "@apexo/core/tool/bash"
import { ToolRegistry } from "@apexo/core/tool/registry"

test.skipIf(process.platform !== "darwin")(
  "real native Bash applies captured workspace policy after permission and reports confirmed execution",
  async () => {
    const root = await mkdtemp(path.join(homedir(), ".apexo-bash-sandbox-"))
    const workspace = path.join(root, "workspace")
    const directories = [workspace, ...["data", "config", "cache", "state", "tmp"].map((name) => path.join(root, name))]
    await Promise.all(directories.map((directory) => mkdir(directory)))
    await writeFile(
      path.join(workspace, "apexo.json"),
      JSON.stringify({ snapshots: false, permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
    )
    await writeFile(path.join(root, "hardlink-target"), "BEFORE")
    await link(path.join(root, "hardlink-target"), path.join(workspace, "pre-existing-hardlink"))
    await symlink(root, path.join(workspace, "escape"))
    await mkdir(path.join(workspace, ".apexo"))
    const requests = { count: 0 }
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        requests.count++
        return new Response("ready")
      },
    })
    expect(await (await fetch(`http://127.0.0.1:${server.port}`)).text()).toBe("ready")
    const projectID = ProjectSchema.ID.make("global")
    const layer = LayerNode.compile(
      LayerNode.group([
        Database.node,
        EventV2.node,
        SessionProjector.node,
        SessionLifecycle.node,
        SessionCommandSandbox.node,
        CommandSandbox.node,
        BashTool.node,
        ToolRegistry.node,
        AgentV2.node,
      ]),
      [
        [Database.node, Database.layerFromPath(":memory:")],
        [
          Global.node,
          Layer.succeed(Global.Service)(
            Global.make({
              home: root,
              data: directories[1],
              config: directories[2],
              cache: directories[3],
              state: directories[4],
              tmp: directories[5],
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
    )
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* Database.Service
          const events = yield* EventV2.Service
          const policies = yield* SessionCommandSandbox.Service
          const sandbox = yield* CommandSandbox.Service
          const tools = yield* ToolRegistry.Service
          const agents = yield* AgentV2.Service
          yield* agents.transform((draft) =>
            draft.update(AgentV2.ID.make("build"), (agent) => {
              agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
            }),
          )
          yield* database.db
            .insert(ProjectTable)
            .values({ id: projectID, worktree: AbsolutePath.make(workspace), sandboxes: [] })
            .run()
          const profile = yield* sandbox.preflight("workspace")
          const id = SessionSchema.ID.create()
          const creation = yield* policies.prepareRoot(id, profile)
          yield* events.publish(
            SessionV1.Event.Created,
            {
              sessionID: id,
              info: SessionV1.SessionInfo.make({
                id,
                slug: "sandbox",
                projectID,
                directory: workspace,
                title: "Sandbox",
                version: "1",
                time: { created: Date.now(), updated: Date.now() },
              }),
            },
            {
              id: creation.eventID,
              commit: () => creation.commit.pipe(Effect.orDie),
            },
          )
          expect(yield* sandbox.status(id)).toMatchObject({
            profile: "workspace",
            network: "off",
            backend: { availability: "available" },
          })
          expect((yield* sandbox.status(id)).latestExecution).toBeUndefined()
          expect((yield* policies.assertLegacy(id).pipe(Effect.flip))._tag).toBe("CommandSandbox.Failure")
          const registry = yield* tools.materialize()
          const call = (command: string, agent = "build", sessionID = id, workdir?: string) =>
            registry.settle({
              sessionID,
              agent: AgentV2.ID.make(agent),
              assistantMessageID: SessionMessage.ID.create(),
              call: {
                type: "tool-call",
                id: crypto.randomUUID(),
                name: "bash",
                input: { command, ...(workdir ? { workdir } : {}) },
              },
            })
          const result = yield* call(
            "printf OK > allowed; printf BAD > ../outside; printf BAD > apexo.json; printf DONE",
          )
          expect(result.result.type).not.toBe("error")
          expect(JSON.stringify(result)).toContain("Operation not permitted")
          expect(JSON.stringify(result)).toContain("DONE")
          expect(JSON.stringify(result)).not.toContain("APEXO_COMMAND_SANDBOX_")
          expect((yield* sandbox.status(id)).latestExecution).toMatchObject({
            backend: "seatbelt",
            outcome: "exited",
            exitCode: 0,
          })
          const network = yield* call(`/usr/bin/curl -sS --max-time 2 http://127.0.0.1:${server.port}`)
          expect(network.result.type).not.toBe("error")
          expect((yield* sandbox.status(id)).latestExecution?.exitCode).not.toBe(0)
          expect(requests.count).toBe(1)
          yield* call(
            "printf BAD > escape/symlink-escape; /bin/mv .apexo moved-control; printf ALIAS > pre-existing-hardlink",
          )
          const parentCapability = yield* policies.capture(id)
          const childID = SessionSchema.ID.create()
          yield* events.publish(SessionV1.Event.Created, {
            sessionID: childID,
            info: SessionV1.SessionInfo.make({
              id: childID,
              parentID: id,
              slug: "sandbox-child",
              projectID,
              directory: workspace,
              title: "Child",
              version: "1",
              time: { created: Date.now(), updated: Date.now() },
            }),
          })
          yield* policies.inherit(parentCapability, childID)
          const migratedChild = SessionSchema.ID.create()
          const migratedEvent = yield* events.publish(SessionV1.Event.Created, {
            sessionID: migratedChild,
            info: SessionV1.SessionInfo.make({
              id: migratedChild,
              parentID: id,
              slug: "legacy-child",
              projectID,
              directory: workspace,
              title: "Legacy",
              version: "1",
              time: { created: Date.now(), updated: Date.now() },
            }),
          })
          yield* database.db
            .insert(SessionCommandSandboxTable)
            .values({
              session_id: migratedChild,
              created_event_id: migratedEvent.id,
              version: 1,
              policy: { policy: CommandSandboxPolicy.off, origin: "migration" },
              time_created: Date.now(),
            })
            .run()
          expect((yield* policies.inherit(parentCapability, migratedChild).pipe(Effect.flip))._tag).toBe(
            "CommandSandbox.Failure",
          )

          yield* call("printf BAD > child-outside", "build", childID, root)
          expect((yield* sandbox.status(childID)).revision).toBe((yield* sandbox.status(id)).revision)
          expect((yield* sandbox.status(childID)).profile).toBe("workspace")
          const receipt = (yield* sandbox.status(id)).latestExecution?.id
          const denied = yield* call("printf BAD > permission-denied", "missing-agent")
          expect(denied.result.type).toBe("error")
          expect((yield* sandbox.status(id)).latestExecution?.id).toBe(receipt)
        }).pipe(Effect.scoped, Effect.provide(layer)),
      )
      expect(await readFile(path.join(workspace, "allowed"), "utf8")).toBe("OK")
      expect(await Bun.file(path.join(root, "outside")).exists()).toBe(false)
      expect(await Bun.file(path.join(root, "child-outside")).exists()).toBe(false)
      expect(await Bun.file(path.join(workspace, "permission-denied")).exists()).toBe(false)
      expect(await Bun.file(path.join(root, "symlink-escape")).exists()).toBe(false)
      expect(await Bun.file(path.join(workspace, "moved-control")).exists()).toBe(false)
      expect(await readFile(path.join(root, "hardlink-target"), "utf8")).toBe("ALIAS")
      expect(JSON.parse(await readFile(path.join(workspace, "apexo.json"), "utf8")).snapshots).toBe(false)
    } finally {
      await server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  },
  15000,
)
