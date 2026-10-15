import { expect } from "bun:test"
import { Effect } from "effect"
import { Workflow } from "@apexo/schema/workflow"
import { Model } from "@apexo/schema/model"
import { Provider } from "@apexo/schema/provider"
import { SessionID } from "@apexo/schema/session-id"
import { AbsolutePath } from "@apexo/schema/schema"
import { Database } from "@apexo/core/database/database"
import { WorkflowStore } from "@apexo/core/workflow/store"
import { WorkflowEngine } from "@apexo/core/workflow/engine"
import { SessionTable } from "@apexo/core/session/sql"
import { ProjectTable } from "@apexo/core/project/sql"
import { ProjectV2 } from "@apexo/core/project"
import { testEffect } from "../lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))
const fixture = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const sessionID = SessionID.create()
  const projectID = ProjectV2.ID.make("workflow-tests")
  yield* database.db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/tmp"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "workflow",
      directory: "/tmp",
      title: "Workflow",
      version: "1",
    })
    .run()
  const store = WorkflowStore.make(database.db)
  return { database, sessionID, store, engine: WorkflowEngine.make(store) }
})

it.live("model and variant remain durable stage input and changed options reject the same reserved key", () =>
  Effect.gen(function* () {
    for (const changed of [
      { id: Model.ID.make("other"), providerID: Provider.ID.make("fixture"), variant: Model.VariantID.make("precise") },
      {
        id: Model.ID.make("alternate"),
        providerID: Provider.ID.make("fixture"),
        variant: Model.VariantID.make("other"),
      },
    ]) {
      const f = yield* fixture()
      const model = {
        id: Model.ID.make("alternate"),
        providerID: Provider.ID.make("fixture"),
        variant: Model.VariantID.make("precise"),
      }
      const run = yield* f.store.create(f.sessionID, {
        source: {
          type: "definition",
          definition: {
            name: "model-journal",
            description: "Immutable selection",
            stages: [{ name: "child", prompt: "Review", model }],
          },
        },
      })
      expect((yield* f.store.read(f.sessionID, run.info.id)).definition.stages[0]?.model).toEqual(model)
      const calls: unknown[] = []
      yield* f.engine.run(f.sessionID, run.info.id, (task) => {
        calls.push(task.stage.model)
        return Effect.fail(new WorkflowStore.Failure({ code: "invalid", message: "Controlled first attempt failure" }))
      })
      const first = yield* f.store.read(f.sessionID, run.info.id)
      expect(first.tasks).toHaveLength(1)
      expect(first.info.agentsSpent).toBe(1)
      yield* f.store.change(f.sessionID, run.info.id, (state) => ({
        ...state,
        info: { ...state.info, status: "pending" },
        definition: {
          ...state.definition,
          stages: state.definition.stages.map((stage) => ({ ...stage, model: changed })),
        },
      }))
      const replay = yield* f.engine.run(f.sessionID, run.info.id, () => {
        calls.push("unexpected changed-model replay")
        return Effect.succeed({ sessionID: SessionID.create(), output: "unexpected", tokens: 1 })
      })
      expect(replay?.status).toBe("failed")
      expect(replay?.message).toContain("replay diverged")
      expect(calls).toEqual([model])
      expect((yield* f.store.read(f.sessionID, run.info.id)).tasks[0]?.hash).toBe(first.tasks[0]?.hash)
    }
  }),
)
