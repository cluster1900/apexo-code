import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
import { EditTool } from "@apexo/core/tool/edit"
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
        EditTool.node,
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

test("native V2 edit applies fuzzy corrections and returns Grok Build guidance on misses", async () => {
  const root = await mkdtemp(path.join(homedir(), ".apexo-edit-fuzzy-"))
  const workspace = path.join(root, "workspace")
  const directories = ["data", "config", "cache", "state", "tmp"].map((name) => path.join(root, name))
  await Promise.all([workspace, ...directories].map((dir) => mkdir(dir, { recursive: true })))
  await writeFile(
    path.join(workspace, "apexo.json"),
    JSON.stringify({ snapshots: false, permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
  )
  const file = path.join(workspace, "a.ts")
  await writeFile(file, "export function f() {\n    return 1   \n}\nconst label = \u201Chello\u201D\nx\nx\n")

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
              slug: "edit",
              projectID,
              directory: workspace,
              title: "Edit fuzzy",
              version: "1",
              time: { created: Date.now(), updated: Date.now() },
            }),
          },
          { id: creation.eventID, commit: () => creation.commit.pipe(Effect.orDie) },
        )
        const registry = yield* tools.materialize()
        const edit = (input: Record<string, unknown>) =>
          registry.settle({
            sessionID,
            agent: AgentV2.ID.make("build"),
            assistantMessageID: SessionMessage.ID.create(),
            call: { type: "tool-call", id: crypto.randomUUID(), name: "edit", input },
          })
        const text = (result: { result: unknown }) => JSON.stringify(result.result)

        // Line-trimmed fuzzy correction (V1 parity)
        const fuzzy = yield* edit({
          path: "a.ts",
          oldString: "export function f() {\n  return 1\n}",
          newString: "export function f() {\n  return 2\n}",
        })
        expect(fuzzy.result.type).not.toBe("error")
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toStartWith(
          "export function f() {\n  return 2\n}\n",
        )

        // Miss with smart quotes: Grok Build nearest-match + typography guidance, file untouched
        const before = yield* Effect.promise(() => readFile(file, "utf8"))
        const miss = yield* edit({ path: "a.ts", oldString: 'const label = "hello"', newString: "const label = 1" })
        expect(miss.result.type).toBe("error")
        expect(text(miss)).toContain("Unicode typography characters (smart quotes, em-dashes, etc.) on lines 4 ")
        const near = yield* edit({ path: "a.ts", oldString: "export function g() {", newString: "x" })
        expect(near.result.type).toBe("error")
        expect(text(near)).toContain("Nearest match: line 1: export function f() {")
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe(before)

        // Exact multiple matches stay ambiguous
        const multiple = yield* edit({ path: "a.ts", oldString: "x\n", newString: "y\n" })
        expect(multiple.result.type).toBe("error")
        expect(text(multiple)).toContain("multiple matches")

        // replaceAll reports the replacement count
        const all = yield* edit({ path: "a.ts", oldString: "x\n", newString: "y\n", replaceAll: true })
        expect(all.result.type).not.toBe("error")
        expect(text(all)).toContain("Replacements: 2")
      }).pipe(Effect.scoped, Effect.provide(layer)),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
