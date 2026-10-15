import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionTaskRole } from "@apexo/core/session/task-role"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionIncarnation } from "@apexo/core/session/incarnation"
import { SessionMessage } from "@apexo/core/session/message"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live("Subagent hooks require the live launch and immutable Created and agent authority", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const database = yield* Database.Service
      const tasks = yield* SessionTaskStore.Service
      const roles = yield* SessionTaskRole.Service
      const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(home) } })
      for (const scenario of ["valid", "agent", "created", "missing-launch"] as const) {
        const child = yield* sessions.create({ location: parent.location, parentID: parent.id })
        const record: SessionTaskStore.Record = {
          sessionID: child.id,
          parentID: parent.id,
          parentCreated: (yield* SessionIncarnation.created(database.db, parent.id))!,
          childCreated: (yield* SessionIncarnation.created(database.db, child.id))!,
          agent: AgentV2.ID.make("general"),
          authority: [],
          createdAt: Date.now(),
        }
        yield* tasks.create(record)
        const launchID = `hook-role-${scenario}`
        yield* tasks.begin({
          id: launchID,
          sessionID: child.id,
          parentID: parent.id,
          request: { description: "hook role", prompt: "inspect", agent: record.agent },
        })
        yield* roles.attach(child.id, {
          launchID: scenario === "missing-launch" ? "missing" : launchID,
          inputID: SessionMessage.ID.create(),
          record: {
            ...record,
            ...(scenario === "agent" ? { agent: AgentV2.ID.make("renamed") } : {}),
            ...(scenario === "created" ? { childCreated: "different-incarnation" } : {}),
          },
          attempt: undefined,
          observe: undefined,
          take: () => true,
        })
        if (scenario !== "valid") {
          expect((yield* roles.live(child.id).pipe(Effect.result))._tag).toBe("Failure")
          continue
        }
        expect(yield* roles.live(child.id)).toBe(roles.get(child.id))
        yield* tasks.finish({
          id: launchID,
          sessionID: child.id,
          parentID: parent.id,
          status: "completed",
          replyID: SessionMessage.ID.create(),
        })
        expect((yield* roles.live(child.id).pipe(Effect.result))._tag).toBe("Failure")
      }
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([SessionV2.node, Database.node, SessionTaskStore.node, SessionTaskRole.node]),
          [
            [SessionExecution.node, SessionExecution.noopLayer],
            [Global.node, Global.layerWith({ home })],
          ],
        ),
      ),
    )
  }),
)
