import { Catalog } from "@apexo/core/catalog"
import { lstat, mkdir, rename, rm, symlink } from "node:fs/promises"
import { SessionTaskStore } from "@apexo/core/session/task-store"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { expect } from "bun:test"
import path from "node:path"
import { realpathSync } from "node:fs"
import { ConfigProvider, DateTime, Effect, Layer, Schema, Scope } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { EventV2 } from "@apexo/core/event"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AgentV2 } from "@apexo/core/agent"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { AbsolutePath } from "@apexo/core/schema"
import { SessionEvent } from "@apexo/core/session/event"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionStore } from "@apexo/core/session/store"
import { SessionV1 } from "@apexo/core/v1/session"
import { WorkflowControl } from "@apexo/core/workflow/control"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
for (const change of ["parent-deny", "target-reload", "target-model-reload", "directory-replaced"] as const) {
  it.live(
    `Child placement rejects ${change} after the actual Created event`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const temporary = yield* tmpdirScoped()
        const directory = realpathSync(temporary)
        const target = AbsolutePath.make(path.join(directory, "alternate"))
        yield* Effect.promise(() => mkdir(target))
        const llm = yield* TestLLMServer
        yield* Effect.promise(() =>
          Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              snapshots: false,
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              agents: { helper: { mode: "subagent" } },
              providers: {
                fixture: {
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/openai-compatible",
                    url: llm.url,
                    settings: { apiKey: "fixture" },
                  },
                  models: {
                    model: {
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
          const events = yield* EventV2.Service
          const locations = yield* LocationServiceMap.Service
          const guard = yield* LocationRuntimeGuard.Service
          const scope = yield* Scope.Scope
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(directory) },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          const observed: (typeof parent.id)[] = []
          const unsubscribe = yield* events.listen((event) =>
            Effect.gen(function* () {
              if (event.type !== SessionV1.Event.Created.type) return
              const data = yield* Schema.decodeUnknownEffect(Schema.toType(SessionV1.Event.Created.data))(
                event.data,
              ).pipe(Effect.orDie)
              if (data.info.parentID !== parent.id) return
              observed.push(data.sessionID)
              if (change === "parent-deny")
                return yield* store.setPermissions({
                  sessionID: parent.id,
                  permissions: [{ permission: "task", pattern: "helper", action: "deny" }],
                })
              if (change === "directory-replaced")
                return yield* Effect.promise(async () => {
                  await rename(target, `${target}-retired`)
                  await mkdir(target)
                })
              const child = yield* store.get(data.sessionID)
              expect(child).toBeDefined()
              if (!child) return
              expect(Object.hasOwn(child.location, "workspaceID")).toBe(true)
              expect(child.location.directory).toBe(target)
              yield* guard
                .idle(
                  child.location,
                  Effect.gen(function* () {
                    if (change === "target-model-reload") {
                      const catalog = yield* Catalog.Service
                      return yield* catalog.transform((draft) =>
                        draft.model.remove(ProviderV2.ID.make("fixture"), ModelV2.ID.make("model")),
                      )
                    }
                    const agents = yield* AgentV2.Service
                    yield* agents.transform((draft) =>
                      draft.update(AgentV2.ID.make("helper"), (agent) => {
                        agent.permissions.push({ action: "read", resource: "*", effect: "deny" })
                      }),
                    )
                  }).pipe(Effect.provide(locations.get(child.location)), Effect.provideService(Scope.Scope, scope)),
                )
                .pipe(Effect.orDie)
            }).pipe(Effect.provideService(Scope.Scope, scope)),
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          yield* llm.respond(() =>
            reply()
              .tool("task", {
                description: "Held placement",
                prompt: "MUST_NOT_REACH_CHILD",
                subagent_type: "helper",
                cwd: "alternate",
              })
              .item(),
          )
          const requests: Record<string, unknown>[] = []
          yield* llm.respond((hit) => {
            requests.push(hit.body)
            return reply().text("PARENT_REJECTED_PLACEMENT").stop().item()
          })
          yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Place the child" } })
          yield* sessions.wait(parent.id)
          expect(observed).toHaveLength(1)
          expect(requests).toHaveLength(1)
          const messages = Schema.decodeUnknownSync(
            Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
          )(requests[0].messages)
          expect(messages.filter((message) => message.role === "user").map((message) => message.content)).toEqual([
            "Place the child",
          ])
          expect(yield* llm.calls).toBe(2)
          expect(yield* sessions.messages({ sessionID: observed[0], order: "asc" })).toEqual([])
          const history = yield* sessions.messages({ sessionID: parent.id, order: "asc" })
          const tools = history.flatMap((message) =>
            message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
          )
          expect(tools[0].state.status).toBe("error")
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionStore.node,
                SessionExecutionLocal.node,
                EventV2.node,
                LocationServiceMap.node,
                LocationRuntimeGuard.node,
              ]),
              [
                [SessionExecution.node, SessionExecutionLocal.node],
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
    30000,
  )
}

for (const fault of [
  "deleted-cwd",
  "worktree-replaced-by-directory",
  "worktree-replaced-by-dangling-symlink",
  "worktree-missing-snapshot-receipt",
  "worktree-repository-replaced",
] as const) {
  it.live(
    `Deleted placement recovery rejects ${fault} before any child provider call`,
    () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const temporary = yield* tmpdirScoped()
        const directory = AbsolutePath.make(realpathSync(temporary))
        const llm = yield* TestLLMServer
        yield* Effect.promise(() => Bun.write(path.join(directory, "tracked.txt"), "BASE"))
        for (const args of [
          ["init"],
          ["add", "tracked.txt"],
          ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "base"],
        ]) {
          expect(Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd: directory }).exitCode).toBe(0)
        }
        const target = AbsolutePath.make(path.join(directory, "alternate"))
        yield* Effect.promise(() => mkdir(target))
        const configuration = JSON.stringify({
          snapshots: false,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          agents: { helper: { mode: "subagent" } },
          providers: {
            fixture: {
              api: {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: llm.url,
                settings: { apiKey: "fixture" },
              },
              models: {
                model: {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
          },
        })
        yield* Effect.promise(() => Bun.write(path.join(directory, "apexo.json"), configuration))
        yield* Effect.promise(() => Bun.write(path.join(target, "apexo.json"), configuration))
        yield* Effect.gen(function* () {
          const sessions = yield* SessionV2.Service
          const tasks = yield* SessionTaskStore.Service
          const parent = yield* sessions.create({
            location: { directory },
            agent: AgentV2.ID.make("build"),
            model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("model") },
          })
          yield* llm.respond(() =>
            reply()
              .tool("task", {
                description: "Initial child",
                prompt: "INITIAL_CHILD",
                subagent_type: "helper",
                ...(fault === "deleted-cwd" ? { cwd: "alternate" } : { isolation: "worktree" }),
              })
              .item(),
          )
          yield* llm.respond(() => reply().text("INITIAL_CHILD_DONE").stop().item())
          yield* llm.respond(() => reply().text("PARENT_INITIAL_DONE").stop().item())
          yield* sessions.prompt({ sessionID: parent.id, prompt: { text: "Create initial child" } })
          yield* sessions.wait(parent.id)
          expect(yield* llm.calls).toBe(3)
          const source = (yield* tasks.list(parent.id))[0]
          expect(source).toBeDefined()
          const placementDir = source.placement!.directory
          yield* Effect.promise(() => rm(placementDir, { recursive: true, force: true }))
          if (fault === "worktree-replaced-by-directory") {
            yield* Effect.promise(() => mkdir(placementDir, { recursive: true }))
          }
          if (fault === "worktree-replaced-by-dangling-symlink") {
            yield* Effect.promise(() => symlink(path.join(directory, "missing-symlink-target"), placementDir))
          }
          if (fault === "worktree-missing-snapshot-receipt") {
            yield* tasks.updatePlacement(parent.id, source.sessionID, {
              ...source.placement!,
              changes: undefined,
            })
          }
          if (fault === "worktree-repository-replaced") {
            yield* Effect.promise(() => rm(path.join(directory, ".git"), { recursive: true, force: true }))
            for (const args of [
              ["init"],
              ["add", "tracked.txt"],
              ["-c", "user.name=Other", "-c", "user.email=other@example.test", "commit", "-m", "replaced"],
            ]) {
              expect(Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd: directory }).exitCode).toBe(0)
            }
          }
          for (const continuation of ["task_id", "resume_from"] as const) {
            const beforeCalls = yield* llm.calls
            yield* llm.respond(() =>
              reply()
                .tool("task", {
                  description: `Faulty ${continuation}`,
                  prompt: "MUST_NOT_RUN_IN_CHILD",
                  subagent_type: "helper",
                  ...(continuation === "task_id" ? { task_id: source.sessionID } : { resume_from: source.sessionID }),
                })
                .item(),
            )
            yield* llm.respond(() => reply().text(`PARENT_REJECTED_${continuation}`).stop().item())
            yield* sessions.prompt({ sessionID: parent.id, prompt: { text: `Try ${continuation}` } })
            yield* sessions.wait(parent.id)
            expect(yield* llm.calls).toBe(beforeCalls + 2)
            expect(yield* tasks.list(parent.id)).toHaveLength(1)
            if (fault === "deleted-cwd") {
              const stat = yield* Effect.promise(() => lstat(placementDir).catch(() => undefined))
              expect(stat).toBeUndefined()
            }
          }
          yield* Effect.promise(() => rm(placementDir, { recursive: true, force: true }))
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(
              LayerNode.group([
                SessionV2.node,
                SessionStore.node,
                SessionTaskStore.node,
                SessionExecutionLocal.node,
                EventV2.node,
                LocationServiceMap.node,
                LocationRuntimeGuard.node,
              ]),
              [
                [SessionExecution.node, SessionExecutionLocal.node],
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
    30000,
  )
}

