import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { ModelsDev } from "@apexo/core/models-dev"
import { PermissionV2 } from "@apexo/core/permission"
import { AgentV2 } from "@apexo/core/agent"
import { Catalog } from "@apexo/core/catalog"
import { Model } from "@apexo/schema/model"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionStore } from "@apexo/core/session/store"
import { SessionRunnerModel } from "@apexo/core/session/runner/model"
import { WorkflowAgent } from "@apexo/core/workflow/agent"
import { WorkflowStore } from "@apexo/core/workflow/store"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live("Workflow native selection preserves original ceilings and rejects held authorization changes", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify({
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          agents: {
            parent: {
              permissions: [
                { action: "*", resource: "*", effect: "allow" },
                { action: "read", resource: "secret", effect: "deny" },
              ],
            },
            helper: {
              mode: "subagent",
              model: "fixture/first",
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
            },
            hidden: { mode: "subagent", hidden: true },
            disabled: { mode: "subagent", disabled: true },
            primary: { mode: "primary" },
          },
          providers: {
            fixture: {
              api: {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: "http://127.0.0.1:1",
                settings: { apiKey: "fixture" },
              },
              models: {
                first: {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
                second: {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
          },
        }),
      ),
    )
    yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* SessionStore.Service
      const workflows = yield* WorkflowStore.Service
      const locations = yield* LocationServiceMap.Service
      const parent = yield* sessions.create({
        location: { directory: AbsolutePath.make(directory) },
        agent: AgentV2.ID.make("parent"),
      })
      yield* Effect.gen(function* () {
        const agents = yield* AgentV2.Service
        const permission = yield* PermissionV2.Service
        const models = yield* SessionRunnerModel.Service
        const catalog = yield* Catalog.Service
        const run = yield* workflows.create(parent.id, {
          source: {
            type: "definition",
            definition: {
              name: "selection",
              description: "selection admission",
              stages: [{ name: "child", prompt: "Select" }],
            },
          },
        })
        yield* workflows.change(parent.id, run.info.id, (state) => ({
          ...state,
          info: { ...state.info, status: "running" },
          tasks: [{ key: "child:0", hash: "selection", stage: "child", status: "reserved" }],
        }))
        const admit = (agent = "helper") =>
          WorkflowAgent.admit({
            agents,
            permission,
            sessions: store,
            models,
            catalog,
            workflows,
            parent,
            parentAgent: AgentV2.ID.make("parent"),
            task: {
              runID: run.info.id,
              key: "child:0",
              stage: { name: "child", prompt: "Select" },
              prompt: "Select",
              agent: AgentV2.ID.make(agent),
              attach: () => Effect.void,
            },
          })
        for (const name of ["missing", "hidden", "primary", "disabled"])
          expect((yield* admit(name).pipe(Effect.result))._tag).toBe("Failure")
        expect((yield* workflows.read(parent.id, run.info.id)).tasks[0]?.selection).toBeUndefined()
        const first = yield* admit()
        expect(first.selection.agent).toBe(AgentV2.ID.make("helper"))
        expect(first.selection.model.id).toBe(Model.ID.make("first"))
        expect(
          yield* workflows
            .selectChild(parent.id, run.info.id, "child:0", {
              ...first.selection,
              model: { ...first.selection.model, id: Model.ID.make("second") },
            })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "stale" })
        yield* agents.transform((draft) => {
          draft.update(AgentV2.ID.make("parent"), (agent) => {
            agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
          })
          draft.update(AgentV2.ID.make("helper"), (agent) => {
            agent.model = { ...first.selection.model, id: Model.ID.make("second") }
          })
        })
        yield* workflows.stop(parent.id, run.info.id, false)
        yield* workflows.resume(parent.id, run.info.id)
        yield* workflows.change(parent.id, run.info.id, (state) => ({
          ...state,
          info: { ...state.info, status: "running" },
        }))
        const restored = yield* admit()
        expect(restored.selection).toEqual(first.selection)
        const child = yield* sessions.create({
          location: parent.location,
          agent: AgentV2.ID.make("helper"),
          parentID: parent.id,
        })
        yield* store.setPermissions({
          sessionID: child.id,
          permissions: [{ permission: "read", pattern: "*", action: "allow" }],
        })
        expect(
          (yield* permission
            .ask({ sessionID: child.id, action: "read", resources: ["secret"] })
            .pipe(Effect.provideService(PermissionV2.Inherited, new Map([[child.id, restored.authority]])))).effect,
        ).toBe("deny")
        yield* agents.transform((draft) =>
          draft.update(AgentV2.ID.make("parent"), (agent) => {
            agent.permissions = [
              { action: "*", resource: "*", effect: "allow" },
              { action: "read", resource: "new-secret", effect: "deny" },
            ]
          }),
        )
        const tightened = yield* admit()
        expect(
          (yield* permission
            .ask({ sessionID: child.id, action: "read", resources: ["new-secret"] })
            .pipe(Effect.provideService(PermissionV2.Inherited, new Map([[child.id, tightened.authority]])))).effect,
        ).toBe("deny")
        yield* agents.transform((draft) =>
          draft.update(AgentV2.ID.make("parent"), (agent) => {
            agent.permissions = [
              { action: "*", resource: "*", effect: "allow" },
              { action: "task", resource: "helper", effect: "ask" },
            ]
          }),
        )
        const pending = yield* admit().pipe(Effect.exit, Effect.forkChild)
        const request = yield* pollWithTimeout(
          permission.forSession(parent.id).pipe(Effect.map((items) => items.find((item) => item.action === "task"))),
          "Workflow permission did not wait",
          "5 seconds",
        )
        yield* agents.transform((draft) =>
          draft.update(AgentV2.ID.make("parent"), (agent) => {
            agent.permissions = [
              { action: "*", resource: "*", effect: "allow" },
              { action: "task", resource: "helper", effect: "deny" },
            ]
          }),
        )
        yield* permission.reply({ requestID: request.id, reply: "once" })
        expect((yield* Fiber.join(pending))._tag).toBe("Failure")
        expect((yield* workflows.read(parent.id, run.info.id)).tasks[0]?.selection).toEqual(first.selection)
        yield* agents.transform((draft) =>
          draft.update(AgentV2.ID.make("parent"), (agent) => {
            agent.permissions = [
              { action: "*", resource: "*", effect: "allow" },
              { action: "task", resource: "helper", effect: "ask" },
            ]
          }),
        )
        const unavailable = yield* admit().pipe(Effect.exit, Effect.forkChild)
        const held = yield* pollWithTimeout(
          permission.forSession(parent.id).pipe(Effect.map((items) => items.find((item) => item.action === "task"))),
          "Workflow selection did not wait",
          "5 seconds",
        )
        yield* agents.transform((draft) => draft.remove(AgentV2.ID.make("helper")))
        yield* permission.reply({ requestID: held.id, reply: "once" })
        expect((yield* Fiber.join(unavailable))._tag).toBe("Failure")
        expect((yield* workflows.read(parent.id, run.info.id)).tasks[0]?.selection).toEqual(first.selection)
      }).pipe(Effect.provide(locations.get(parent.location)))
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(
          LayerNode.group([SessionV2.node, SessionStore.node, LocationServiceMap.node, WorkflowStore.node]),
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
