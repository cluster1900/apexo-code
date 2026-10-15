import { expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SystemContext } from "@apexo/core/system-context"
import { SessionTaskCompletion } from "@apexo/core/session/task-completion"
import { SessionTaskControl } from "@apexo/core/session/task-control"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { SessionIncarnation } from "@apexo/core/session/incarnation"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live("background completion tickets fence Stop, observation, deletion and process ownership", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    return yield* Effect.gen(function* () {
      const initial = yield* SystemContext.initialize(SessionTaskCompletion.context(""))
      expect(initial.baseline).toContain("No pending background Task completion.")
      const sessions = yield* SessionV2.Service
      const database = yield* Database.Service
      const tasks = yield* SessionTaskStore.Service
      const completions = yield* SessionTaskCompletion.Service
      const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
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
      const notices: string[] = []
      const begin = (id: string) =>
        tasks.begin({
          id,
          parentID: parent.id,
          sessionID: child.id,
          request: { description: id, prompt: "work", agent: record.agent, background: true },
        })
      const finish = (id: string, status: "completed" | "cancelled" | "failed" = "completed") =>
        tasks.finish({ id, parentID: parent.id, sessionID: child.id, status, message: `result-${id}` })
      const issue = (id: string, checkpoint: Effect.Success<ReturnType<typeof completions.checkpoint>>) =>
        completions.issue(
          id,
          record,
          checkpoint,
          Effect.sync(() => {
            notices.push(id)
          }),
        )
      const stopped = yield* completions.checkpoint(parent.id)
      completions.stop(stopped.claim)
      yield* begin("stop-before-issue")
      const late = yield* issue("stop-before-issue", stopped)
      yield* finish("stop-before-issue")
      yield* completions.ready(late)
      expect(notices).toEqual([])
      expect(yield* completions.pending(parent.id)).toBe(false)

      yield* begin("stop-before-ready")
      const running = yield* issue("stop-before-ready", yield* completions.checkpoint(parent.id))
      completions.stop(running.claim)
      yield* finish("stop-before-ready")
      yield* completions.ready(running)
      expect(notices).toEqual([])

      yield* begin("terminal-before-observed")
      const observed = yield* issue("terminal-before-observed", yield* completions.checkpoint(parent.id))
      yield* finish("terminal-before-observed")
      yield* completions.observed(parent.id, child.id)
      yield* completions.ready(observed)
      expect(notices).toEqual([])
      expect((yield* tasks.launch(observed.id))?.notice).toBe("observed")

      yield* begin("failed-result")
      const failed = yield* issue("failed-result", yield* completions.checkpoint(parent.id))
      yield* finish("failed-result", "failed")
      yield* completions.ready(failed)
      expect(notices).toEqual(["failed-result"])
      expect(yield* completions.pending(parent.id)).toBe(true)
      const text = yield* completions.take(parent.id)
      expect(text).toContain("result-failed-result")
      expect(text).toContain('"status":"failed"')
      expect((yield* tasks.launch(failed.id))?.notice).toBe("delivered")
      expect(yield* completions.take(parent.id)).toBe("")
      expect(yield* completions.pending(parent.id)).toBe(false)

      yield* begin("cancelled-result")
      const cancelled = yield* issue("cancelled-result", yield* completions.checkpoint(parent.id))
      yield* finish("cancelled-result", "cancelled")
      yield* completions.ready(cancelled)
      expect(notices).toEqual(["failed-result"])
      expect(yield* completions.pending(parent.id)).toBe(false)

      yield* begin("mode-retry")
      yield* finish("mode-retry")
      const changedMode = yield* tasks
        .begin({
          id: "mode-retry",
          parentID: parent.id,
          sessionID: child.id,
          request: { description: "mode-retry", prompt: "work", agent: record.agent },
        })
        .pipe(Effect.result)
      expect(changedMode._tag).toBe("Failure")
      const restarted = SessionTaskStore.make(database.db)
      expect(yield* restarted.notice("mode-retry", "pending")).toBe(false)
      expect(yield* completions.pending(parent.id)).toBe(false)

      yield* begin("deleted-parent")
      const deleted = yield* issue("deleted-parent", yield* completions.checkpoint(parent.id))
      yield* finish("deleted-parent")
      yield* sessions.remove(parent.id)
      yield* sessions.create({ id: parent.id, location: parent.location })
      yield* completions.ready(deleted)
      expect(notices).toEqual(["failed-result"])
      expect(yield* completions.pending(parent.id)).toBe(false)
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([
            SessionV2.node,
            Database.node,
            SessionTaskStore.node,
            SessionTaskControl.node,
            SessionTaskCompletion.node,
          ]),
          [
            [SessionExecution.node, SessionExecution.noopLayer],
            [Global.node, Global.layerWith({ home })],
            [
              ModelsDev.node,
              Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
            ],
          ],
        ).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
        ),
      ),
    )
  }),
)
